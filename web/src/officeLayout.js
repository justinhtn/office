// Who is on the office floor, which teams get a room, and where each room goes.
export const ACTIVE_DAYS = 7
export const SHARED_SPACES = ['meeting', 'lounge', 'office']
const LOCAL_LAYOUT = 'office-layout'

export const isBusy = person => person.isRunning || person.isFinished || Boolean(person.request) || person.meetingWith?.length > 0
const isProject = person => Boolean(person.teamId?.startsWith('project:'))
const isRecent = (person, now) => now - Date.parse(person.lastActivityAt || 0) < ACTIVE_DAYS * 86400000

// A project, or a team of two or more, keeps its desks however long it's been quiet. Anyone alone goes Away after a week.
export function onFloor(cast, now = Date.now()) {
  const sizes = new Map()
  cast.forEach(person => sizes.set(person.teamId || person.id, (sizes.get(person.teamId || person.id) || 0) + 1))
  const isKept = person => isProject(person) || sizes.get(person.teamId || person.id) > 1

  return cast.filter(person => person.isAssistant || isKept(person) || (person.isNamedTeam && person.id === person.teamLeadId) || isBusy(person) || isRecent(person, now))
}

// Teams with a room of their own. Anyone else idle and alone is in the lounge.
export const hasRoom = team => team.members.length > 1 || isBusy(team.lead) || Boolean(team.lead.isNamedTeam) || isProject(team.lead)

// Nobody moves when someone else arrives: a newcomer takes a place nobody is using, or a new one at the end.
export function keepPlaces(places, present) {
  const kept = [...places], live = new Set([...present, ...SHARED_SPACES])
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

// What this browser kept before the server held the layout, used once to seed it.
export function localLayout() {
  try {
    return parseLayout(JSON.parse(localStorage.getItem(LOCAL_LAYOUT)))
  } catch {
    return null
  }
}
