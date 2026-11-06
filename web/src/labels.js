// Which labels the whole-office view can show without any of them overlapping.
// Each label is { left, top, right, bottom, rank }, and a lower rank is placed first.
const GAP = 2

const overlaps = (a, b) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP

export function labelsToShow(labels) {
  const placed = []
  ;[...labels].sort((a, b) => a.rank - b.rank).forEach(label => {
    if (!placed.some(other => overlaps(label, other))) placed.push(label)
  })

  return new Set(placed)
}

// Rooms come first, so every room is named, and a room whose team needs the person comes before the rest.
// Then people: anyone asking for the person, anyone with finished work, leads, then everyone else.
export const roomRank = needs => (needs.asking || needs.ready ? -2 : -1)
export const labelRank = (person, isLead) => (person.request ? 0 : person.isFinished ? 1 : isLead ? 2 : 3)

// What a room's label says its team needs, so that's visible even when its people's names don't fit.
export function roomNeeds(members) {
  return { asking: members.filter(person => person.request).length, ready: members.filter(person => !person.request && person.isFinished).length }
}
