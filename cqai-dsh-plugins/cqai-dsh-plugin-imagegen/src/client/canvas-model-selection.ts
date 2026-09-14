/** Resolve a canvas model without bypassing CQAI's explicit-choice policy. */
export function selectCanvasImageModel(
  current: string | undefined,
  imageModels: readonly string[],
  requireExplicitSelection: boolean,
): string {
  const selected = current?.trim() ?? ''
  if (selected !== '' && imageModels.includes(selected)) return selected
  return requireExplicitSelection ? '' : imageModels[0] ?? ''
}
