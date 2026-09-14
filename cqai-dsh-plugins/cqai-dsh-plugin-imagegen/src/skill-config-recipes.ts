/**
 * Built-in configuration recipes for well-known skills.
 *
 * A skill should declare its own configuration in `skill.config.json` (see
 * `docs/skill-config.md`); a recipe exists only so a known skill works out of
 * the box for users who installed it from upstream before it shipped a
 * declaration. A skill's own file always wins, so upstream can take over
 * without a plugin release — the same relationship `KNOWN_SKILL_SOURCES` has
 * with install links.
 *
 * Recipes are plugin-owned data, so they are trusted here: they still go
 * through the same validation as an installed declaration, which keeps one
 * grammar and one set of caps for both.
 */

import { EDITABLE_PPT_SKILL } from './skills-catalog.ts'
import { parseSkillConfigManifest, type SkillConfigDeclaration } from './skill-config.ts'

/** One built-in recipe: the raw declaration plus the fields it names. */
interface SkillConfigRecipe {
  name: string
  /** Raw `skill.config.json`-shaped object, validated like any other. */
  declaration: unknown
}

/**
 * The `image-to-editable-ppt` pipeline: it drives `editppt`, which reads
 * a YAML configuration and needs an OpenAI-compatible image endpoint for page
 * background repair and asset separation. The plugin writes its OCR-only YAML
 * below the skill-private config root and tells the headless Agent to set
 * `EDITPPT_CONFIG_HOME` to that directory. The image endpoint is supplied per
 * run by the CQAI bridge; it is deliberately not persisted here.
 * PaddleOCR is optional (the built-in offline detector still works), so its
 * step is guarded.
 */
const RECIPES: readonly SkillConfigRecipe[] = [
  {
    name: EDITABLE_PPT_SKILL,
    declaration: {
      version: 1,
      note: '图像 API 由 CQAI 在每次运行时临时提供并在任务结束后失效；这里只保存可选 OCR 配置。',
      imageProvider: {
        protocol: 'openai-images-v1',
      },
      fields: [
        {
          id: 'paddle-ocr-token',
          label: 'PaddleOCR token（可选）',
          description: '不填则使用内置离线文字检测；填了文字还原更准（免费额度）',
          type: 'secret',
        },
      ],
      apply: [
        {
          // Never put a token in argv: editppt also accepts an alternate
          // config home, which the canvas runner points at for this skill.
          kind: 'file',
          path: 'editppt/config.yaml',
          content: "PADDLE_OCR_TOKEN: '{paddle-ocr-token}'\n",
          when: { field: 'paddle-ocr-token', set: true },
        },
      ],
    },
  },
]

/** The built-in declaration for one skill, already validated. */
export function recipeFor(skillName: string): SkillConfigDeclaration | undefined {
  const recipe = RECIPES.find(entry => entry.name === skillName)
  if (recipe === undefined) return undefined
  const parsed = parseSkillConfigManifest(recipe.declaration)
  return parsed.manifest === undefined ? undefined : { manifest: parsed.manifest, source: 'plugin' }
}

/** Skill names this plugin ships a configuration recipe for. */
export function recipeNames(): string[] {
  return RECIPES.map(recipe => recipe.name)
}
