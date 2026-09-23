import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {
  AuthorizationInteraction,
  AuthorizationSession,
} from '@deepseek-ai/dsh-authorization'
import type {
  ConnectionRpcFailure,
  ConnectionRpcResult,
  HostConnectionHandle,
} from '@deepseek-ai/dsh-client-connection'
import { CQAI_PROVIDER } from './llm-adapter.ts'

import { AccountServiceClient, AccountServiceError } from './account-service.ts'
import { launchTopUpPayment } from './payment-launch.ts'
import {
  mayAdoptCqaiOnboardingDefault,
  preferredCqaiOnboardingModel,
} from './onboarding.ts'
import { Config, normalizeConfig } from './config.ts'
import { DsnAccountError, errorCodeOf, safeErrorMessage } from './errors.ts'
import { openLoopbackCallbackServer, type LoopbackCallbackServer } from './loopback-callback.ts'
import { OidcClient, Prompt, type AuthorizationRequest, type TokenResponse } from './oidc.ts'
import { bindCqaiModelRoute } from './route-registration.ts'
import {
  CREDENTIAL_ID,
  CREDENTIAL_SCOPE,
  DSN_DEFAULT_MODEL_CATEGORY_ORDER,
  RPC_CHANNEL,
  isChatModel,
  isDsnDefaultModelCategory,
  isModelInCategory,
  isPublicAccount,
  remainingQuota,
  type DsnAccountConfig,
  type DsnAccountService,
  type DsnAccountSnapshot,
  type DsnCategoryDefaultModels,
  type DsnDefaultModelCategory,
  type DsnDefaultModelSelection,
  type DsnModel,
  type DsnModelCatalog,
  type DsnModelListOptions,
  type DsnTopUpHistory,
  type DsnTopUpInfo,
  type DsnTopUpListOptions,
  type DsnTopUpRequest,
  type DsnTopUpResult,
  type GrantPayload,
  type LogoutResult,
  type PublicAccount,
} from './protocol.ts'

export { Config }
export type {
  BrowserAuthorizationNotice,
  DsnAccountConfig,
  DsnAccountService,
  DsnAccountSnapshot,
  DsnCategoryDefaultModels,
  DsnDefaultModelCategory,
  DsnDefaultModelSelection,
  DsnModelArchitecture,
  DsnModel,
  DsnModelCatalog,
  DsnModelListOptions,
  DsnModelCategory,
  DsnTopUpHistory,
  DsnTopUpInfo,
  DsnTopUpListOptions,
  DsnTopUpOption,
  DsnTopUpRecord,
  DsnTopUpRequest,
  DsnTopUpResult,
  GrantPayload,
  LogoutResult,
  PublicAccount,
} from './protocol.ts'
export {
  DSN_DEFAULT_MODEL_CATEGORY_ORDER, DSN_MODEL_CATEGORY_ORDER, MODEL_CATALOG_CACHE_TTL_MS,
  isAudioModel, isChatModel, isImageGenerationModel, isModelInCategory, isVideoCatalogEntry, isVideoModel, isVisionChatModel,
} from './protocol.ts'
export { DsnAccountError } from './errors.ts'
export { AccountServiceClient, AccountServiceError } from './account-service.ts'

export const name = 'cqaiclub-dsn-account'
export const inject = ['authorization', 'credentials', 'connection', 'webServer', 'llm', 'agentDefaultModel', 'desktopRuntime']
export const CQAI_CATEGORY_DEFAULT_MODELS_SETTINGS_NAMESPACE = 'cqaiclub-category-default-models'

type AgentDefaultModelService = {
  currentSelection(): DsnDefaultModelSelection
  saveSelection(selection: DsnDefaultModelSelection): Promise<void>
}

type CategoryDefaultModelSettings = Partial<Record<DsnDefaultModelCategory, string>>

const CategoryDefaultModelSettingsSchema: z<CategoryDefaultModelSettings> = z.object({
  image: z.string(),
  'text-multimodal': z.string(),
  video: z.string(),
  audio: z.string(),
  other: z.string(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    dsnAccount: DsnAccountService
    agentDefaultModel: AgentDefaultModelService
  }

  interface Events {
    'dsn-account/changed'(snapshot: DsnAccountSnapshot): void
    'dsn-account/models-updated'(): void
  }
}

type CredentialsLike = Context['credentials']
type AuthorizationLike = Context['authorization']

type InternalConnectionService = HostConnectionHandle & {
  register(
    owner: Context,
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>,
  ): unknown
}

type ActiveAttempt = {
  id: string
  request: AuthorizationRequest
  redirectUri: string
  promise?: Promise<void>
}

type PendingAuthorization = {
  attemptId: string
  state: string
  promise: Promise<string>
  resolve: (code: string) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
  callbackServer: LoopbackCallbackServer
}

type DesktopLoginRuntime = {
  openExternal?(target: string): Promise<void>
  show?(): void
  loginCompletionUrl?: string
}

const OAUTH_CALLBACK_PATH = `${RPC_CHANNEL}/oauth/callback`

type RpcPayload = Record<string, unknown>

function sameSnapshot(left: DsnAccountSnapshot, right: DsnAccountSnapshot): boolean {
  // Snapshots are deliberately small, JSON-safe wire values. Suppressing an
  // identical publication keeps the `changed` event edge-triggered and also
  // protects consumers from accidentally turning a read into an event loop.
  return JSON.stringify(left) === JSON.stringify(right)
}

export class DsnAccountServiceRuntime extends Service implements DsnAccountService {
  static inject = inject

  private readonly root: Context
  private readonly credentials: CredentialsLike
  private readonly authorization: AuthorizationLike
  private readonly connection: HostConnectionHandle
  private readonly desktopLoginRuntime: DesktopLoginRuntime | undefined
  private readonly agentDefaultModel: AgentDefaultModelService
  private readonly config: DsnAccountConfig
  private readonly credential = credentialKey(CREDENTIAL_SCOPE, CREDENTIAL_ID)
  private readonly oidc: OidcClient
  private readonly accountService: AccountServiceClient
  private activeAttempt?: ActiveAttempt
  private pendingAuthorization?: PendingAuthorization
  private refreshPromise?: Promise<string>
  private modelCatalog?: DsnModelCatalog
  private modelCatalogIdentity?: string
  private modelCatalogPromise?: Promise<DsnModelCatalog>
  private modelCatalogGeneration = 0
  private snapshot: DsnAccountSnapshot = { state: 'signed-out' }
  private readonly categoryDefaultModelEntry: CategoryDefaultModelSettings = {}
  private categoryDefaultModelSource: () => CategoryDefaultModelSettings = () => this.categoryDefaultModelEntry

  constructor(ctx: Context, config?: Partial<DsnAccountConfig>) {
    super(ctx, 'dsnAccount')
    this.root = ctx
    this.credentials = ctx.credentials
    this.authorization = ctx.authorization
    this.connection = ctx.connection
    this.desktopLoginRuntime = readDesktopLoginRuntime(ctx)
    this.agentDefaultModel = ctx.agentDefaultModel
    this.config = normalizeConfig(config)
    this.oidc = new OidcClient({
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      resource: this.config.resource,
      scopes: this.config.scopes,
      timeoutMs: this.config.requestTimeoutMs,
    })
    this.accountService = new AccountServiceClient(this.config.accountServiceUrl, fetch, this.config.requestTimeoutMs)

    // DSH 0.1.5 exposes only one global Agent default. CQAI owns the
    // capability-specific defaults in its own optional settings section so an
    // image choice never overwrites the user's chat model.
    if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.installSection(
          ctx,
          CQAI_CATEGORY_DEFAULT_MODELS_SETTINGS_NAMESPACE,
          CategoryDefaultModelSettingsSchema,
          this.categoryDefaultModelEntry,
          {
            setSource: (current) => { this.categoryDefaultModelSource = current },
            onChange: () => {},
          },
        )
      })
    }

    this.registerAuthorizationFlow()
    this.registerRpc()
    this.root.effect(() => () => { this.disposeAuthorization() }, 'cqaiclub-dsn-account: native oauth loopback')
  }

  async getStatus(options: { refreshAccount?: boolean; signal?: AbortSignal } = {}): Promise<DsnAccountSnapshot> {
    if (this.activeAttempt !== undefined) return this.snapshot

    const grant = await this.readGrant()
    if (grant === undefined) {
      // Keep the terminal authorization error visible until the user retries.
      // The settings surface polls while the browser is open; without this
      // guard, the first poll after a failed exchange turns the useful error
      // into a misleading signed-out snapshot because no grant was written.
      if (this.snapshot.state === 'error') return this.snapshot
      this.clearModelCatalog()
      this.setSnapshot({ state: 'signed-out' })
      return this.snapshot
    }
    if (this.modelCatalogIdentity !== undefined && this.modelCatalogIdentity !== modelCatalogIdentity(grant)) {
      this.clearModelCatalog()
    }

    const base = this.snapshotFromGrant(grant)
    this.setSnapshot(base)
    if (!options.refreshAccount) return base

    try {
      await this.getAccount(options.signal)
      return this.snapshot
    } catch (error) {
      if (errorCodeOf(error) === 'DSN_REAUTH_REQUIRED') {
        await this.clearCredential()
        const next: DsnAccountSnapshot = {
          state: 'reauth-required',
          reason: 'CQAI Club 登录已失效，请重新登录。',
        }
        this.setSnapshot(next)
        return next
      }
      const normalized = normalizeUnknownError(error)
      if (!normalized.retryable) {
        const next: DsnAccountSnapshot = {
          state: 'error',
          code: normalized.code,
          message: normalized.message,
          retryable: false,
        }
        this.setSnapshot(next)
        return next
      }
      const warning = normalized.message
      const stale: DsnAccountSnapshot = {
        ...base,
        stale: true,
        warning,
      }
      this.setSnapshot(stale)
      return stale
    }
  }

  async getAccount(signal?: AbortSignal): Promise<PublicAccount> {
    const account = await this.requestWithTokenRefresh(
      (accessToken) => this.accountService.getAccount(accessToken, signal),
      signal,
    )

    await this.updateAccountSnapshot(account)
    return account
  }

  async getTopUpInfo(signal?: AbortSignal): Promise<DsnTopUpInfo> {
    return this.requestWithTokenRefresh(
      (accessToken) => this.accountService.getTopUpInfo(accessToken, signal),
      signal,
    )
  }

  async listTopUps(options: DsnTopUpListOptions = {}, signal?: AbortSignal): Promise<DsnTopUpHistory> {
    return this.requestWithTokenRefresh(
      (accessToken) => this.accountService.listTopUps(accessToken, options, signal),
      signal,
    )
  }

  async createTopUp(request: DsnTopUpRequest, signal?: AbortSignal): Promise<DsnTopUpResult> {
    return this.requestWithTokenRefresh(
      (accessToken) => this.accountService.createTopUp(accessToken, request, signal),
      signal,
    )
  }

  private async launchTopUp(request: DsnTopUpRequest, signal?: AbortSignal): Promise<{ orderId?: string }> {
    const openExternal = this.desktopLoginRuntime?.openExternal
    if (openExternal === undefined) {
      throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', '当前桌面端无法打开支付页面。', true)
    }
    const result = await this.createTopUp(request, signal)
    await launchTopUpPayment(result, openExternal)
    return result.orderId === undefined ? {} : { orderId: result.orderId }
  }

  async listModels(options: DsnModelListOptions = {}): Promise<DsnModelCatalog> {
    const grant = await this.readGrant()
    if (grant === undefined) {
      this.clearModelCatalog()
      throw new DsnAccountError('DSN_AUTH_REQUIRED', '请先登录 CQAI Club。')
    }

    const identity = modelCatalogIdentity(grant)
    if (this.modelCatalogIdentity !== undefined && this.modelCatalogIdentity !== identity) {
      this.clearModelCatalog()
    }
    const cached = this.modelCatalog
    if (!options.refresh
      && cached !== undefined
      && this.modelCatalogIdentity === identity
      && Date.now() - cached.fetchedAt < this.config.modelCatalogCacheTtlMs) {
      return cached
    }
    if (this.modelCatalogPromise !== undefined) return this.modelCatalogPromise

    const generation = this.modelCatalogGeneration
    const request = this.fetchModelCatalog(identity, generation, options.signal)
    this.modelCatalogPromise = request
    try {
      return await request
    } catch (error) {
      const normalized = normalizeUnknownError(error)
      if (normalized.code === 'DSN_REAUTH_REQUIRED') {
        await this.clearCredential()
        this.setSnapshot({
          state: 'reauth-required',
          reason: 'CQAI Club 登录已失效，请重新登录。',
        })
        throw normalized
      }
      if (normalized.retryable
        && cached !== undefined
        && this.modelCatalogIdentity === identity
        && this.modelCatalogGeneration === generation) {
        return {
          ...cached,
          stale: true,
          warning: normalized.message,
        }
      }
      throw normalized
    } finally {
      if (this.modelCatalogPromise === request) this.modelCatalogPromise = undefined
    }
  }

  async getDefaultModel(): Promise<DsnDefaultModelSelection> {
    const selection = this.agentDefaultModel.currentSelection()
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) }),
    }
  }

  async setDefaultModel(model: string): Promise<DsnDefaultModelSelection> {
    const catalog = await this.listModels({ refresh: true })
    const selected = catalog.models.find((candidate) => candidate.id === model && isChatModel(candidate))
    if (selected === undefined) {
      throw new DsnAccountError('DSN_MODEL_UNAVAILABLE', `模型「${model}」当前不可用于 CQAI Club 对话。`)
    }
    const next: DsnDefaultModelSelection = { provider: CQAI_PROVIDER, model: selected.id }
    await this.agentDefaultModel.saveSelection(next)
    return next
  }

  private async adoptOnboardingDefaultModel(signal?: AbortSignal): Promise<DsnDefaultModelSelection> {
    const current = await this.getDefaultModel()
    if (!mayAdoptCqaiOnboardingDefault(current)) return current

    const catalog = await this.listModels({ refresh: true, signal })
    const model = preferredCqaiOnboardingModel(catalog.models)
    if (model === undefined) {
      throw new DsnAccountError('DSN_MODEL_UNAVAILABLE', '当前 CQAI Club 账号没有可用的对话模型。')
    }

    const next: DsnDefaultModelSelection = { provider: CQAI_PROVIDER, model }
    await this.agentDefaultModel.saveSelection(next)
    return next
  }

  async getCategoryDefaultModels(): Promise<DsnCategoryDefaultModels> {
    const current = this.categoryDefaultModelSource()
    const categories: Partial<Record<DsnDefaultModelCategory, DsnDefaultModelSelection>> = {}
    for (const category of DSN_DEFAULT_MODEL_CATEGORY_ORDER) {
      const model = current[category]
      if (model !== undefined) categories[category] = { provider: CQAI_PROVIDER, model }
    }
    return {
      global: copySelection(this.agentDefaultModel.currentSelection()),
      categories,
    }
  }

  async setCategoryDefaultModel(
    category: DsnDefaultModelCategory,
    model: string,
  ): Promise<DsnCategoryDefaultModels> {
    const catalog = await this.listModels({ refresh: true })
    const selected = catalog.models.find(candidate => modelForCategory(candidate, category, model))
    if (selected === undefined) {
      throw new DsnAccountError('DSN_MODEL_UNAVAILABLE', `模型「${model}」当前不可用于 CQAI Club 的${categoryLabel(category)}。`)
    }
    const next: DsnDefaultModelSelection = { provider: CQAI_PROVIDER, model: selected.id }
    if (category === 'text-multimodal') await this.agentDefaultModel.saveSelection(next)
    const settings = typeof this.root.get === 'function' ? this.root.get('settings') : undefined
    if (settings === undefined) {
      this.categoryDefaultModelEntry[category] = selected.id
    } else {
      // update() is intentionally used instead of replace(): the settings
      // provider serializes writes per namespace and merges each category over
      // the last committed value, avoiding lost concurrent selections.
      await settings.update(CQAI_CATEGORY_DEFAULT_MODELS_SETTINGS_NAMESPACE, {
        [category]: selected.id,
      })
    }
    return this.getCategoryDefaultModels()
  }

  private async fetchModelCatalog(
    identity: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<DsnModelCatalog> {
    let accessToken = await this.getValidAccessToken(false, signal)
    let models: readonly DsnModel[]
    try {
      models = await this.accountService.getModels(accessToken, signal)
    } catch (error) {
      if (error instanceof AccountServiceError && error.code === 'DSN_REAUTH_REQUIRED') {
        accessToken = await this.getValidAccessToken(true, signal)
        try {
          models = await this.accountService.getModels(accessToken, signal)
        } catch (retryError) {
          throw normalizeUnknownError(retryError)
        }
      } else {
        throw normalizeUnknownError(error)
      }
    }

    if (this.modelCatalogGeneration !== generation || this.modelCatalogIdentity !== undefined && this.modelCatalogIdentity !== identity) {
      throw new DsnAccountError('DSN_AUTH_REQUIRED', 'CQAI Club 登录已切换，请重试模型目录。')
    }
    const catalog: DsnModelCatalog = {
      models,
      fetchedAt: Date.now(),
      stale: false,
    }
    this.modelCatalogIdentity = identity
    this.modelCatalog = catalog
    return catalog
  }

  async fetchAi(path: `/v1/${string}`, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    let accessToken = await this.getValidAccessToken(false, signal)
    let response: Response
    try {
      response = await this.accountService.fetchAi(accessToken, path, init, signal)
    } catch (error) {
      throw normalizeUnknownError(error)
    }
    if (response.status !== 401) return response

    accessToken = await this.getValidAccessToken(true, signal)
    try {
      return await this.accountService.fetchAi(accessToken, path, init, signal)
    } catch (error) {
      throw normalizeUnknownError(error)
    }
  }

  private async requestWithTokenRefresh<T>(
    request: (accessToken: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let accessToken = await this.getValidAccessToken(false, signal)
    try {
      return await request(accessToken)
    } catch (error) {
      if (!(error instanceof AccountServiceError) || error.code !== 'DSN_REAUTH_REQUIRED') {
        throw normalizeUnknownError(error)
      }
      accessToken = await this.getValidAccessToken(true, signal)
      try {
        return await request(accessToken)
      } catch (retryError) {
        throw normalizeUnknownError(retryError)
      }
    }
  }

  private registerAuthorizationFlow(): void {
    const dispose = this.authorization.registerFlow({
      key: this.credential,
      label: 'CQAI Club',
      methods: [{ id: 'authorization-code', label: '浏览器登录' }],
      run: (session) => this.runAuthorizationCodeFlow(session),
    })
    this.root.effect(() => dispose, 'cqaiclub-dsn-account: authorization flow')
  }

  private registerRpc(): void {
    const handler = (endpoint: string, payload: unknown, signal: AbortSignal) => (
      this.handleRpc(endpoint, payload, signal)
    )

    if (typeof this.root.inject === 'function') {
      this.root.inject(['webServer'], (ctx) => {
        // RC's public rpc facade still resolves its owner from the Connection
        // service context. Use the service's internal owner-aware registration
        // path so this plugin's webServer-injected child owns the route.
        const connection = this.connection as unknown as InternalConnectionService
        if (typeof connection.register === 'function') {
          connection.register(ctx, RPC_CHANNEL, handler)
          return
        }

        // Keep compatibility with older Connection implementations and the
        // runtime unit harness, which expose only rpc.handle().
        const dispose = this.connection.rpc.handle(RPC_CHANNEL, handler)
        ctx.effect(() => () => {
          void dispose()
        }, 'cqaiclub-dsn-account: rpc')
      })
      return
    }

    // Keep the runtime unit harness compatible with its deliberately minimal
    // Context double, which models only the services used by the tests.
    const dispose = this.connection.rpc.handle(RPC_CHANNEL, handler)
    this.root.effect(() => () => {
      void dispose()
    }, 'cqaiclub-dsn-account: rpc')
  }

  private async handleRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    try {
      switch (endpoint) {
        case 'snapshot/get':
          return ok(await this.getStatus({
            refreshAccount: readBoolean(payload, 'refreshAccount'),
            signal,
          }))
        case 'authorization/start':
          return ok(await this.startAuthorization(signal))
        case 'authorization/cancel':
          this.cancelAuthorization(readString(payload, 'attemptId'))
          return ok(await this.getStatus())
        case 'account/refresh':
          return ok(await this.getStatus({ refreshAccount: true, signal }))
        case 'models/list': {
          const refresh = readBoolean(payload, 'refresh')
          const catalog = await this.listModels({
            refresh,
            signal,
          })
          if (refresh) {
            ;(this.root as unknown as { emit(event: string): void }).emit('dsn-account/models-updated')
          }
          return ok(catalog)
        }
        case 'models/default/get':
          return ok(await this.getDefaultModel())
        case 'models/default/set':
          return ok(await this.setDefaultModel(readRequiredText(isObject(payload) ? payload.model : undefined, '默认模型')))
        case 'models/default/adopt-onboarding': {
          const selection = await this.adoptOnboardingDefaultModel(signal)
          ;(this.root as unknown as { emit(event: string): void }).emit('dsn-account/models-updated')
          return ok(selection)
        }
        case 'models/category-defaults/get':
          return ok(await this.getCategoryDefaultModels())
        case 'models/category-defaults/set': {
          const request = readCategoryDefaultModelRequest(payload)
          return ok(await this.setCategoryDefaultModel(request.category, request.model))
        }
        case 'billing/topup/info':
          return ok(await this.getTopUpInfo(signal))
        case 'billing/topups/list':
          return ok(await this.listTopUps(readTopUpListOptions(payload), signal))
        case 'billing/topups/create':
          return ok(await this.createTopUp(readTopUpRequest(payload), signal))
        case 'billing/topups/launch':
          return ok(await this.launchTopUp(readTopUpRequest(payload), signal))
        case 'session/logout': {
          const result = await this.logout(signal)
          return ok({ snapshot: this.snapshot, ...result })
        }
        default:
          return failure('DSN_PROTOCOL_ERROR', '未知的 CQAI Club RPC 操作')
      }
    } catch (error) {
      return failure(errorCodeOf(error), safeErrorMessage(error), isRetryable(error))
    }
  }

  private async startAuthorization(signal?: AbortSignal): Promise<DsnAccountSnapshot> {
    if (this.activeAttempt !== undefined) return this.snapshot
    if (!this.config.clientId.trim()) {
      const next: DsnAccountSnapshot = {
        state: 'error',
        code: 'DSN_CONFIG_INVALID',
        message: '管理员尚未配置 CQAI Club Authorization Code Client ID。',
        retryable: false,
      }
      this.setSnapshot(next)
      return next
    }

    const attemptId = randomUUID()
    const callbackServer = await openLoopbackCallbackServer(
      OAUTH_CALLBACK_PATH,
      (request, response) => this.handleOAuthCallback(request, response),
      signal,
    )
    let request: AuthorizationRequest
    try {
      request = await this.oidc.createAuthorizationRequest(
        callbackServer.redirectUri,
        { prompt: Prompt.Login },
        signal,
      )
    } catch (cause) {
      await callbackServer.close()
      throw cause
    }
    const deferred = createDeferred<string>()
    const pending: PendingAuthorization = {
      attemptId,
      state: request.state,
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
      callbackServer,
      timer: setTimeout(() => {
        if (this.pendingAuthorization !== pending) return
        this.clearPendingAuthorization(pending)
        pending.reject(new DsnAccountError('DSN_LOGIN_EXPIRED', 'CQAI Club 登录页已过期，请重新开始登录。'))
      }, Math.max(0, request.expiresAt - Date.now())),
    }
    const active: ActiveAttempt = { id: attemptId, request, redirectUri: callbackServer.redirectUri }
    this.activeAttempt = active
    this.pendingAuthorization = pending
    this.setSnapshot({
      state: 'authorizing',
      attemptId,
      message: '请在浏览器中完成 CQAI Club 登录。',
      authorizationUrl: request.authorizationUrl,
      expiresAt: request.expiresAt,
    })

    const interaction: AuthorizationInteraction = {
      notify: (notice) => this.noticeForAttempt(attemptId, notice),
      prompt: async () => {
        throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 浏览器登录不需要额外输入')
      },
    }
    const promise = this.authorization.begin({
      key: this.credential,
      method: 'authorization-code',
      interaction,
    }).then((outcome) => {
      if (outcome.status === 'authorized') {
        return this.refreshSnapshotFromGrant()
      }
      this.setSnapshot({ state: 'signed-out' })
    }).catch((error: unknown) => {
      if (this.activeAttempt?.id !== attemptId) return
      if (isAbortError(error) || errorCodeOf(error) === 'DSN_LOGIN_CANCELLED') {
        this.setSnapshot({ state: 'signed-out' })
        return
      }
      this.logAuthorizationFailure(error)
      const normalized = normalizeUnknownError(error)
      this.setSnapshot({
        state: 'error',
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      })
    }).finally(() => {
      if (this.activeAttempt?.id === attemptId) this.activeAttempt = undefined
      this.clearPendingAuthorization(pending)
    })

    active.promise = promise
    if (this.desktopLoginRuntime?.openExternal !== undefined) {
      try {
        await this.desktopLoginRuntime.openExternal(request.authorizationUrl)
      } catch {
        this.setSnapshot({
          state: 'authorizing',
          attemptId,
          message: '未能自动打开系统浏览器，请点击“重新打开浏览器”。',
          authorizationUrl: request.authorizationUrl,
          expiresAt: request.expiresAt,
        })
      }
    }
    return this.snapshot
  }

  private cancelAuthorization(attemptId: string | undefined): void {
    if (this.activeAttempt === undefined) return
    if (attemptId !== undefined && attemptId !== this.activeAttempt.id) return
    const pending = this.pendingAuthorization
    if (pending !== undefined && pending.attemptId === this.activeAttempt.id) {
      this.clearPendingAuthorization(pending)
      pending.reject(new DsnAccountError('DSN_LOGIN_CANCELLED', 'CQAI Club 登录已取消。'))
    }
    this.authorization.cancel(this.credential)
  }

  private noticeForAttempt(attemptId: string, notice: { message: string; url?: string; code?: string }): void {
    const active = this.activeAttempt
    if (active === undefined || active.id !== attemptId) return
    this.setSnapshot({
      state: 'authorizing',
      attemptId,
      message: notice.message,
      authorizationUrl: active.request.authorizationUrl,
      expiresAt: active.request.expiresAt,
    })
  }

  private async runAuthorizationCodeFlow(session: AuthorizationSession): Promise<void> {
    if (!this.config.clientId.trim()) {
      throw new DsnAccountError('DSN_CONFIG_INVALID', '管理员尚未配置 CQAI Club Authorization Code Client ID。')
    }

    const attempt = this.activeAttempt
    if (attempt === undefined) throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 登录流程已失效。')

    session.notify({ message: '请在浏览器中完成 CQAI Club 登录。', url: attempt.request.authorizationUrl })
    const code = await this.waitForAuthorizationCode(attempt.id, session.signal)
    session.notify({ message: '正在验证 CQAI Club 登录凭据…' })
    let token = await this.oidc.exchangeAuthorizationCode(
      code,
      attempt.redirectUri,
      attempt.request.codeVerifier,
      session.signal,
    )
    token = await this.ensureResourceToken(token, session.signal)

    const expiresAt = attempt.request.expiresAt
    let transientFailures = 0
    let account: PublicAccount
    session.notify({ message: '正在读取 CQAI Club 账号…' })
    while (true) {
      try {
        account = await this.accountService.getAccount(token.accessToken, session.signal)
        break
      } catch (error) {
        const normalized = normalizeUnknownError(error)
        if (!normalized.retryable || Date.now() >= expiresAt) throw normalized
        transientFailures += 1
        const retryDelay = Math.min(30_000, Math.max(5_000, 5_000 + transientFailures * 2_000))
        session.notify({ message: '账号服务暂时不可用，正在重试验证…' })
        await delay(retryDelay, session.signal)
      }
    }

    const payload: GrantPayload = {
      version: 1,
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      resource: this.config.resource,
      scope: token.scope?.split(/\s+/u).filter(Boolean) ?? [...this.config.scopes],
      accessToken: token.accessToken,
      ...(token.refreshToken === undefined ? {} : { refreshToken: token.refreshToken }),
      accessTokenExpiresAt: Date.now() + token.expiresIn * 1000,
      account,
      accountFetchedAt: Date.now(),
    }
    await this.credentials.modifyRecord(this.credential, async () => ({ kind: 'grant', payload }))
    this.clearModelCatalog()
    this.setSnapshot(this.snapshotFromGrant(payload))
    void this.listModels({ refresh: true }).catch(() => undefined)
    session.notify({ message: 'CQAI Club 登录成功。' })
  }

  private logAuthorizationFailure(error: unknown): void {
    const normalized = normalizeUnknownError(error)
    const status = error instanceof AccountServiceError ? String(error.status) : '-'
    this.root.logger.warn(
      'cqaiclub-dsn-account: authorization failed code=%s status=%s message=%s',
      normalized.code,
      status,
      normalized.message,
    )
  }

  private async waitForAuthorizationCode(attemptId: string, signal: AbortSignal): Promise<string> {
    const pending = this.pendingAuthorization
    if (pending === undefined || pending.attemptId !== attemptId) {
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 登录回调已失效。')
    }
    if (signal.aborted) throw signal.reason ?? new DsnAccountError('DSN_LOGIN_CANCELLED', 'CQAI Club 登录已取消。')
    const abort = () => pending.reject(new DsnAccountError('DSN_LOGIN_CANCELLED', 'CQAI Club 登录已取消。'))
    signal.addEventListener('abort', abort, { once: true })
    try {
      return await pending.promise
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private clearPendingAuthorization(pending: PendingAuthorization): void {
    clearTimeout(pending.timer)
    if (this.pendingAuthorization === pending) this.pendingAuthorization = undefined
    void pending.callbackServer.close().catch(() => undefined)
  }

  private async handleOAuthCallback(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET') {
      respondOAuth(response, 405, '登录回调方法不支持', '请返回 DSH 后重新登录。')
      return
    }

    let callback: URL
    try {
      callback = new URL(request.url ?? '/', 'http://127.0.0.1')
    } catch {
      respondOAuth(response, 400, '登录回调无效', '请返回 DSH 后重新登录。')
      return
    }

    const pending = this.pendingAuthorization
    if (pending === undefined || callback.searchParams.get('state') !== pending.state) {
      respondOAuth(response, 400, '登录回调已失效', '请返回 DSH 后重新开始登录。')
      return
    }

    const error = callback.searchParams.get('error')
    if (error !== null) {
      this.clearPendingAuthorization(pending)
      pending.reject(error === 'access_denied'
        ? new DsnAccountError('DSN_LOGIN_CANCELLED', 'CQAI Club 登录被取消。')
        : new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 登录未完成。'))
      this.showDesktop()
      respondOAuth(response, 200, '登录未完成', '本次登录未完成，请返回 DSH 重试。')
      return
    }

    const code = callback.searchParams.get('code')
    if (code === null || code.length === 0) {
      respondOAuth(response, 400, '登录回调缺少授权码', '请返回 DSH 后重新开始登录。')
      return
    }

    this.clearPendingAuthorization(pending)
    const active = this.activeAttempt
    if (active !== undefined && active.id === pending.attemptId) {
      this.setSnapshot({
        state: 'authorizing',
        attemptId: pending.attemptId,
        message: '已返回 DSH，正在安全写入账号信息…',
        authorizationUrl: active.request.authorizationUrl,
        expiresAt: active.request.expiresAt,
      })
    }
    pending.resolve(code)
    this.showDesktop()
    respondOAuth(
      response,
      200,
      '已收到登录回调',
      '浏览器登录已完成，DSH 正在验证账号。',
      this.desktopLoginRuntime?.loginCompletionUrl,
    )
  }

  private showDesktop(): void {
    try {
      this.desktopLoginRuntime?.show?.()
    } catch {
      // Login remains valid if the native shell is already closing or restarting.
    }
  }

  private disposeAuthorization(): void {
    const pending = this.pendingAuthorization
    if (pending === undefined) return
    this.clearPendingAuthorization(pending)
    pending.reject(new DsnAccountError('DSN_LOGIN_CANCELLED', 'CQAI Club 登录已取消。'))
    this.authorization.cancel(this.credential)
  }

  private async ensureResourceToken(token: TokenResponse, signal?: AbortSignal): Promise<TokenResponse> {
    if (isJwtAccessToken(token.accessToken)) return token
    if (token.refreshToken === undefined) {
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 未返回可用于 Account Service 的资源 Token。')
    }
    const refreshed = await this.oidc.refreshAccessToken(token.refreshToken, signal)
    if (!isJwtAccessToken(refreshed.accessToken)) {
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 返回的资源 Token 不是 JWT。')
    }
    return {
      ...refreshed,
      ...(refreshed.refreshToken === undefined ? { refreshToken: token.refreshToken } : {}),
    }
  }

  private async getValidAccessToken(forceRefresh: boolean, signal?: AbortSignal): Promise<string> {
    const grant = await this.readGrant()
    if (grant === undefined) throw new DsnAccountError('DSN_AUTH_REQUIRED', '请先登录 CQAI Club。')
    if (!forceRefresh && grant.accessTokenExpiresAt > Date.now() + 60_000) return grant.accessToken
    if (this.refreshPromise !== undefined) return this.refreshPromise

    const refresh = this.refreshGrant(signal, forceRefresh)
    this.refreshPromise = refresh
    try {
      return await refresh
    } finally {
      if (this.refreshPromise === refresh) this.refreshPromise = undefined
    }
  }

  private async refreshGrant(signal?: AbortSignal, forceRefresh = false): Promise<string> {
    let shouldClear = false
    try {
      const record = await this.credentials.modifyRecord(this.credential, async (current) => {
        const grant = readGrantPayload(current)
        if (grant === undefined) throw new DsnAccountError('DSN_AUTH_REQUIRED', '请先登录 CQAI Club。')
        if (!forceRefresh && grant.accessTokenExpiresAt > Date.now() + 60_000) return current
        if (grant.refreshToken === undefined) {
          shouldClear = true
          throw new DsnAccountError('DSN_REAUTH_REQUIRED', 'CQAI Club 登录已失效，请重新登录。')
        }
        try {
          const token = await this.oidc.refreshAccessToken(grant.refreshToken, signal)
          const next: GrantPayload = {
            ...grant,
            accessToken: token.accessToken,
            ...(token.refreshToken === undefined ? {} : { refreshToken: token.refreshToken }),
            accessTokenExpiresAt: Date.now() + token.expiresIn * 1000,
            scope: token.scope?.split(/\s+/u).filter(Boolean) ?? grant.scope,
          }
          return { kind: 'grant', payload: next }
        } catch (error) {
          if (errorCodeOf(error) === 'DSN_REAUTH_REQUIRED') shouldClear = true
          throw normalizeUnknownError(error)
        }
      })
      const grant = readGrantPayload(record)
      if (grant === undefined) throw new DsnAccountError('DSN_AUTH_REQUIRED', '请先登录 CQAI Club。')
      return grant.accessToken
    } catch (error) {
      if (shouldClear) await this.clearCredential()
      throw normalizeUnknownError(error)
    }
  }

  private async updateAccountSnapshot(account: PublicAccount): Promise<void> {
    const record = await this.credentials.modifyRecord(this.credential, async (current) => {
      const grant = readGrantPayload(current)
      if (grant === undefined) return current
      return {
        kind: 'grant',
        payload: {
          ...grant,
          account,
          accountFetchedAt: Date.now(),
        },
      }
    })
    const grant = readGrantPayload(record)
    if (grant !== undefined) this.setSnapshot(this.snapshotFromGrant(grant))
  }

  private async logout(signal?: AbortSignal): Promise<LogoutResult> {
    const grant = await this.readGrant()
    if (grant === undefined) {
      this.clearModelCatalog()
      this.setSnapshot({ state: 'signed-out' })
      return { remoteRevoked: true }
    }

    let remoteRevoked = false
    let warning: string | undefined
    const token = grant.refreshToken ?? grant.accessToken

    // Local sign-out is authoritative for this DSH profile. Clear the grant
    // and publish the new snapshot before the best-effort remote revoke, which
    // may involve network discovery and can be slow or unavailable.
    await this.clearCredential()
    this.setSnapshot({ state: 'signed-out' })
    try {
      remoteRevoked = await this.oidc.revoke(token, grant.refreshToken === undefined ? 'access_token' : 'refresh_token', signal)
      if (!remoteRevoked) warning = '本地已退出，但远端授权未确认撤销。'
    } catch {
      warning = '本地已退出，但远端授权未确认撤销。'
    }
    return { remoteRevoked, ...(warning === undefined ? {} : { warning }) }
  }

  private async refreshSnapshotFromGrant(): Promise<void> {
    const grant = await this.readGrant()
    if (grant === undefined) {
      this.clearModelCatalog()
      this.setSnapshot({ state: 'signed-out' })
      return
    }
    this.setSnapshot(this.snapshotFromGrant(grant))
  }

  private async readGrant(): Promise<GrantPayload | undefined> {
    const record = await this.credentials.readRecord(this.credential)
    return readGrantPayload(record)
  }

  private async clearCredential(): Promise<void> {
    this.clearModelCatalog()
    await this.credentials.deleteRecord(this.credential)
  }

  private clearModelCatalog(): void {
    this.modelCatalog = undefined
    this.modelCatalogIdentity = undefined
    this.modelCatalogPromise = undefined
    this.modelCatalogGeneration += 1
  }

  private snapshotFromGrant(grant: GrantPayload): Extract<DsnAccountSnapshot, { state: 'signed-in' }> {
    return {
      state: 'signed-in',
      account: grant.account,
      remainingQuota: remainingQuota(grant.account),
      refreshedAt: grant.accountFetchedAt,
      stale: false,
    }
  }

  private setSnapshot(snapshot: DsnAccountSnapshot): void {
    if (sameSnapshot(this.snapshot, snapshot)) return
    this.snapshot = snapshot
    ;(this.root as unknown as { emit(event: string, value: DsnAccountSnapshot): void }).emit('dsn-account/changed', snapshot)
  }
}

export function apply(ctx: Context, config?: Partial<DsnAccountConfig>): void {
  const runtime = new DsnAccountServiceRuntime(ctx, config)
  bindCqaiModelRoute(ctx, runtime)
}

function readGrantPayload(record: CredentialRecord | undefined): GrantPayload | undefined {
  if (record?.kind !== 'grant' || record.payload === null || typeof record.payload !== 'object') return undefined
  const payload = record.payload as Partial<GrantPayload>
  if (payload.version !== 1
    || typeof payload.issuer !== 'string'
    || typeof payload.clientId !== 'string'
    || typeof payload.resource !== 'string'
    || !Array.isArray(payload.scope)
    || !payload.scope.every((item) => typeof item === 'string')
    || typeof payload.accessToken !== 'string'
    || typeof payload.accessTokenExpiresAt !== 'number'
    || !isPublicAccount(payload.account)
    || typeof payload.accountFetchedAt !== 'number') return undefined
  return payload as GrantPayload
}

function modelCatalogIdentity(grant: GrantPayload): string {
  return `${grant.account.platform}:${grant.account.userId}`
}

function copySelection(selection: DsnDefaultModelSelection): DsnDefaultModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) }),
  }
}

function modelForCategory(
  candidate: DsnModel,
  category: DsnDefaultModelCategory,
  model: string,
): boolean {
  if (candidate.id !== model) return false
  return isModelInCategory(candidate, category)
}

function categoryLabel(category: DsnDefaultModelCategory): string {
  switch (category) {
    case 'image': return '生图'
    case 'text-multimodal': return '文本（多模态）'
    case 'video': return '视频'
    case 'audio': return '音频'
    case 'other': return '其他'
  }
}

function readBoolean(payload: unknown, key: string): boolean {
  return isObject(payload) && payload[key] === true
}

function readTopUpRequest(payload: unknown): DsnTopUpRequest {
  if (!isObject(payload)) throw new DsnAccountError('DSN_PROTOCOL_ERROR', '充值请求无效')
  const paymentOptionId = readRequiredText(payload.paymentOptionId, '充值方式')
  const amount = readOptionalPositiveInteger(payload.amount, '充值金额')
  const productId = readOptionalText(payload.productId, '充值套餐')
  const choiceId = readOptionalText(payload.choiceId, '支付方式')
  return {
    paymentOptionId,
    ...(amount === undefined ? {} : { amount }),
    ...(productId === undefined ? {} : { productId }),
    ...(choiceId === undefined ? {} : { choiceId }),
  }
}

function readCategoryDefaultModelRequest(payload: unknown): {
  category: DsnDefaultModelCategory
  model: string
} {
  if (!isObject(payload)) throw new DsnAccountError('DSN_PROTOCOL_ERROR', '分类默认模型请求无效')
  const category = readRequiredText(payload.category, '模型用途')
  if (!isDsnDefaultModelCategory(category)) {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', '模型用途无效')
  }
  return {
    category,
    model: readRequiredText(payload.model, '默认模型'),
  }
}

function readTopUpListOptions(payload: unknown): DsnTopUpListOptions {
  if (!isObject(payload)) return {}
  const page = readOptionalPositiveInteger(payload.page, '页码')
  const pageSize = readOptionalPositiveInteger(payload.pageSize, '每页数量')
  const keyword = payload.keyword === undefined ? undefined : readOptionalText(payload.keyword, '搜索关键词')
  return {
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(keyword === undefined ? {} : { keyword }),
  }
}

function readRequiredText(value: unknown, field: string): string {
  const text = readOptionalText(value, field)
  if (text === undefined) throw new DsnAccountError('DSN_PROTOCOL_ERROR', `${field}不能为空`)
  return text
}

function readOptionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 255) {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', `${field}无效`)
  }
  return value.trim()
}

function readOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', `${field}无效`)
  }
  return value as number
}

function readString(payload: unknown, key: string): string | undefined {
  const value = isObject(payload) ? payload[key] : undefined
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isObject(value: unknown): value is RpcPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ok(value: unknown): ConnectionRpcResult<unknown> {
  return { ok: true, value }
}

function failure(code: string, message: string, retryable = false): ConnectionRpcResult<unknown> {
  const error: ConnectionRpcFailure = {
    code,
    message,
    details: { retryable },
  }
  return { ok: false, error }
}

function normalizeUnknownError(error: unknown): DsnAccountError {
  if (error instanceof DsnAccountError) return error
  if (error instanceof AccountServiceError) return error
  if (isAbortError(error)) return new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', '请求已取消', true, { cause: error })
  return new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', 'CQAI Club 服务暂时不可用', true, { cause: error })
}

function isRetryable(error: unknown): boolean {
  return error instanceof DsnAccountError ? error.retryable : true
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function isJwtAccessToken(value: string): boolean {
  return value.split('.').length === 3 && value.split('.').every((part) => part.length > 0)
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function readDesktopLoginRuntime(ctx: Context): DesktopLoginRuntime | undefined {
  const source = ctx as unknown as {
    get?: (name: string) => unknown
    desktopRuntime?: unknown
  }
  const candidate = typeof source.get === 'function'
    ? source.get('desktopRuntime')
    : source.desktopRuntime
  if (candidate === null || typeof candidate !== 'object') return undefined
  const openExternal = (candidate as { openExternal?: unknown }).openExternal
  const show = (candidate as { show?: unknown }).show
  const loginCompletionUrl = readLoginCompletionUrl((candidate as { loginCompletionUrl?: unknown }).loginCompletionUrl)
  if (typeof openExternal !== 'function' && typeof show !== 'function' && loginCompletionUrl === undefined) return undefined
  return {
    ...(typeof openExternal === 'function'
      ? { openExternal: (target: string) => (candidate as Required<Pick<DesktopLoginRuntime, 'openExternal'>>).openExternal(target) }
      : {}),
    ...(typeof show === 'function'
      ? { show: () => (candidate as Required<Pick<DesktopLoginRuntime, 'show'>>).show() }
      : {}),
    ...(loginCompletionUrl === undefined ? {} : { loginCompletionUrl }),
  }
}

function readLoginCompletionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (!['dsh-desktop:', 'dsh-desktop-beta:'].includes(url.protocol)) return undefined
    if (url.hostname !== 'oauth' || url.pathname !== '/complete') return undefined
    if (url.username || url.password || url.search || url.hash) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function respondOAuth(
  response: ServerResponse,
  status: number,
  title: string,
  message: string,
  loginCompletionUrl?: string,
): void {
  const success = title === '已收到登录回调'
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  const openDesktop = success && loginCompletionUrl !== undefined
    ? `<a class="open" href="${escapeHtml(loginCompletionUrl)}">打开 易宝工坊</a><p class="return">如果没有自动返回，请点击按钮继续。</p>`
    : ''
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${safeTitle}</title><style>:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f6f8;color:#18202a}.card{width:min(100%,420px);padding:34px;border:1px solid #dce2e8;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgba(19,35,55,.10);text-align:center}.mark{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 20px;border-radius:15px;background:${success ? '#e8f7ef' : '#fff3e5'};color:${success ? '#16834b' : '#a65a00'};font-size:26px;font-weight:700}h1{margin:0 0 10px;font-size:22px;line-height:1.3}p{margin:0;color:#627083;font-size:14px;line-height:1.65}.open{display:inline-flex;align-items:center;justify-content:center;min-height:42px;margin-top:24px;padding:0 20px;border-radius:10px;background:#1769d3;color:#fff;text-decoration:none;font-size:14px;font-weight:650;box-shadow:0 7px 18px rgba(23,105,211,.22)}.open:hover{background:#0f5abb}.return{margin-top:10px;font-size:12px}.hint{margin-top:22px;padding-top:18px;border-top:1px solid #edf0f3;font-size:12px}@media(prefers-color-scheme:dark){body{background:#11151a;color:#eef2f6}.card{border-color:#2d343d;background:#1a2027;box-shadow:0 18px 50px rgba(0,0,0,.3)}p{color:#9ca9b8}.hint{border-color:#2d343d}}</style></head><body><main class="card"><div class="mark" aria-hidden="true">${success ? '&#10003;' : '!'}</div><h1>${safeTitle}</h1><p>${safeMessage}</p>${openDesktop}<p class="hint">现在可以关闭此页面。</p></main></body></html>`)
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
