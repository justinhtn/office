// Whether a face's textures have arrived, failed, or are still on their way.
// three r128's Texture has no userData, so a failed fetch is remembered here rather than on the texture.

const failed = new WeakSet()

export function markFailed(texture) {
  failed.add(texture)
}

function isLoaded(texture) {
  const image = texture.image
  return Boolean(image && image.complete !== false && (image.width || image.naturalWidth))
}

// 'failed' as soon as any texture couldn't be fetched, 'loaded' once all have arrived, otherwise 'waiting'.
export function texturesState(textures) {
  if (textures.some(texture => failed.has(texture))) return 'failed'
  return textures.every(isLoaded) ? 'loaded' : 'waiting'
}
