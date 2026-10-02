import type { ProductSetDraft, ProductSetSlot } from '../protocol.ts'

const ROLE_LABELS = { product: '商品主体', packaging: '包装', detail: '细节/角度', style: '风格参考' }
const VISUAL_BRIEFS: Record<string, readonly string[]> = {
  main: ['以干净背景完整展示商品主体，突出正面与侧面结构和真实材质，保留自然阴影和真实比例'],
  'selling-point': [
    '用局部放大、功能结果或使用场景形成构图分区，突出核心功能和购买理由',
    '聚焦另一项差异化优势或附加价值，使用与第一张不同的视角、背景、光线和视觉重点',
  ],
  scene: [
    '商品自然融入室内或日常环境，加入合理背景道具和环境光，呈现真实使用氛围',
    '换成不同环境或使用时刻，如户外、办公或休闲场景，机位、背景、光线和氛围与第一张明显不同',
  ],
  detail: ['用微距特写突出材质、工艺、接口或结构，浅景深和高细节，构图聚焦局部'],
  spec: ['展示商品尺寸、容量或参数关系，使用清晰的辅助构图和留白，只使用已提供的参数'],
  model: ['展示人物手持、佩戴或实际使用状态，突出人与商品的交互和真实尺度'],
}

export function ecommercePrompt(draft: ProductSetDraft, slot: ProductSetSlot, index = 0): string {
  const info = draft.promptInfo.trim() || '突出商品真实材质、结构和核心价值；保持商品颜色、形状、Logo、包装文字和结构真实，不添加不存在的配件'
  const language = (draft.language === 'custom' ? draft.customLanguage?.trim() : draft.language) || '中文'
  const product = draft.productName.trim() || '该商品'
  const choices = VISUAL_BRIEFS[slot.key] ?? [slot.description]
  const variant = choices[Math.min(Math.max(0, index), choices.length - 1)]!
  const variation = slot.count > 1 ? `这是本组第 ${index + 1} 张：机位、构图和视觉重点应与本组其他图片明显区分。` : ''
  const reference = slot.refRole !== undefined && slot.refRole !== 'none'
    ? `本图以上传的${ROLE_LABELS[slot.refRole]}图片为参考，商品与风格必须与参考图保持一致。`
    : ''
  const distinct = slot.key === 'main' ? '' : '只复用主图中的商品外观和身份，重新设计背景、机位、构图、道具和光效。'
  return `生成一张电商${slot.label}。视觉目标：${variant}。${variation}${distinct}商品身份与一致性约束：${product}的外形、比例、颜色、材质、Logo、包装文字与核心结构必须与${reference === '' ? '文字描述' : '参考图'}保持一致，不得重新发明或替换商品。商品品类：${draft.category}；平台：${draft.platform}；语言：${language}。${reference}商品信息与要求：${info}。整体要求：商品主体清晰、比例真实、光线自然、细节真实、适合电商发布。`
}

/** Manual and polished prompts take precedence over the default per-image brief. */
export function ecommerceSlotPrompt(draft: ProductSetDraft, slot: ProductSetSlot, index: number): string {
  const override = draft.promptOverrides?.[`${slot.key}-${index + 1}`]
  return override !== undefined && override.trim() !== '' ? override : ecommercePrompt(draft, slot, index)
}
