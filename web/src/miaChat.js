// What the Ask Mia sheet shows, worked out from what the server sends: messages and notes in the order they happened.

export const FAST_POLL_MS = 600
export const SLOW_POLL_MS = 4000

// Notes on their way out, or messages she's still writing, are worth watching closely.
export function isBusy(chat) {
  return Boolean(chat?.isAnswering || chat?.notes?.some(note => note.status === 'approved' || note.status === 'sending'))
}

export function chatItems(chat) {
  const messages = (chat?.messages ?? []).map(message => ({ kind: 'message', ...message }))
  const notes = (chat?.notes ?? []).map(note => ({ kind: 'note', ...note }))
  // Her reply in progress stays last, below a note she drafted while writing it.
  const writing = messages.filter(message => message.isWriting)
  const settled = [...messages.filter(message => !message.isWriting), ...notes].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))

  return [...settled, ...writing]
}

const NOTE_STATUS = {
  draft: 'Not sent yet',
  approved: 'Sending…',
  sending: 'Sending…',
  sent: 'Sent',
  failed: "Didn't send",
  cancelled: 'Cancelled',
}

export function noteStatus(note) {
  const words = NOTE_STATUS[note.status] ?? note.status
  if (note.status === 'sent') return `Sent to ${note.leadName}`
  if (note.status === 'failed' && note.problem) return `${words}: ${note.problem}`

  return words
}
