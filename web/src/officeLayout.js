// Who is on the office floor, which teams get a room, and where each room goes.
export const ACTIVE_DAYS = 7
export const SHARED_SPACES = ['meeting', 'lounge', 'office']
const LOCAL_LAYOUT = 'office-layout'

export const isBusy = person => person.isRunning || person.isFinished || Boolean(person.request) || person.meetingWith?.length > 0
const isSolo = person => !person.teamId || person.teamId.startsWith('solo:')
const isRecent = (person, now) => now - Date.parse(person.lastActivityAt || 0) < ACTIVE_DAYS * 86400000
const keyOf = person => person.teamId || person.id

// Rooms the person closed. One comes back by itself once someone in it works again: a job, a question, or anything new since it closed.
export function closedRooms(cast, closed = {}) {
  const isBack = (key, closedAt) => cast.some(person => keyOf(person) === key && (person.isRunning || Boolean(person.request) || Date.parse(person.lastActivityAt || 0) > Date.parse(closedAt)))
  return new Set(Object.entries(closed || {}).filter(([key, closedAt]) => !isBack(key, closedAt)).map(([key]) => key))
}

// A team keeps its room until the person closes it or archives its sessions. Anyone alone goes Away after a week.
export function onFloor(cast, now = Date.now(), closed = {}) {
  const shut = closedRooms(cast, closed)

  return cast.filter(person => !shut.has(keyOf(person)) && (person.isAssistant || !isSolo(person) || isBusy(person) || isRecent(person, now)))
}

// Teams with a room of their own. Anyone else is alone, idle, and in the lounge.
export const hasRoom = team => !isSolo(team.lead) || isBusy(team.lead)

// Nobody moves when someone else arrives: a newcomer takes a place nobody is using, or a new one at the end.
// A closed room's place is held for it too.
export function keepPlaces(places, present, held = []) {
  const kept = [...places], live = new Set([...present, ...held, ...SHARED_SPACES])
  present.filter(key => !kept.includes(key)).forEach(key => {
    const free = kept.findIndex(one => !live.has(one))
    if (free < 0) kept.push(key)
    else kept[free] = key
  })
  while (kept.length && !live.has(kept[kept.length - 1])) kept.pop()

  return kept
}

// A team that has gone keeps its place in the list, so it comes back to it, but the floor closes up around the gap.
export const shownSlots = (slots, present) => slots.filter(key => SHARED_SPACES.includes(key) || present.includes(key))

const isKey = key => typeof key === 'string' && key.length > 0 && key.length <= 200

// The slot order every device shares, as the server stores it. Anything odd counts as no layout.
export function parseLayout(layout) {
  if (!layout || !Array.isArray(layout.slots) || !layout.slots.every(isKey)) return null
  const seats = layout.seats && typeof layout.seats === 'object' && !Array.isArray(layout.seats) ? layout.seats : {}
  const kept = Object.entries(seats).filter(([key, ids]) => isKey(key) && Array.isArray(ids) && ids.every(isKey))

  return { slots: layout.slots, seats: Object.fromEntries(kept) }
}

// Where planning starts. This browser's own older layout seeds the server's when there is none, or on the Mac when a phone or iPad seeded it first.
export function layoutStart(shared, local, isSeedWanted) {
  const own = shared === undefined || shared === null || isSeedWanted ? local : null

  return { start: own || shared || {}, isSeed: shared === null || Boolean(own && isSeedWanted) }
}

// What this browser kept before the server held the layout, used once to seed it.
export function localLayout() {
  try {
    return parseLayout(JSON.parse(localStorage.getItem(LOCAL_LAYOUT)))
  } catch {
    return null
  }
}
