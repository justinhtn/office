// What the Ask Mia sheet shows, worked out from what the server sends: messages and notes in the order they happened,
// grouped the way a messaging app groups them.

export const FAST_POLL_MS = 600
export const SLOW_POLL_MS = 4000
// Messages from the same side this close together share a group: one tail, no gap.
const GROUP_MS = 5 * 60 * 1000

// Notes on their way out, or messages she's still writing, are worth watching closely.
export function isBusy(chat) {
  return Boolean(chat?.isAnswering || chat?.notes?.some(note => note.status === 'approved' || note.status === 'sending'))
}

// A note is drafted while Mia is still writing the reply that mentions it, so it goes just after that reply,
// where the person reads her words first and then decides. Her reply in progress stays last.
export function chatItems(chat) {
  const messages = (chat?.messages ?? []).filter(message => !message.isWriting).map(message => ({ kind: 'message', ...message })).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const writing = (chat?.messages ?? []).filter(message => message.isWriting).map(message => ({ kind: 'message', ...message }))
  const notes = (chat?.notes ?? []).map(note => ({ kind: 'note', ...note })).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const items = []
  const waiting = [...notes]
  messages.forEach(message => {
    items.push(message)
    if (message.role !== 'mia') return
    while (waiting.length && (waiting[0].at ?? 0) <= (message.at ?? 0)) items.push(waiting.shift())
  })

  return [...items, ...waiting, ...writing]
}

const sideOf = item => (item.kind === 'message' && item.role === 'person' ? 'out' : 'in')
const dayOf = at => new Date(at ?? 0).toDateString()

// Each item learns which side it's on, whether it starts or ends a group, and whether a new day starts with it.
export function grouped(items) {
  return items.map((item, index) => {
    const before = items[index - 1]
    const after = items[index + 1]
    const joins = (one, two) => one && two && sideOf(one) === sideOf(two) && Math.abs((two.at ?? 0) - (one.at ?? 0)) < GROUP_MS && dayOf(one.at) === dayOf(two.at)

    return { ...item, side: sideOf(item), isFirst: !joins(before, item), isLast: !joins(item, after), newDay: !before || dayOf(before.at) !== dayOf(item.at) }
  })
}

export function timeOf(at) {
  return at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

export function dayLabel(at, now = Date.now()) {
  const day = new Date(at)
  if (day.toDateString() === new Date(now).toDateString()) return 'Today'
  if (day.toDateString() === new Date(now - 86400000).toDateString()) return 'Yesterday'

  return day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

// While a note waits, it says itself that nothing has gone, so Mia never has to, and once sent the same line says so instead.
const NOTE_STATUS = {
  draft: 'Nothing goes out until you tap Send',
  approved: 'Sending…',
  sending: 'Sending…',
  failed: "Didn't send",
  cancelled: 'Cancelled',
}

export function noteStatus(note) {
  if (note.status === 'sent') return `Sent to ${note.leadName}`
  const words = NOTE_STATUS[note.status] ?? note.status
  if (note.status === 'failed' && note.problem) return `${words}: ${note.problem}`

  return words
}
