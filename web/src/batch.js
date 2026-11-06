// Takes the oldest events that fit one batch for the server, by count and by size.
// An event too big for any batch would block every one after it, so it's counted as dropped instead.
const encoder = new TextEncoder()

export function takeBatch(queue, maxCount, maxBytes) {
  const batch = []
  let bytes = 0, dropped = 0, taken = 0
  while (taken < queue.length && batch.length < maxCount) {
    // Bytes as sent, so a user agent or message in another script can't push the body past the server's limit.
    const size = encoder.encode(JSON.stringify(queue[taken])).length + 1
    if (size > maxBytes) { taken++; dropped++; continue }
    if (bytes + size > maxBytes) break
    batch.push(queue[taken])
    bytes += size
    taken++
  }

  return { batch, rest: queue.slice(taken), dropped }
}
