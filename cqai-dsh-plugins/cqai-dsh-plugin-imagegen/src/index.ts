/**
 * dsh-imagegen — host half. Mounts the plugin's settings section (channels
 * with per-channel model catalogs on the host settings seam), the
 * /api/dsh-imagegen route family (loopback-only settings bridge + presets /
 * usage / image-generation proxy that keeps every API key host-side), and a
 * system-prompt announcement. The browser half (./client) renders the sidebar
 * entry and the split-pane generation studio.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DsnAccountService } from '@cqaiclub/dsn-account'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { installSettingsSectionCompat, settingsNamespaceCompat } from './settings-compat.ts'
import z from 'schemastery'// Type-only: pulls the webServer Context merge (route registration).
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the systemPrompt Context merge (announcement section).
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: pulls the human slash-command registry Context merge.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
// The skills + agents seams are reached through `ctx.inject` and read
// structurally (see CanvasSkillServices): the host half must not import those
// packages at runtime, and this deployment does not resolve them at
// type-check time either.
import { IMAGEGEN_SETTINGS_NAMESPACE, type CanvasSkillConfigApplyRequest, type CanvasSkillConfigApplyResult, type CanvasSkillConfigPreviewRequest, type CanvasSkillConfigPreviewResult, type CanvasSkillConfigSaveRequest, type CanvasSkillConfigSaveResult, type CanvasSkillConfigView, type CanvasSkillInstallRequest, type CanvasSkillInstallResult, type CanvasSkillLibrary, type CanvasSkillRemoveResult, type ChannelConfig, type ModelMapping } from './protocol.ts'
import { makeRoutes, type SettingsSeam } from './routes.ts'
import { syncAllTemplates } from './templates-store.ts'
import { setStorageSyncHandler, putObject, type StorageSyncConfig } from './storage-sync.ts'

/**
 * The concrete driver contract behind `ctx.agents`. The registry's published
 * `Agent` type only guarantees an id (the driver augmentation lives in
 * `dsh-agent-loop`), so the canvas skill runner reads the driver surface it
 * actually needs and fails loudly at runtime if a host shells out a different
 * driver without it.
 */
interface CanvasSkillAgent {
  readonly session: { deriveMessages: () => readonly unknown[] }
  followup: (message: { id: string; role: 'user'; content: Array<{ type: 'text'; text: string }>; source: { kind: 'plugin'; plugin: string } }) => void
  whenIdle: () => Promise<void>
  /** Durable cancellation cause; `user` is the canvas cancel button. */
  cancel: (cause: { kind: 'user' }) => void
}

/**
 * Resolve one skill's configuration declaration and the view the panel renders.
 *
 * Sidecar first, built-in recipe second, nothing third — the plugin never
 * invents a configuration surface for a skill that declared none. Exported so
 * the smoke suite exercises the real lookup (sidecar parsing, recipe fallback,
 * value resolution) rather than a test double of it.
 * @param options - skill name, its library entry path, the skills root, and the
 *   live value store; `issueText` localizes an ignored declaration.
 */
export async function readCanvasSkillConfig(options: {
  name: string
  entryPath?: string
  root: string
  store: SkillConfigStore
  issueText?: (issue: SkillConfigIssue) => string
}): Promise<{ declaration?: SkillConfigDeclaration; issue?: SkillConfigIssue; view?: CanvasSkillConfigView }> {
  const candidates = [...new Set([bundleDirOf(options.entryPath), path.join(options.root, options.name)])]
    .filter((dir): dir is string => dir !== undefined)
  let declaration: SkillConfigDeclaration | undefined
  let issue: SkillConfigIssue | undefined
  for (const dir of candidates) {
    const found = await readSkillConfigFile(dir).catch(() => undefined)
    if (found === undefined) continue
    if (found.manifest === undefined) issue = found.issue ?? 'unreadable'
    else declaration = { manifest: found.manifest, source: 'skill' }
    break
  }
  if (declaration === undefined && issue === undefined) declaration = recipeFor(options.name)
  const values = declaration === undefined ? new Map<string, string>() : valuesFor(declaration, options.store, options.name)
  const view = configView(
    declaration,
    values,
    issue === undefined ? undefined : (options.issueText === undefined ? issue : options.issueText(issue)),
  )
  return {
    ...declaration === undefined ? {} : { declaration },
    ...issue === undefined ? {} : { issue },
    ...view === undefined ? {} : { view },
  }
}

/** The bundle directory a library entry points at, when it is a bundle. */
function bundleDirOf(entryPath: string | undefined): string | undefined {
  if (entryPath === undefined) return undefined
  return path.basename(entryPath).toLowerCase() === 'skill.md' ? path.dirname(entryPath) : undefined
}

/** Error text for user-facing copy (never a bare `[object Object]`). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Structural view of the host services (skills registry, agents, presets). */
interface CanvasSkillServices {
  skills: {
    list: () => Promise<Array<{ name: string; description: string; whenToUse?: string; path?: string; invocation?: { modelInvocable?: boolean }; metadata?: Readonly<Record<string, unknown>> }>>
    get: (name: string) => Promise<{ name: string; content: string; metadata?: Readonly<Record<string, unknown>> } | undefined>
  }
  agents: {
    create: (options: {
      sessionId: string
      meta?: { cwd?: string; origin?: 'subagent'; agentPreset?: string }
      agentOptions?: { provider: string; model: string }
      signal?: AbortSignal
      setup?: (agentCtx: Context) => void | Promise<void>
    }) => Promise<{ agent: CanvasSkillAgent; dispose: () => Promise<void> }>
  }
}

/** The agent-preset roster a heavy skill joins (`ctx.agentPresets`). */
interface CanvasAgentPresets {
  /** Resolve the named preset, or the deployment default when omitted. */
  resolve: (id?: string) => Promise<{ id: string }>
  /** Compose a creating agent under that preset; resolves the composed preset. */
  mount: (agentCtx: Context, id?: string) => Promise<{ id: string }>
}

/** The deployment's default model selection (`ctx.agentDefaultModel`). */
interface CanvasDefaultModel {
  currentSelection: () => { provider?: string; model?: string }
}

/** Structural shell-environment registry inherited by a created Agent scope. */
interface CanvasShellEnvironment {
  register(contributor: {
    name: string
    variables: Record<string, { description: string }>
    resolve: () => Record<string, string>
  }): () => void
}

/** Everything one canvas heavy run needs to compose its headless agent. */
export interface CanvasSkillAgentOptions {
  agents: CanvasSkillServices['agents']
  /** Absent on hosts that mount no preset roster (the heavy tier then refuses). */
  presets?: CanvasAgentPresets
  /** Absent on hosts that publish no default model (the heavy tier then refuses). */
  defaultModel?: CanvasDefaultModel
  /** Configured preset id; empty asks the roster for the deployment default. */
  agentPreset: string
  sessionId: string
  cwd: string
  systemPrompt: string
  signal?: AbortSignal
  /** Run-only bridge values; installed into shell env, never into a prompt. */
  imageProvider?: SkillImageProviderEnvironment
  /** Localizes a composition failure's copy key (the runner owns the language). */
  fail?: (key: string) => string
}

/**
 * Compose the headless agent one heavy skill run drives.
 *
 * Creating an agent is not enough to make it *useful*: on the Web surface every
 * model-facing row (tools, prompt sections) lives behind an agent preset, and a
 * model route is not implied by the request. DSH's own entry points therefore
 * always pass both — `dsh-api-session-controller` stamps `agentOptions` from the
 * deployment default and mounts the resolved preset in `setup`, and
 * `dsh-subagent` joins the parent's preset for the same reason ("a child that
 * joins no preset sees an empty tool registry and none of its parent's prompt
 * sections"). A skill pipeline that must run a CLI is exactly that case: without
 * the join the agent dies on its first step, and without the model route it has
 * nothing to think with, so the canvas fails the run up front with copy instead
 * of producing an empty result.
 * @param options - host seams plus the run's identity, workspace and skill body.
 * @returns the live agent handle narrowed to what a skill run drives.
 */
export async function createCanvasSkillAgent(options: CanvasSkillAgentOptions): Promise<SkillAgentHandle> {
  const requested = options.agentPreset.trim()
  const presetId = options.presets === undefined
    ? undefined
    : (await options.presets.resolve(requested === '' ? undefined : requested)).id
  const selection = options.defaultModel?.currentSelection()
  const provider = selection?.provider?.trim() ?? ''
  const model = selection?.model?.trim() ?? ''
  const fail = options.fail ?? (key => key)
  if (provider === '' || model === '') throw new Error(fail('canvas.skills.needModel'))
  const handle = await options.agents.create({
    sessionId: options.sessionId,
    meta: {
      cwd: options.cwd,
      origin: 'subagent',
      ...presetId === undefined ? {} : { agentPreset: presetId },
    },
    agentOptions: { provider, model },
    ...options.signal === undefined ? {} : { signal: options.signal },
    setup: async (agentCtx: Context) => {
      // Join the preset FIRST: its rows must exist before the skill body is
      // registered, so the body never shadows the composition it runs inside.
      if (options.presets !== undefined && presetId !== undefined) await options.presets.mount(agentCtx, presetId)
      if (options.imageProvider !== undefined) {
        const shellEnv = agentCtx.get('shellEnv') as unknown as CanvasShellEnvironment | undefined
        if (shellEnv?.register === undefined) {
          throw new Error('CQAI 临时图像 Provider 需要 DSH shellEnv，但当前 Agent 未挂载该服务。')
        }
        const environment = options.imageProvider
        shellEnv.register({
          name: 'cqai-imagegen-run',
          variables: {
            [DSH_IMAGEGEN_BASE_URL]: { description: 'Run-scoped OpenAI Images v1 base URL.' },
            [DSH_IMAGEGEN_API_KEY]: { description: 'Run-scoped, short-lived image authorization.' },
            [DSH_IMAGEGEN_MODEL]: { description: 'Exact CQAI image model allowed for this run.' },
          },
          resolve: () => ({
            [DSH_IMAGEGEN_BASE_URL]: environment.baseUrl,
            [DSH_IMAGEGEN_API_KEY]: environment.apiKey,
            [DSH_IMAGEGEN_MODEL]: environment.model,
          }),
        })
      }
      agentCtx.systemPrompt.section({
        name: 'plugin:dsh-imagegen:canvas-skill',
        order: SECTION_ORDER,
        text: options.systemPrompt,
      })
    },
  })
  const agent = handle.agent
  return {
    session: agent.session,
    followup: body => {
      agent.followup({
        id: `canvas-skill-${Date.now().toString(36)}`,
        role: 'user',
        content: [{ type: 'text', text: body }],
        source: { kind: 'plugin', plugin: 'dsh-imagegen' },
      })
    },
    whenIdle: () => agent.whenIdle(),
    // The canvas cancel button is the human asking to stop.
    cancel: () => agent.cancel({ kind: 'user' }),
    dispose: () => handle.dispose(),
  }
}

/**
 * Wrap the host skill registry for the canvas runner: only model-invocable
 * skills are offered (the canvas runs every skill through a model, so a
 * user-only slash-command skill would fail halfway), and the summary is
 * narrowed to the fields the tier heuristic reads.
 *
 * The registry alone is not enough on the Web surface. There, a preset owns
 * local discovery: `skill-filesystem` mounts into the *preset's* layer while
 * this plugin is a host-plane bundle, and an unscoped `ctx.skills.list()` reads
 * the global layer alone (the base host row is disabled — see
 * `dsh-web-app/cordis.patch.yml`). Every skill the user installs into
 * `~/.dsh/skills` would therefore be invisible to the canvas, even though the
 * skill library panel lists it. So the local library is read straight from disk
 * as a second source, and both `list` and `get` consult it — the disk source is
 * also what makes a heavy run's body load without the agent's own scope.
 *
 * The canvas is one host surface shared by every session, so it deliberately
 * offers the union: registry entries win a name collision (a deployment-level
 * provider outranks a user install), and the local scan fills the rest.
 * @param skills - the injected `ctx.skills` service.
 * @param options - `root` resolves the local skill library root; omitted (as in
 *   narrow harnesses) leaves only the registry source.
 * @returns the runner's registry seam.
 */
export function createSkillRegistryBackend(
  skills: CanvasSkillServices['skills'],
  options: { root?: () => string } = {},
): SkillRegistryBackend {
  const localRoot = (): string | undefined => options.root?.()
  const localSkills = async (): Promise<LocalSkill[]> => {
    const root = localRoot()
    if (root === undefined) return []
    return await listLocalSkills(root).catch(() => [])
  }
  return {
    list: async () => {
      const listed = await skills.list()
      const merged = new Map<string, ExternalSkillSummary>()
      for (const skill of await localSkills()) {
        merged.set(skill.name, {
          name: skill.name,
          description: skill.description,
          ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
          path: skill.path,
          source: 'filesystem',
        })
      }
      for (const summary of listed) {
        if (summary.invocation?.modelInvocable === false) continue
        merged.set(summary.name, {
          name: summary.name,
          description: summary.description,
          ...summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse },
          ...summary.path === undefined ? {} : { path: summary.path },
          ...summary.metadata === undefined ? {} : { metadata: summary.metadata },
        })
      }
      return [...merged.values()]
    },
    get: async name => {
      const definition = await skills.get(name)
      if (definition !== undefined) {
        return {
          name: definition.name,
          content: definition.content,
          ...definition.metadata === undefined ? {} : { metadata: definition.metadata },
        }
      }
      const root = localRoot()
      const local = root === undefined ? undefined : await readLocalSkill(root, name).catch(() => undefined)
      return local === undefined ? undefined : { name: local.name, content: local.content }
    },
  }
}

/** Content type for a saved image file name (object uploads). */
function mimeOfPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/png'
  }
}
import { ImageGenerationRuntime, type ChannelsView, type RuntimeChannel } from './generation-runtime.ts'
import { registerAgentImageTools } from './agent-image-tools.ts'
import { registerEditImageCommand } from './edit-image-command.ts'
import { setImageDataRoot, imageDataRoot, requestedImageDataRoot, resolveImageDataRoot } from './image-storage-path.ts'
import { presetById } from './presets.ts'
import { DSH_IMAGEGEN_API_KEY, DSH_IMAGEGEN_BASE_URL, DSH_IMAGEGEN_MODEL, SkillRunner, setSkillTranslate, canvasSkillCopy, type SkillAgentBackend, type SkillAgentHandle, type SkillCanvasBackend, type SkillChatBackend, type SkillImageProviderEnvironment, type SkillRegistryBackend } from './skill-runner.ts'
import { installFromArchive, installFromUrl, isValidSkillName, knownSkillUrl, listLibrary, listLocalSkills, readLocalSkill, removeSkill, SkillStoreError, skillsRoot, type LocalSkill, type LocalSkillIssue } from './skill-store.ts'
import { applySkillConfigSteps, asConfigDict, configNote, configView, missingFields, parseSkillConfigManifest, previewSkillConfigSteps, readSkillConfigFile, skillConfigFingerprint, skillConfigKey, valuesFor, type SkillConfigDeclaration, type SkillConfigIssue, type SkillConfigStore } from './skill-config.ts'
import { recipeFor } from './skill-config-recipes.ts'
import { EDITABLE_PPT_SKILL, type ExternalSkillSummary } from './skills-catalog.ts'
import { canvasStore } from './canvas-store.ts'
import { imageGenLanguageOf, interpolate } from './locale-tables.ts'
import { CqaiImageProvider } from './cqai-image-provider.ts'
import { ImageGenSecretVault, type ImageGenSecretPayload } from './secret-vault.ts'
import { ensureImageDataMigration } from './data-migration.ts'
import { SkillImageBridge } from './skill-image-bridge.ts'
import { IMAGEGEN_RUNTIME_NAME, installImagegenMountGuard } from './imagegen-mount-guard.ts'

/** Stable cordis plugin name. */
export const name = IMAGEGEN_RUNTIME_NAME

/** Services required before the surfaces can mount. */
export const inject = ['dsnAccount', 'credentials', 'webServer', 'systemPrompt', 'commands']

// Internals re-exported for smoke tests and host-side debugging; the plugin
// contract only requires name / inject / Config / apply.
export { makeRoutes } from './routes.ts'
export { generateImage, ImageGenError } from './engine.ts'
export { promptCharLimit } from './model-catalog.ts'
export { analyzeLayers, normalizeLayerPlan, MAX_LAYER_IMAGE_BYTES } from './layer-analyzer.ts'
export { ImageGenerationRuntime } from './generation-runtime.ts'
export { registerAgentImageTools } from './agent-image-tools.ts'
export { latestSessionImage, registerEditImageCommand } from './edit-image-command.ts'
export { appendGallery, clearGallery, listGallery, readGalleryImage, removeGallery, updateGalleryTags } from './gallery-store.ts'
export { listTemplates, readTemplateImage, refreshTemplates, sampleTemplates, syncAllTemplates, clearTemplateMemo } from './templates-store.ts'
export { addTemplateFavorite, clearTemplateFavoritesMemo, listTemplateFavorites, removeTemplateFavorite } from './template-favorites.ts'
export { putObject, setStorageSyncHandler, testStorage, type StorageSyncConfig } from './storage-sync.ts'
export { SkillRunner, setSkillTranslate, setSkillLanguage, canvasSkillCopy } from './skill-runner.ts'
export { builtinCanvasSkills, canvasSkillCatalog, EDITABLE_PPT_SKILL, findCanvasSkill, isEditablePptSkill, mergeExternalSkills, tierOfExternalSkill } from './skills-catalog.ts'
export { extractFileText, MAX_EXTRACTED_CHARS } from './file-text.ts'
export { buildFilePreview, MAX_PREVIEW_CHARS, type FilePreviewInput } from './file-preview.ts'
export { classifySource, inspectSkillMarkdown, installableSkillName, installFromArchive, installFromUrl, isDshSkillName, isValidSkillName, KNOWN_SKILL_SOURCES, knownSkillUrl, listLibrary, listLocalSkills, parseSkillFrontmatter, readLocalSkill, removeSkill, SkillStoreError, skillsRoot, MAX_SKILL_ARCHIVE_BYTES, type LocalSkill, type LocalSkillIssue } from './skill-store.ts'
export { applySkillConfigSteps, configNote, configView, missingFields, parseSkillConfigManifest, previewSkillConfigSteps, readSkillConfigFile, resolveConfigTarget, skillConfigFingerprint, skillConfigKey, valuesFor, type SkillConfigDeclaration, type SkillConfigIssue, type SkillConfigStore } from './skill-config.ts'
export { recipeFor, recipeNames } from './skill-config-recipes.ts'
export { isZipDirectory, readZipDirectory, readZipEntry } from './zip.ts'
export { canvasStore, isBlockedFileName, fileKindOf, MAX_CANVAS_FILE_BYTES, mimeFromFileName, safeFileName } from './canvas-store.ts'
/** The branded settings namespace of this plugin (the card edits it). */
export const ImageGenSettingsNamespace = settingsNamespaceCompat(IMAGEGEN_SETTINGS_NAMESPACE)

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * Channels own the endpoint + model catalog. The API key of each channel lives
 * in `channelSecrets` (a secret dict keyed by channel id) instead of inside the
 * channel objects — dsh-settings redaction supports dict/array containers, but
 * path ops cannot reach inside arrays, so a whole-array write must never carry
 * secrets it would clobber.
 */
export interface Config {
  /** Master switch for the plugin (routes, prompt section). */
  enabled?: boolean
  /** Announce the plugin in every agent's system prompt. */
  announceToAgent?: boolean
  /** Allow Agents to submit and retrieve image-generation tasks. */
  allowAgentImageGeneration?: boolean
  /** Configured channels (each: name, endpoint, model catalog). */
  channels?: ChannelConfig[]
  /** Per-channel API keys, keyed by channel id. */
  channelSecrets?: Record<string, string>
  /** Channel used when a request does not name one. */
  defaultChannelId?: string
  /** Optional OpenAI-compatible chat endpoint for prompt enhancement. */
  promptApiUrl?: string
  /** Optional secret for the prompt enhancement endpoint. */
  promptApiKey?: string
  /** Chat model used to expand short image prompts. */
  promptModel?: string
  /** Local root for generated/history/gallery/canvas images. Empty keeps the default under DSH_HOME. */
  localStoragePath?: string
  /** Sync saved images to an S3-compatible object store (COS / OSS / Qiniu S3 …). */
  storageEnabled?: boolean
  /** S3-compatible endpoint URL including the bucket (virtual-hosted or path style). */
  storageEndpoint?: string
  /** Provider region for SigV4 scope, e.g. ap-guangzhou / oss-cn-hangzhou. */
  storageRegion?: string
  /** Object key prefix, default 'dsh-imagegen'. */
  storagePrefix?: string
  /** S3 access key id (stored in DSH Credentials). */
  storageAccessKey?: string
  /** S3 secret access key (stored in DSH Credentials). */
  storageSecretKey?: string
  /** Upload gallery additions (default on when storage is enabled). */
  storageSyncGallery?: boolean
  /** Also upload history images. */
  storageSyncHistory?: boolean
  /* ------------------------- infinite-canvas skills ------------------------- */
  /** Master switch for canvas skills (menu, runs, produced nodes). */
  skillsEnabled?: boolean
  /** Allow heavy skills, which run a headless DSH agent (slow, token-hungry). */
  allowHeavySkills?: boolean
  /** External-skill allowlist (comma/newline separated; empty = all installed). */
  skillAllowlist?: string
  /** Working directory for heavy skill runs; empty uses `<data>/canvas/runs`. */
  skillOutputDir?: string
  /** Heavy-skill timeout in minutes (0 disables the timeout). */
  skillHeavyTimeoutMinutes?: number
  /** Headless-agent preset used for heavy runs; empty uses the host default. */
  skillAgentPreset?: string
  /* --------------------------- skill configuration -------------------------- */
  /**
   * Per-skill configuration values declared by `skill.config.json`, keyed
   * `<skill>/<field>` (see `docs/skill-config.md`). Non-secret values only; the
   * secret half lives in `skillConfigSecrets`.
   */
  skillConfig?: Record<string, string>
  /** Secret half of the skill configuration, stored redacted. */
  skillConfigSecrets?: Record<string, string>
  /* ----- deprecated legacy single-endpoint fields (migrated to channels) ----- */
  /** Legacy base URL; synthesized into the default channel on upgrade. */
  apiUrl?: string
  /** Legacy secret; migrated into channelSecrets on upgrade. */
  apiKey?: string
  /** Legacy allow-list; migrated into the default channel's catalog. */
  imageModels?: string[]
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
  allowAgentImageGeneration: z.boolean().default(true),
  channels: z.array(z.object({
    id: z.string(),
    preset: z.string().default(''),
    name: z.string().default(''),
    apiUrl: z.string().default(''),
    models: z.array(z.object({
      alias: z.string(),
      id: z.string(),
    })).default([]),
  })).default([]),
  channelSecrets: z.dict(z.string().role('secret')).default({}),
  defaultChannelId: z.string().default(''),
  promptApiUrl: z.string().default(''),
  promptApiKey: z.string().role('secret').default(''),
  promptModel: z.string().default(''),
  localStoragePath: z.string().default(''),
  storageEnabled: z.boolean().default(false),
  storageEndpoint: z.string().default(''),
  storageRegion: z.string().default(''),
  storagePrefix: z.string().default('dsh-imagegen'),
  storageAccessKey: z.string().role('secret').default(''),
  storageSecretKey: z.string().role('secret').default(''),
  storageSyncGallery: z.boolean().default(true),
  storageSyncHistory: z.boolean().default(false),
  skillsEnabled: z.boolean().default(true),
  allowHeavySkills: z.boolean().default(true),
  skillAllowlist: z.string().default(''),
  skillOutputDir: z.string().default(''),
  skillHeavyTimeoutMinutes: z.number().default(20),
  skillAgentPreset: z.string().default(''),
  skillConfig: z.dict(z.string()).default({}),
  skillConfigSecrets: z.dict(z.string().role('secret')).default({}),
  apiUrl: z.string().default(''),
  apiKey: z.string().role('secret').default(''),
  imageModels: z.array(z.string()).default([]),
})

/** Schema defaults, re-read for hand-built contexts (the loader applies them normally). */
const DEFAULT_ENABLED = true
const DEFAULT_ANNOUNCE = true
const DEFAULT_ALLOW_AGENT_IMAGE_GENERATION = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const IMAGEGEN_GUIDANCE = [
  '已安装 e图宝插件，工作台位于主区“生图”，空会话也可以直接打开。',
  'CQAI 是 generate_image、edit_image 和 /edit_image 的默认 Provider；省略 provider 时必须使用 cqai，CQAI 失败时不得自动切换第三方。',
  'CQAI 模型省略时优先使用账号中有效的默认图像模型；只有一个可用模型时自动选择；多个模型且没有默认值时先询问用户。单次传入 model 只影响当前任务。',
  '第三方渠道只能通过 provider: custom:<channelId> 显式选择。generate_image、edit_image、get_image_generation_task 与 cancel_image_generation_task 和工作台共用宿主任务队列。',
  '完成结果进入本地历史，可加入图库和无限画布；“添加到会话”使用当前会话原生附件草稿，没有当前会话时应先创建或选择会话。',
  'CQAI 登录、额度、模型目录和提示词增强由 dsnAccount 提供；凭据只保存在 Host 的 DSH Credentials 中，OAuth Token 和 Relay Key不会交给浏览器、画布技能或第三方脚本。',
  '兼容 OpenAI 图像接口的本地画布技能使用短期单次环回凭据，只允许当前模型的图像生成/编辑端点；不兼容时明确失败。',
  '图片生成和重任务技能可能消耗账号额度；任务可在队列中查询或取消，不要高频轮询。',
].join(' ')

/** Append the live channel × model table so an Agent can honor user choices. */
function guidanceFor(channels: RuntimeChannel[], _defaultChannelId: string): string {
  const cqai = channels.find(channel => channel.id === 'cqai')
  const cqaiModels = cqai === undefined || cqai.models.length === 0
    ? 'CQAI 图像模型目录会在登录后读取；当前尚无可用目录。'
    : `CQAI 当前图像模型：${cqai.models.map(model => model.alias).join('、')}。`
  const custom = channels.filter(channel => channel.id.startsWith('custom:'))
  const customTable = custom.length === 0
    ? '当前没有自定义第三方渠道。'
    : `可显式选择的第三方渠道：${custom.map(channel => {
        const models = channel.models.length === 0 ? '未配置模型' : channel.models.map(model => model.alias).join('、')
        const state = channel.apiUrl.trim() !== '' && channel.apiKey.trim() !== '' ? '已配置' : '未配置完整'
        return `${channel.id}（${channel.name}；${models}；${state}）`
      }).join('；')}。`
  return `${IMAGEGEN_GUIDANCE} ${cqaiModels} ${customTable}`
}

/** Normalize raw channel entries into the wire shape (schema-adjacent guard). */
function normalizeChannels(value: unknown): ChannelConfig[] {
  if (!Array.isArray(value)) return []
  const out: ChannelConfig[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (rawId === '' || rawId === 'cqai') continue
    const id = rawId.startsWith('custom:') ? rawId : `custom:${rawId}`
    const models: ModelMapping[] = []
    if (Array.isArray(raw.models)) {
      for (const entry of raw.models) {
        if (entry === null || typeof entry !== 'object') continue
        const record = entry as Record<string, unknown>
        const alias = typeof record.alias === 'string' ? record.alias.trim() : ''
        const upstream = typeof record.id === 'string' ? record.id.trim() : ''
        if (alias === '') continue
        models.push({ alias, id: upstream === '' ? alias : upstream })
      }
    }
    out.push({
      id,
      preset: typeof raw.preset === 'string' ? raw.preset : '',
      name: typeof raw.name === 'string' ? raw.name.trim() : '',
      apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '',
      models,
    })
  }
  return out
}

/** Effective config (schema defaults applied + legacy migration). */
export interface EffectiveConfig {
  enabled: boolean
  announceToAgent: boolean
  allowAgentImageGeneration: boolean
  channels: RuntimeChannel[]
  defaultChannelId: string
  promptApiUrl: string
  promptApiKey: string
  promptModel: string
  storage: StorageSyncConfig & { enabled: boolean; syncGallery: boolean; syncHistory: boolean }
  /** Infinite-canvas skill settings. */
  skills: {
    enabled: boolean
    allowHeavy: boolean
    allowlist: string[]
    outputDir: string
    heavyTimeoutMs: number
    agentPreset: string
  }
  /** Per-skill configuration values, secrets included (host side only). */
  skillConfig: SkillConfigStore
}

/**
 * Resolve the S3 runtime view from public settings plus Host-only Credentials.
 * Both key halves deliberately ignore same-named settings values so a legacy
 * plaintext copy cannot become an accidental fallback after migration.
 */
export function resolveStorageConfig(
  value: Config,
  secured: Pick<ImageGenSecretPayload, 'storageAccessKey' | 'storageSecretKey'>,
): EffectiveConfig['storage'] {
  return {
    enabled: value.storageEnabled ?? false,
    endpoint: typeof value.storageEndpoint === 'string' ? value.storageEndpoint.trim() : '',
    region: typeof value.storageRegion === 'string' ? value.storageRegion.trim() : '',
    accessKey: secured.storageAccessKey ?? '',
    secretKey: secured.storageSecretKey ?? '',
    prefix: typeof value.storagePrefix === 'string' && value.storagePrefix.trim() !== '' ? value.storagePrefix.trim() : 'dsh-imagegen',
    syncGallery: value.storageSyncGallery ?? true,
    syncHistory: value.storageSyncHistory ?? false,
  }
}

/**
 * Mount the settings section, routes, and announcement.
 * @param ctx - host plugin context carrying webServer/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): () => void {
  const disposeMountGuard = installImagegenMountGuard(ctx)
  // Authentication, quota, model discovery and token refresh have one owner:
  // the separately mounted @cqaiclub/dsn-account service. ImageGen consumes
  // only its narrow Host interface and never creates an account runtime/RPC.
  const dsnAccount = (ctx as Context & { dsnAccount: DsnAccountService }).dsnAccount
  const cqai = new CqaiImageProvider(dsnAccount)
  const skillImageBridge = new SkillImageBridge({
    fetchAi: (requestPath, init, signal) => dsnAccount.fetchAi(requestPath, init, signal),
  })
  const secretVault = new ImageGenSecretVault(ctx.credentials)
  const vaultReady = secretVault.ready()
  setImageDataRoot(config?.localStoragePath)

  // The live source the surfaces read: the settings section once the settings
  // service is attached, the composition entry otherwise.
  let current: () => Config = () => config ?? {}
  const resolve = (): EffectiveConfig => {
    const value = current() ?? {}
    setImageDataRoot(value.localStoragePath)
    let channels = normalizeChannels(value.channels)
    // Secrets are never read from settings. The startup migration commits
    // them to DSH Credentials before any route or Agent tool is registered.
    const secured = secretVault.snapshot()
    const secrets = secured.channelApiKeys
    // Legacy single-endpoint migration: no channels yet → synthesize the
    // default channel from the old flat fields so upgrades never break.
    if (channels.length === 0) {
      const legacyUrl = typeof value.apiUrl === 'string' ? value.apiUrl.trim() : ''
      const legacyModels: ModelMapping[] = Array.isArray(value.imageModels)
        ? value.imageModels
          .filter((model): model is string => typeof model === 'string' && model.trim() !== '')
          .map(model => ({ alias: model.trim(), id: model.trim() }))
        : []
      if (legacyUrl !== '' || legacyModels.length > 0) {
        channels = [{ id: 'custom:default', preset: '', name: '默认渠道', apiUrl: legacyUrl, models: legacyModels }]
      }
    }
    const named = channels.map(channel => ({
      ...channel,
      name: channel.name === '' ? (presetById(channel.preset)?.name ?? '未命名渠道') : channel.name,
    }))
    const cqaiChannel = cqai.channel()
    return {
      enabled: value.enabled ?? DEFAULT_ENABLED,
      announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE,
      allowAgentImageGeneration: value.allowAgentImageGeneration ?? DEFAULT_ALLOW_AGENT_IMAGE_GENERATION,
      channels: [cqaiChannel, ...named.map(channel => ({
        ...channel,
        apiKey: typeof secrets[channel.id] === 'string'
          ? secrets[channel.id]
          : typeof secrets[channel.id.replace(/^custom:/, '')] === 'string'
            ? secrets[channel.id.replace(/^custom:/, '')]!
            : '',
      }))],
      defaultChannelId: 'cqai',
      promptApiUrl: typeof value.promptApiUrl === 'string' ? value.promptApiUrl.trim() : '',
      promptApiKey: secured.promptApiKey ?? '',
      promptModel: typeof value.promptModel === 'string' ? value.promptModel.trim() : '',
      storage: resolveStorageConfig(value, secured),
      skills: {
        enabled: value.skillsEnabled ?? true,
        allowHeavy: value.allowHeavySkills ?? true,
        allowlist: (value.skillAllowlist ?? '')
          .split(/[\n,]/)
          .map(item => item.trim())
          .filter(item => item !== ''),
        outputDir: typeof value.skillOutputDir === 'string' ? value.skillOutputDir.trim() : '',
        heavyTimeoutMs: Math.max(0, Math.round((value.skillHeavyTimeoutMinutes ?? 20) * 60_000)),
        agentPreset: typeof value.skillAgentPreset === 'string' ? value.skillAgentPreset.trim() : '',
      },
      skillConfig: {
        values: asConfigDict(value.skillConfig),
        secrets: asConfigDict(secured.skillConfigSecrets),
      },
    }
  }

  // Transient helper used by several mount points below: resolve the shared
  // channel view once per access; the runtime then picks per-request creds.
  const channelsView = (): ChannelsView => {
    const value = resolve()
    return { channels: value.channels, defaultChannelId: value.defaultChannelId }
  }

  // Object-storage sync: the image stores announce every file they write; the
  // handler resolves the live settings and uploads when enabled. Fire and
  // forget — a sync failure never blocks the save path.
  setStorageSyncHandler((kind, filePath) => {
    const storage = resolve().storage
    if (!storage.enabled || !storage.endpoint.trim()
      || storage.accessKey.trim() === '' || storage.secretKey.trim() === '') return
    if (kind === 'gallery' && !storage.syncGallery) return
    if (kind === 'history' && !storage.syncHistory) return
    const key = `${storage.prefix}/${kind === 'gallery' ? 'gallery' : 'images'}/${path.basename(filePath)}`
    const data = readFileSync(filePath)
    void putObject(storage, key, data, mimeOfPath(filePath)).catch(() => {
      // Best-effort sync: surfaced through the settings test, never fatal here.
    })
  })

  // Browser endpoints and Agent tools share the exact same serial queue. This
  // keeps image persistence, cancellation, and retries coherent across both
  // entry points; Agent tools wait for their task result by default and render
  // images in the tool result instead of injecting a synthetic user message.
  const runtime = new ImageGenerationRuntime(channelsView)

  // Host-rendered copy (skill catalog labels, run errors, produced node titles)
  // resolves through the same dictionaries the browser bundle ships, so a run
  // started in Chinese never answers in English.
  setSkillTranslate((key, params, language) => interpolate(key, params, imageGenLanguageOf(language)))

  // The canvas skill runner is assembled lazily: its chat tier needs only the
  // prompt-enhancement endpoint (always available), while the heavy tier needs
  // the host agent runtime. `setSkillRuntime` is called from the soft injection
  // below, and routes read it per request — so a deployment without the agent
  // runtime still gets the built-in light actions.
  let skillRunner: SkillRunner | undefined
  const resolveSkills = (): EffectiveConfig['skills'] => resolve().skills
  skillRunner = new SkillRunner({
    backend: {
      canvas: canvasStore as unknown as SkillCanvasBackend,
      chat: {
        complete: async options => cqai.complete(options),
      },
      imageProvider: {
        issue: async ({ model, signal }) => {
          const selected = await cqai.resolveRequest({
            mode: 'text',
            model: model ?? '',
            prompt: 'canvas skill image provider model selection',
            size: 'auto',
            quality: 'auto',
            n: 1,
            detail: '',
          }, signal)
          const exactModel = selected.upstream?.trim() || selected.model.trim()
          if (exactModel === '') throw new Error('CQAI 未返回可用于画布技能的图像模型。')
          if (!Number.isSafeInteger(ctx.webServer.port) || ctx.webServer.port < 1) {
            throw new Error('DSH 本地服务尚未准备好，无法签发画布技能图像凭据。')
          }
          const grant = skillImageBridge.issue({
            origin: `http://127.0.0.1:${ctx.webServer.port}`,
            model: exactModel,
            signal,
          })
          return {
            baseUrl: grant.baseUrl,
            apiKey: grant.apiKey,
            model: grant.model,
            revoke: grant.revoke,
          }
        },
      },
    },
    enabled: () => resolve().enabled && resolveSkills().enabled,
    heavyEnabled: () => resolveSkills().allowHeavy,
    allowlist: () => resolveSkills().allowlist,
    runRoot: () => resolveSkills().outputDir,
    heavyTimeoutMs: () => resolveSkills().heavyTimeoutMs,
    dataRoot: () => imageDataRoot(),
    pptInstallUrl: knownSkillUrl(EDITABLE_PPT_SKILL),
  })

  // ---------------------------------------------------------- skill config
  //
  // A skill may declare the settings it needs in `skill.config.json` beside its
  // `SKILL.md` (see docs/skill-config.md). The plugin renders that declaration,
  // stores the values in its own settings namespace, and runs the declared
  // `apply` steps on request. Known skills that ship no declaration are covered
  // by a built-in recipe; everything else keeps its own conventions.

  /** Settings write path, installed by the settings injection further down. */
  let mutateSettings: ((ops: Array<Record<string, unknown>>) => Promise<void>) | undefined
  /** Startup gate: legacy secrets and data must be adopted before any writer. */
  let settingsStartup: Promise<void> | undefined

  /** Entry paths the last library listing resolved, so lookups agree with it. */
  const entryPathByName = new Map<string, string>()

  /** Localize one ignored-declaration reason for the panel. */
  const configIssueText = (language?: string) => (issue: SkillConfigIssue): string => {
    const t = canvasSkillCopy(language)
    switch (issue) {
      case 'unsupported-version': return t('canvas.skills.configIssueVersion')
      case 'empty': return t('canvas.skills.configIssueEmpty')
      default: return t('canvas.skills.configIssueUnreadable')
    }
  }

  /** Resolve one skill's values from the live settings dictionaries. */
  const skillValues = (name: string, declaration: SkillConfigDeclaration): Map<string, string> =>
    valuesFor(declaration, resolve().skillConfig, name)

  /**
   * The library entry path for one skill: the last listing's answer when it has
   * one, else a direct disk read — so a config lookup and the panel agree.
   */
  const entryPathFor = async (name: string): Promise<string | undefined> => {
    const known = entryPathByName.get(name)
    if (known !== undefined) return known
    return (await readLocalSkill(skillsRoot(), name).catch(() => undefined))?.path
  }

  /** Look up a declaration by skill name, reading its path from disk. */
  const declarationByName = async (name: string): Promise<{ declaration?: SkillConfigDeclaration; issue?: SkillConfigIssue }> => {
    if (!isValidSkillName(name)) return { issue: 'refused-path' }
    const entryPath = await entryPathFor(name)
    return await readCanvasSkillConfig({
      name,
      ...entryPath === undefined ? {} : { entryPath },
      root: skillsRoot(),
      store: resolve().skillConfig,
    })
  }

  /** The directory a `command` step runs in by default (created on demand). */
  const configRunRoot = (name: string): string => path.join(imageDataRoot(), 'skill-config', name)
  /** File steps can write only here; manifest paths are relative to this root. */
  const configFileRoot = (name: string): string => path.join(configRunRoot(name), 'files')
  const CONFIG_CONFIRMATION_TTL_MS = 5 * 60 * 1000
  const configConfirmations = new Map<string, { name: string; fingerprint: string; expiresAt: number }>()

  const issueConfirmation = (name: string, fingerprint: string): { confirmationToken: string; expiresAt: number } => {
    const now = Date.now()
    for (const [token, pending] of configConfirmations) {
      if (pending.expiresAt <= now) configConfirmations.delete(token)
    }
    // Bound forgotten previews even when a client repeatedly opens the dialog.
    while (configConfirmations.size >= 128) configConfirmations.delete(configConfirmations.keys().next().value as string)
    const confirmationToken = randomBytes(24).toString('base64url')
    const expiresAt = now + CONFIG_CONFIRMATION_TTL_MS
    configConfirmations.set(confirmationToken, { name, fingerprint, expiresAt })
    return { confirmationToken, expiresAt }
  }

  // Local skill library (`~/.dsh/skills`): the canvas installs skills the same
  // way a user would by hand, and both the filesystem skill provider (through
  // its watcher) and the canvas catalog below read the same directory — so an
  // install needs no host restart and never stays invisible to node skills.
  let skillRegistryNames: ReadonlyArray<{ name: string; path?: string }> | undefined
  /** One entry's "why the node menu cannot offer this" line, in caller copy. */
  const issueText = (language?: string) => (issue: LocalSkillIssue, name: string): string => {
    const t = canvasSkillCopy(language)
    switch (issue) {
      case 'no-frontmatter': return t('canvas.skills.libraryIssueFrontmatter')
      case 'bad-name': return t('canvas.skills.libraryIssueName', { name })
      case 'no-description': return t('canvas.skills.libraryIssueDescription')
      case 'bad-invocation': return t('canvas.skills.libraryIssueInvocation')
      default: return t('canvas.skills.libraryIssueUserOnly')
    }
  }
  const snapshotLibrary = async (language?: string): Promise<CanvasSkillLibrary> => {
    const library = await listLibrary({
      root: skillsRoot(),
      ...skillRegistryNames === undefined ? {} : { known: skillRegistryNames },
      networkAvailable: true,
      issueText: issueText(language),
    })
    const store = resolve().skillConfig
    const entries = await Promise.all(library.entries.map(async entry => {
      if (entry.path !== undefined) entryPathByName.set(entry.name, entry.path)
      const found = await readCanvasSkillConfig({
        name: entry.name,
        ...entry.path === undefined ? {} : { entryPath: entry.path },
        root: skillsRoot(),
        store,
        issueText: configIssueText(language),
      })
      return found.view === undefined ? entry : { ...entry, config: found.view }
    }))
    return { ...library, entries }
  }
  /** Merge one save request into both dictionaries and write them back. */
  const saveSkillValues = async (
    name: string,
    declaration: SkillConfigDeclaration,
    edits: ReadonlyArray<{ id: string; value: string }>,
  ): Promise<void> => {
    if (mutateSettings === undefined) throw new SkillStoreError(canvasSkillCopy()('canvas.skills.configUnwritable'))
    const store = resolve().skillConfig
    const next: SkillConfigStore = { values: { ...store.values }, secrets: { ...store.secrets } }
    const byId = new Map(declaration.manifest.fields.map(field => [field.id, field]))
    for (const edit of edits) {
      const field = byId.get(edit.id)
      if (field === undefined) continue
      const key = skillConfigKey(name, field.id)
      const dict = field.type === 'secret' ? next.secrets : next.values
      if (edit.value.trim() === '') delete dict[key]
      else dict[key] = edit.value
    }
    await mutateSettings([
      { op: 'set', path: ['skillConfig'], value: next.values },
      { op: 'set', path: ['skillConfigSecrets'], value: next.secrets },
    ])
  }
  const skillLibrary = {
    list: async (options?: { language?: string }): Promise<CanvasSkillLibrary> => await snapshotLibrary(options?.language),
    install: async (request: CanvasSkillInstallRequest): Promise<CanvasSkillInstallResult> => {
      const root = skillsRoot()
      const installed: string[] = []
      const failed: Array<{ source: string; message: string }> = []
      let message: string | undefined
      if (request.asset !== undefined) {
        try {
          const found = await canvasStore.readAssets([request.asset])
          const blob = found.get(request.asset.assetId)
          if (blob === undefined) throw new SkillStoreError('上传的压缩包已失效，请重新上传')
          installed.push(await installFromArchive(blob.data, root, request.name ?? 'skill', request.force === true))
        } catch (error) { message = messageOf(error) }
      }
      for (const source of request.sources ?? []) {
        try {
          installed.push(await installFromUrl(source, root, { force: request.force === true, fallbackName: request.name }))
        } catch (error) {
          failed.push({ source, message: messageOf(error) })
        }
      }
      return {
        ok: installed.length > 0,
        installed,
        failed,
        library: await snapshotLibrary(request.language),
        ...message === undefined ? {} : { message },
      }
    },
    remove: async (name: string, options?: { language?: string }): Promise<CanvasSkillRemoveResult> => {
      try {
        const removed = await removeSkill(name, skillsRoot())
        return { ok: true, library: await snapshotLibrary(options?.language), message: removed }
      } catch (error) {
        return { ok: false, library: await snapshotLibrary(options?.language), message: messageOf(error) }
      }
    },
    configSave: async (request: CanvasSkillConfigSaveRequest): Promise<CanvasSkillConfigSaveResult> => {
      try {
        const found = await declarationByName(request.name)
        if (found.declaration === undefined) throw new SkillStoreError(configIssueText(request.language)(found.issue ?? 'empty'))
        await saveSkillValues(request.name, found.declaration, request.values ?? [])
        return { ok: true, library: await snapshotLibrary(request.language) }
      } catch (error) {
        return { ok: false, library: await snapshotLibrary(request.language), message: messageOf(error) }
      }
    },
    configPreview: async (request: CanvasSkillConfigPreviewRequest): Promise<CanvasSkillConfigPreviewResult> => {
      try {
        const found = await declarationByName(request.name)
        if (found.declaration === undefined) throw new SkillStoreError(configIssueText(request.language)(found.issue ?? 'empty'))
        const values = skillValues(request.name, found.declaration)
        const preview = await previewSkillConfigSteps(found.declaration, values, {
          configRoot: configFileRoot(request.name),
          safeBase: imageDataRoot(),
        })
        const steps = preview.steps.map(step => ({
          kind: step.kind,
          detail: step.detail,
          status: step.status,
          ...step.content === undefined ? {} : { content: step.content },
          ...step.issue === undefined ? {} : { issue: step.issue },
        }))
        if (!preview.ready) return { ok: true, ready: false, steps, message: '预览中有被安全策略阻止的操作，未签发确认凭据。' }
        return {
          ok: true,
          ready: true,
          steps,
          ...issueConfirmation(request.name, skillConfigFingerprint(found.declaration, values)),
        }
      } catch (error) {
        return { ok: false, ready: false, steps: [], message: messageOf(error) }
      }
    },
    configApply: async (request: CanvasSkillConfigApplyRequest): Promise<CanvasSkillConfigApplyResult> => {
      const library = async (): Promise<CanvasSkillLibrary> => await snapshotLibrary(request.language)
      try {
        const confirmation = configConfirmations.get(request.confirmationToken)
        // Tokens are consumed before any further work, including failed work.
        configConfirmations.delete(request.confirmationToken)
        if (confirmation === undefined || confirmation.name !== request.name || confirmation.expiresAt <= Date.now()) {
          throw new SkillStoreError('确认已失效或未签发；请重新预览全部操作后再确认。')
        }
        const found = await declarationByName(request.name)
        if (found.declaration === undefined) throw new SkillStoreError(configIssueText(request.language)(found.issue ?? 'empty'))
        const values = skillValues(request.name, found.declaration)
        if (skillConfigFingerprint(found.declaration, values) !== confirmation.fingerprint) {
          throw new SkillStoreError('技能声明或配置值已变化；请重新预览全部操作后再确认。')
        }
        const runRoot = configRunRoot(request.name)
        await mkdir(runRoot, { recursive: true })
        const preview = await previewSkillConfigSteps(found.declaration, values, {
          configRoot: configFileRoot(request.name),
          safeBase: imageDataRoot(),
        })
        if (!preview.ready) throw new SkillStoreError('操作目标在确认后发生变化，已拒绝执行；请重新预览。')
        const skillDir = bundleDirOf((await readLocalSkill(skillsRoot(), request.name).catch(() => undefined))?.path)
        const results = await applySkillConfigSteps(found.declaration, values, {
          runRoot,
          configRoot: configFileRoot(request.name),
          safeBase: imageDataRoot(),
          ...skillDir === undefined ? {} : { skillDir },
        })
        return {
          ok: results.every(result => result.ok),
          library: await library(),
          steps: results.map(result => ({
            kind: result.step.kind,
            detail: result.detail,
            ok: result.ok,
            ...result.output === undefined ? {} : { output: result.output },
          })),
        }
      } catch (error) {
        return { ok: false, library: await library(), steps: [], message: messageOf(error) }
      }
    },
  }

  // Attach the host skill registry and agent runtime when this deployment has
  // them. Both are optional seams: the plugin must keep working (light tier
  // included) on a host that never mounted them.
  ctx.inject(['skills', 'agents'], sctx => {
    const services = sctx as unknown as CanvasSkillServices
    const unregister = sctx.effect(() => {
      // The canvas catalog unions the host registry with the local library: on
      // the Web surface the registry alone is scope-blind here (see the adapter).
      const registry = createSkillRegistryBackend(services.skills, { root: skillsRoot })
      // The library panel prefers these paths over its own disk guess.
      void registry.list().then(
        listed => { skillRegistryNames = listed.map(item => ({ name: item.name, ...item.path === undefined ? {} : { path: item.path } })) },
        () => { skillRegistryNames = [] },
      )
      // A heavy run needs the preset roster and a model route. Both are optional
      // host services (a minimal host may mount neither), so they are read once
      // here and handed to the composition, which reports a missing model rather
      // than starting a tool-less agent that dies on its first step.
      const presets = sctx.get('agentPresets') as unknown as CanvasAgentPresets | undefined
      const defaultModel = sctx.get('agentDefaultModel') as unknown as CanvasDefaultModel | undefined
      const agents: SkillAgentBackend = {
        available: () => services.agents !== undefined,
        create: async options => await createCanvasSkillAgent({
          agents: services.agents,
          ...presets === undefined ? {} : { presets },
          ...defaultModel === undefined ? {} : { defaultModel },
          agentPreset: resolveSkills().agentPreset,
          sessionId: options.sessionId,
          cwd: options.cwd,
          systemPrompt: options.systemPrompt,
          ...options.signal === undefined ? {} : { signal: options.signal },
          ...options.imageProvider === undefined ? {} : { imageProvider: options.imageProvider },
          fail: options.fail,
        }),
      }
      skillRunner?.attach({
        registry,
        agents,
        // Skill configuration: the catalog shows which required fields still
        // have no value, and a run carries the exposable values it declared.
        skillConfig: {
          missing: async names => {
            const out = new Map<string, string[]>()
            for (const name of names) {
              const found = await declarationByName(name)
              if (found.declaration === undefined) continue
              const missing = missingFields(found.declaration, skillValues(name, found.declaration))
              if (missing.length > 0) out.set(name, missing)
            }
            return out
          },
          note: async name => {
            const found = await declarationByName(name)
            if (found.declaration === undefined) return undefined
            const exposed = configNote(found.declaration, skillValues(name, found.declaration))
            const privateConfig = name === EDITABLE_PPT_SKILL
              ? `- 运行 editppt 时设置 EDITPPT_CONFIG_HOME=${path.join(configFileRoot(name), 'editppt')}；密钥只从其中的 0600 配置文件读取，禁止放入命令行参数。`
              : undefined
            return [exposed, privateConfig].filter((line): line is string => line !== undefined && line !== '').join('\n') || undefined
          },
          imageProvider: async name => {
            const found = await declarationByName(name)
            const declaration = found.declaration
            const provider = declaration?.manifest.imageProvider
            if (declaration === undefined || provider === undefined) return undefined
            const preferred = provider.modelField === undefined
              ? undefined
              : skillValues(name, declaration).get(provider.modelField)?.trim()
            return {
              protocol: provider.protocol,
              ...preferred === undefined || preferred === '' ? {} : { model: preferred },
            }
          },
        },
      })
      return () => { skillRunner?.attach({}) }
    }, 'dsh-imagegen: canvas skills')
    void unregister
  })

  // The route family mounts once, gated on the settings seam (the bridge
  // serves it; without the seam there is nothing to expose). Route handlers
  // read resolve() per request, so config edits apply live. The settings
  // bridge deliberately keeps serving while the plugin is disabled — it is
  // how the user re-enables the plugin from the settings card.
  ctx.inject(['settings', 'attachments'], (sctx) => {
    const seam = sctx.get('settings') as unknown as SettingsSeam
    const secureMutate = async (ns: string, ops: readonly unknown[], expectedRevision?: number): Promise<void> => {
      await vaultReady
      const publicOps = await secretVault.extractSecretOps(ops)
      // A configured root can point at an existing upstream dsh-imagegen tree.
      // Validate and back it up before the settings write makes that root live;
      // a failed migration therefore leaves both the active setting and source
      // data untouched.
      const nextRoot = requestedImageDataRoot(publicOps, config?.localStoragePath)
      if (nextRoot !== undefined) await ensureImageDataMigration(resolveImageDataRoot(nextRoot))
      if (publicOps.length > 0) await seam.mutate(ns, publicOps, expectedRevision)
    }
    settingsStartup = (async () => {
      await vaultReady
      await secretVault.migrateLegacySettings(seam, IMAGEGEN_SETTINGS_NAMESPACE)
      // Re-read localStoragePath after the settings namespace is attached.
      resolve()
      await ensureImageDataMigration(imageDataRoot())
    })()
    // Skill configuration values are written through the same namespace the
    // settings card edits; the panel never crafts settings ops itself.
    mutateSettings = async ops => { await secureMutate(IMAGEGEN_SETTINGS_NAMESPACE, ops) }
    sctx.effect(
      () => {
        let disposed = false
        let disposeMounted: (() => void) | undefined
        void settingsStartup!.then(() => {
          if (disposed) return
          const routes = makeRoutes({
            settings: seam,
            cqai,
            projectSettingsDescriptor: descriptor => secretVault.projectDescriptor(descriptor),
            mutateSettings: secureMutate,
            resolve: () => {
              const value = resolve()
              const channel = value.channels.find(candidate => candidate.id === value.defaultChannelId) ?? value.channels[0]
              return { apiUrl: channel?.apiUrl ?? '', apiKey: channel?.apiKey ?? '' }
            },
            resolveChannels: channelsView,
            resolvePrompt: () => {
              const value = resolve()
              const channel = value.channels.find(candidate => candidate.id === value.defaultChannelId) ?? value.channels[0]
              return {
                apiUrl: value.promptApiUrl !== '' ? value.promptApiUrl : (channel?.apiUrl ?? ''),
                apiKey: value.promptApiKey !== '' ? value.promptApiKey : (channel?.apiKey ?? ''),
                model: value.promptModel,
              }
            },
            resolveImageModels: () => {
              const value = resolve()
              return [...new Set(value.channels.flatMap(channel => channel.models.map(model => model.alias)))]
            },
            attachments: sctx.attachments,
            runtime,
            resolveStorage: () => resolve().storage,
            skills: skillRunner,
            skillLibrary,
          })
          const disposers: Array<() => void> = []
          try {
            // The skill bridge shares the same startup gate as every data
            // writer; no run credential can be used before migration settles.
            for (const route of [skillImageBridge.route(), ...routes]) disposers.push(ctx.webServer.register(route))
          } catch (error) {
            for (const dispose of disposers.splice(0)) dispose()
            throw new Error('检测到旧 @dickpy/dsh-imagegen 或另一 ImageGen 实例占用同一路由；为保护 ~/.dsh/dsh-imagegen，两个插件不能同时挂载。', { cause: error })
          }
          // Background template sync: the upstream sources update on their own
          // schedule, so pull every one of them shortly after start and then
          // twice a day while the plugin stays enabled.
          const TEMPLATE_SYNC_INITIAL_DELAY_MS = 30_000
          const TEMPLATE_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000
          const runSync = (): void => {
            if (!resolve().enabled) return
            void syncAllTemplates().catch(() => { /* keep the last good snapshot */ })
          }
          const startTimer = setTimeout(runSync, TEMPLATE_SYNC_INITIAL_DELAY_MS)
          const syncTimer = setInterval(runSync, TEMPLATE_SYNC_INTERVAL_MS)
          startTimer.unref?.()
          syncTimer.unref?.()
          disposeMounted = () => {
            clearTimeout(startTimer)
            clearInterval(syncTimer)
            for (const dispose of disposers.splice(0)) dispose()
          }
        }).catch((error: unknown) => {
          ctx.logger.error('cqai imagegen routes failed to start: %s', messageOf(error))
        })
        return () => {
          disposed = true
          disposeMounted?.()
        }
      },
      'dsh-imagegen: routes',
    )
  })

  ctx.inject(['tools', 'attachments', 'commands'], (tctx) => {
    tctx.effect(() => {
      let disposed = false
      let disposeMounted: (() => void) | undefined
      void (async () => {
        await vaultReady
        if (settingsStartup !== undefined) await settingsStartup
        resolve()
        await ensureImageDataMigration(imageDataRoot())
        if (disposed) return
        const resolveAgentConfig = () => {
          const value = resolve()
          return {
            enabled: value.enabled,
            allowAgentImageGeneration: value.allowAgentImageGeneration,
            channels: value.channels,
            defaultChannelId: value.defaultChannelId,
            resolveCqaiRequest: (request: Parameters<CqaiImageProvider['resolveRequest']>[0], signal?: AbortSignal) => cqai.resolveRequest(request, signal),
          }
        }
        const disposeTools = registerAgentImageTools(tctx, runtime, resolveAgentConfig)
        const disposeCommand = registerEditImageCommand(tctx, runtime, resolveAgentConfig)
        disposeMounted = () => {
          disposeCommand()
          disposeTools()
        }
      })().catch((error: unknown) => {
        ctx.logger.error('cqai imagegen Agent tools failed to start: %s', messageOf(error))
      })
      return () => {
        disposed = true
        disposeMounted?.()
      }
    }, 'dsh-imagegen: agent image tools and commands')
  })

  // System-prompt announcement (toggled by settings changes).
  let disposeSection: (() => void) | undefined
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    const value = resolve()
    if (!value.enabled || !value.announceToAgent) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-imagegen',
      order: SECTION_ORDER,
      text: guidanceFor(value.channels, value.defaultChannelId),
    })
  }

  installSettingsSectionCompat(ctx, ImageGenSettingsNamespace, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  ctx.on('dsn-account/changed', (snapshot) => {
    // The event already contains the current state. Calling describe() here
    // would call getStatus(), which emits dsn-account/changed again and turns
    // one account poll into an infinite Host-side feedback loop.
    void cqai.describeSnapshot(snapshot).then(sync, sync)
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()

  return () => {
    disposeMountGuard()
    configConfirmations.clear()
    skillImageBridge.dispose()
    setStorageSyncHandler(undefined)
  }
}
