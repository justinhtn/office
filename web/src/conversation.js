// What the read-only conversation view shows, worked out from the pages the server sends.

export const BUSY_POLL_MS = 2000
export const IDLE_POLL_MS = 6000
const GROUP_MS = 5 * 60 * 1000

// Pages arrive by position in the transcript, so a refreshed newest page and older pages loaded by hand fit together.
// A transcript that got shorter has started over, and a newest page that doesn't reach what's known leaves a gap
// (more arrived than a page holds, say while the phone was locked), so either way only the new page is kept.
export function merge(known, page) {
  const hasShrunk = known.some(message => message.index >= (page.total ?? 0))
  const newest = known.length ? known[known.length - 1].index : -1
  const leavesGap = (page.messages ?? []).length > 0 && page.start > newest + 1
  const byIndex = new Map((hasShrunk || leavesGap ? [] : known).map(message => [message.index, message]))
  ;(page.messages ?? []).forEach(message => byIndex.set(message.index, message))

  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

const sideOf = message => (message.role === 'person' ? 'out' : message.role === 'step' ? 'step' : 'in')
const timeOfDay = at => Date.parse(at) || 0
const dayOf = at => new Date(timeOfDay(at)).toDateString()

// Each message learns its side, whether it starts or ends a group, and whether a new day starts with it.
// A peer's message never joins the agent's own, so its name shows above it.
export function grouped(messages) {
  const joins = (one, two) => one && two && sideOf(one) === sideOf(two) && (one.role === 'peer') === (two.role === 'peer') && (one.from ?? '') === (two.from ?? '')
    && Math.abs(timeOfDay(two.at) - timeOfDay(one.at)) < GROUP_MS && dayOf(one.at) === dayOf(two.at)

  return messages.map((message, index) => {
    const before = messages[index - 1]
    const after = messages[index + 1]

    return { ...message, side: sideOf(message), isFirst: !joins(before, message), isLast: !joins(message, after), newDay: Boolean(message.at) && (!before || dayOf(before.at) !== dayOf(message.at)) }
  })
}
