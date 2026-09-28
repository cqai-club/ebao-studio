export const DEFAULT_ISSUER = 'https://auth.cqaiclub.asia/oidc'
export const DEFAULT_RESOURCE = 'https://account.cqaiclub.asia'
export const DEFAULT_ACCOUNT_SERVICE_URL = 'https://account.cqaiclub.asia'
export const DEFAULT_SCOPES = [
  'openid',
  'offline_access',
  'profile',
  'email',
  'ai:invoke',
] as const

export const RPC_CHANNEL = '/cqaiclub-dsn-account'
export const CREDENTIAL_SCOPE = 'cqaiclub-dsn-account'
export const CREDENTIAL_ID = 'primary'
export const MODEL_CATALOG_CACHE_TTL_MS = 60_000

export type DsnModelCategory =
  | 'image'
  | 'video'
  | 'text'
  | 'text-multimodal'
  | 'audio'
  | 'other'

export type DsnDefaultModelCategory = 'image' | 'text-multimodal' | 'video' | 'audio' | 'other'

export const DSN_DEFAULT_MODEL_CATEGORY_ORDER = [
  'image',
  'text-multimodal',
  'video',
  'audio',
  'other',
] as const satisfies readonly DsnDefaultModelCategory[]

export const DSN_MODEL_CATEGORY_ORDER = [
  'image',
  'video',
  'text-multimodal',
  'text',
  'audio',
  'other',
] as const satisfies readonly DsnModelCategory[]

const AUDIO_MODALITIES = new Set(['audio', 'speech', 'transcription'])

export type DsnModelArchitecture = {
  modality?: string
  inputModalities: readonly string[]
  outputModalities: readonly string[]
}

export type DsnModel = {
  id: string
  ownedBy: string
  canonicalSlug?: string
  name?: string
  vendor?: string
  description?: string
  icon?: string
  architecture?: DsnModelArchitecture
  supportedParameters?: readonly string[]
  contextLength?: number
  maxOutputTokens?: number
  categories: readonly DsnModelCategory[]
  supportedEndpointTypes: readonly string[]
}

/** Whether a model can be used by the ordinary CQAI Club conversation route. */
export function isChatModel(model: DsnModel): boolean {
  if (!model.supportedEndpointTypes.includes('openai')) return false
  if (model.architecture !== undefined) {
    return model.architecture.inputModalities.includes('text')
      && model.architecture.outputModalities.includes('text')
  }
  return model.categories.some(category => category === 'text' || category === 'text-multimodal' || category === 'other')
}

/** Whether a chat model accepts image input. */
export function isVisionChatModel(model: DsnModel): boolean {
  if (!isChatModel(model)) return false
  if (model.architecture !== undefined) return model.architecture.inputModalities.includes('image')
  return model.categories.includes('text-multimodal')
}

/** Whether a catalog entry can serve the OpenAI-compatible image endpoints. */
export function isImageGenerationModel(model: DsnModel): boolean {
  if (!model.supportedEndpointTypes.includes('image-generation')) return false
  if (model.architecture !== undefined) return model.architecture.outputModalities.includes('image')
  return model.categories.includes('image')
}

/** Video identity for catalog display, including Wan aliases with incomplete metadata. */
export function isVideoCatalogEntry(model: DsnModel): boolean {
  return model.categories.includes('video')
    || model.architecture?.outputModalities.includes('video') === true
    || /^wan3\.0-video(?:-(?:480|720|1080)p)?$/i.test(model.id)
}

/** Whether a catalog entry can serve the OpenAI-compatible video endpoints. */
export function isVideoModel(model: DsnModel): boolean {
  if (!model.supportedEndpointTypes.includes('openai-video')) return false
  const outputs = model.architecture?.outputModalities ?? []
  if (outputs.length > 0) return outputs.includes('video')
  return isVideoCatalogEntry(model)
}

/** Whether a catalog entry consumes or produces an audio-family modality. */
export function isAudioModel(model: DsnModel): boolean {
  if (model.architecture === undefined) return model.categories.includes('audio')
  return model.architecture.inputModalities.some(modality => AUDIO_MODALITIES.has(modality))
    || model.architecture.outputModalities.some(modality => AUDIO_MODALITIES.has(modality))
}

/** Apply the shared model-capability rules used by defaults and business plugins. */
export function isModelInCategory(model: DsnModel, category: DsnDefaultModelCategory): boolean {
  switch (category) {
    case 'image': return isImageGenerationModel(model)
    case 'text-multimodal': return isVisionChatModel(model)
    case 'video': return isVideoModel(model)
    case 'audio': return isAudioModel(model)
    case 'other':
      if (model.architecture === undefined) return model.categories.includes('other')
      return !isChatModel(model)
        && !isImageGenerationModel(model)
        && !isVideoModel(model)
        && !isAudioModel(model)
  }
}

export type DsnModelCatalog = {
  models: readonly DsnModel[]
  fetchedAt: number
  stale: boolean
  warning?: string
}

export type DsnDefaultModelSelection = {
  provider: string
  model: string
  reasoningEffort?: string
}

export type DsnCategoryDefaultModels = {
  global: DsnDefaultModelSelection
  categories: Partial<Record<DsnDefaultModelCategory, DsnDefaultModelSelection>>
}

export type DsnModelListOptions = {
  refresh?: boolean
  signal?: AbortSignal
}

export type PublicAccount = {
  userId: number
  platform: string
  displayName?: string
  username?: string
  email?: string
  tokenId?: number | string
  /** NewAPI wallet quota remaining in raw quota units. */
  quota?: number
  /** NewAPI wallet quota used cumulatively in raw quota units. */
  quotaUsed?: number
  /** Current DSN token/key quota remaining in raw quota units. */
  tokenQuota?: number
  /** Current DSN token/key quota used cumulatively in raw quota units. */
  tokenQuotaUsed?: number
  /** A limited key takes its balance from tokenQuota; an unlimited key uses the wallet. */
  tokenUnlimitedQuota?: boolean
  quotaDisplayType?: string
  quotaPerUnit?: number
  usdExchangeRate?: number
  customCurrencySymbol?: string
  customCurrencyExchangeRate?: number
}

export type DsnTopUpOption = {
  id: string
  name: string
  kind: 'amount' | 'product'
  minTopUp?: number
  choices?: readonly { id: string; name: string }[]
  products?: readonly {
    id: string
    name: string
    price: number
    currency: string
    quota: number
  }[]
}

export type DsnTopUpInfo = {
  paymentOptions: readonly DsnTopUpOption[]
  amountOptions: readonly number[]
  minTopUp?: number
}

export type DsnTopUpListOptions = {
  page?: number
  pageSize?: number
  keyword?: string
}

export type DsnTopUpRequest = {
  paymentOptionId: string
  amount?: number
  productId?: string
  choiceId?: string
}

export type DsnTopUpResult = {
  paymentUrl?: string
  paymentFields?: Readonly<Record<string, string>>
  orderId?: string
}

export type DsnTopUpRecord = {
  id?: number
  amount?: number
  money?: number
  tradeNo?: string
  paymentMethod?: string
  paymentProvider?: string
  createTime?: number
  completeTime?: number
  status?: string
}

export type DsnTopUpHistory = {
  page: number
  pageSize: number
  total: number
  items: readonly DsnTopUpRecord[]
}

export type DsnAccountErrorCode =
  | 'DSN_AUTH_REQUIRED'
  | 'DSN_REAUTH_REQUIRED'
  | 'DSN_ACCOUNT_UNAVAILABLE'
  | 'DSN_MODEL_UNAVAILABLE'
  | 'DSN_CLIENT_FORBIDDEN'
  | 'DSN_SCOPE_FORBIDDEN'
  | 'DSN_CONFIG_INVALID'
  | 'DSN_LOGIN_EXPIRED'
  | 'DSN_LOGIN_CANCELLED'
  | 'DSN_PROTOCOL_ERROR'
  | 'DSN_REMOTE_REVOKE_FAILED'

export type BrowserAuthorizationNotice = {
  message: string
  authorizationUrl: string
  expiresAt: number
}

export type DsnAccountSnapshot =
  | { state: 'signed-out' }
  | ({ state: 'authorizing' } & BrowserAuthorizationNotice & { attemptId: string })
  | {
      state: 'signed-in'
      account: PublicAccount
      remainingQuota?: number
      refreshedAt: number
      stale: boolean
      warning?: string
    }
  | { state: 'reauth-required'; reason: string }
  | {
      state: 'error'
      code: DsnAccountErrorCode
      message: string
      retryable: boolean
    }

export type DsnAccountConfig = {
  issuer: string
  clientId: string
  resource: string
  accountServiceUrl: string
  scopes: readonly string[]
  requestTimeoutMs: number
  modelCatalogCacheTtlMs: number
}

export type GrantPayload = {
  version: 1
  issuer: string
  clientId: string
  resource: string
  scope: readonly string[]
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt: number
  account: PublicAccount
  accountFetchedAt: number
}

export type DsnAccountService = {
  getStatus(options?: { refreshAccount?: boolean; signal?: AbortSignal }): Promise<DsnAccountSnapshot>
  getAccount(signal?: AbortSignal): Promise<PublicAccount>
  listModels(options?: DsnModelListOptions): Promise<DsnModelCatalog>
  getDefaultModel(): Promise<DsnDefaultModelSelection>
  setDefaultModel(model: string): Promise<DsnDefaultModelSelection>
  getCategoryDefaultModels(): Promise<DsnCategoryDefaultModels>
  setCategoryDefaultModel(category: DsnDefaultModelCategory, model: string): Promise<DsnCategoryDefaultModels>
  getTopUpInfo(signal?: AbortSignal): Promise<DsnTopUpInfo>
  listTopUps(options?: DsnTopUpListOptions, signal?: AbortSignal): Promise<DsnTopUpHistory>
  createTopUp(request: DsnTopUpRequest, signal?: AbortSignal): Promise<DsnTopUpResult>
  fetchAi(path: `/v1/${string}`, init?: RequestInit, signal?: AbortSignal): Promise<Response>
}

export type LogoutResult = {
  remoteRevoked: boolean
  warning?: string
}

export function remainingQuota(account: PublicAccount): number | undefined {
  if (account.tokenUnlimitedQuota === false) {
    return account.tokenQuota === undefined ? undefined : Math.max(0, account.tokenQuota)
  }
  return account.quota === undefined ? undefined : Math.max(0, account.quota)
}

export function isPublicAccount(value: unknown): value is PublicAccount {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const account = value as Record<string, unknown>
  return typeof account.userId === 'number'
    && Number.isFinite(account.userId)
    && typeof account.platform === 'string'
    && account.platform.length > 0
    && optionalString(account.displayName)
    && optionalString(account.username)
    && optionalString(account.email)
    && optionalNumberOrString(account.tokenId)
    && optionalNumber(account.quota)
    && optionalNumber(account.quotaUsed)
    && optionalNumber(account.tokenQuota)
    && optionalNumber(account.tokenQuotaUsed)
    && optionalBoolean(account.tokenUnlimitedQuota)
    && optionalString(account.quotaDisplayType)
    && optionalNumber(account.quotaPerUnit)
    && optionalNumber(account.usdExchangeRate)
    && optionalString(account.customCurrencySymbol)
    && optionalNumber(account.customCurrencyExchangeRate)
}

function optionalNumber(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value))
}

function optionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0)
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function optionalNumberOrString(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length > 0)
}

export function parseDsnModelList(value: unknown): DsnModel[] {
  if (!Array.isArray(value)) throw new Error('model list must be an array')

  const models: DsnModel[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`model at index ${index} is not an object`)
    }
    const record = item as Record<string, unknown>
    const id = requiredString(record.id, `model at index ${index} has no id`)
    const ownedBy = requiredString(
      record.owned_by,
      `model ${id} has no owned_by value`,
    )
    const categories = parseCategories(record.categories, id)
    const supportedEndpointTypes = parseStringArray(
      record.supported_endpoint_types,
      `model ${id} has invalid supported_endpoint_types`,
    )
    const architecture = parseArchitecture(record.architecture, id)
    const supportedParameters = parseOptionalStringArray(
      record.supported_parameters,
      `model ${id} has invalid supported_parameters`,
    )
    const contextLength = parseModelLimit(record.context_length, 'context_length', id)
    const maxOutputTokens = parseModelLimit(record.max_output_tokens, 'max_output_tokens', id)
    if (seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      ownedBy,
      ...optionalModelString(record.canonical_slug, 'canonical_slug', id, 'canonicalSlug'),
      ...optionalModelString(record.name, 'name', id),
      ...optionalModelString(record.vendor, 'vendor', id),
      ...optionalModelString(record.description, 'description', id),
      ...optionalModelString(record.icon, 'icon', id),
      ...(architecture === undefined ? {} : { architecture }),
      ...(supportedParameters === undefined ? {} : { supportedParameters }),
      ...(contextLength === undefined ? {} : { contextLength }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      categories,
      supportedEndpointTypes,
    })
  }
  return models
}

function parseCategories(value: unknown, modelId: string): DsnModelCategory[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`model ${modelId} has invalid categories`)
  }
  const categories = (value ?? []).filter(isDsnModelCategory)
  return categories.length > 0 ? [...new Set(categories)] : ['other']
}

function parseStringArray(value: unknown, message: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error(message)
  }
  return [...new Set(value)]
}

function parseOptionalStringArray(value: unknown, message: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  return parseStringArray(value, message)
}

function parseArchitecture(value: unknown, modelId: string): DsnModelArchitecture | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`model ${modelId} has invalid architecture`)
  }
  const architecture = value as Record<string, unknown>
  const modality = architecture.modality
  if (modality !== undefined && modality !== null && (typeof modality !== 'string' || modality.length === 0)) {
    throw new Error(`model ${modelId} has invalid architecture.modality`)
  }
  return {
    ...(typeof modality === 'string' ? { modality } : {}),
    inputModalities: parseStringArray(
      architecture.input_modalities,
      `model ${modelId} has invalid architecture.input_modalities`,
    ),
    outputModalities: parseStringArray(
      architecture.output_modalities,
      `model ${modelId} has invalid architecture.output_modalities`,
    ),
  }
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message)
  return value
}

function optionalModelString(
  value: unknown,
  field: string,
  modelId: string,
  outputField = field,
): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`model ${modelId} has invalid ${field}`)
  }
  return { [outputField]: value }
}

function parseModelLimit(value: unknown, field: string, modelId: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`model ${modelId} has invalid ${field}`)
  }
  return value
}

export function isDsnModelCategory(value: unknown): value is DsnModelCategory {
  return value === 'image'
    || value === 'video'
    || value === 'text'
    || value === 'text-multimodal'
    || value === 'audio'
    || value === 'other'
}

export function isDsnDefaultModelCategory(value: unknown): value is DsnDefaultModelCategory {
  return value === 'image'
    || value === 'text-multimodal'
    || value === 'video'
    || value === 'audio'
    || value === 'other'
}
