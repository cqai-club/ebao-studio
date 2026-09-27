/** Normalize article assets before they enter the shared, immutable content package. */
export async function articleUploadFile(file: File): Promise<File> {
  if (file.type !== 'image/webp' && !/\.webp$/iu.test(file.name)) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('WebP 图片无法解码，请换一张图片')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法转换 WebP 图片')
    // JPEG has no alpha channel. Use a white background for transparent covers.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('WebP 转换失败')), 'image/jpeg', 0.92)
    })
    if (blob.type !== 'image/jpeg' || blob.size < 1) throw new Error('WebP 转换失败')
    if (blob.size > 20 * 1024 * 1024) throw new Error('转换后的 JPEG 超过 20MB，请缩小图片后重试')
    return new File([blob], file.name.replace(/\.webp$/iu, '') + '.jpg', { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
