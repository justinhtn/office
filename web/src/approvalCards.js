// What the approval cards sheet shows, worked out from what the server sends.

export const isOpen = card => card.status === 'open'

// Waiting cards first, newest first; then what was decided lately.
export function orderedCards(cards) {
  const waiting = (cards ?? []).filter(card => card.status === 'open' || card.status === 'approving').sort((a, b) => b.createdAt - a.createdAt)
  const decided = (cards ?? []).filter(card => card.status !== 'open' && card.status !== 'approving').sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))

  return [...waiting, ...decided]
}

export function minutesLeft(card, now = Date.now() / 1000) {
  return Math.max(0, Math.ceil((card.expiresAt - now) / 60))
}

const STATUS = {
  approving: 'Approved. The office is checking GitHub and merging…',
  declined: 'Declined',
  expired: 'Ran out of time',
}

export function cardStatus(card) {
  if (card.status === 'done') return card.kind === 'merge' ? card.result || 'Merged' : `You chose: ${card.choice}`
  if (card.status === 'failed') return `Not merged: ${card.result}`

  return STATUS[card.status] ?? ''
}
