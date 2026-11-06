// Where the whole-office view puts its labels so that none overlap.
// Each label is { rank, options, mustShow }: options are boxes { left, top, right, bottom } to try in order, and a lower rank is placed first.
const GAP = 4

const overlaps = (a, b) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

// Returns which option each label takes, or -1 to skip it. A label that must show takes its least covered option when none fit.
export function placeLabels(labels) {
  const placed = [], chosen = new Map()
  ;[...labels].sort((a, b) => a.rank - b.rank).forEach(label => {
    let index = label.options.findIndex(box => !placed.some(other => overlaps(box, other)))
    if (index < 0 && label.mustShow) {
      const covered = label.options.map(box => placed.reduce((sum, other) => sum + overlap(box, other), 0))
      index = covered.indexOf(Math.min(...covered))
    }
    chosen.set(label, index)
    if (index >= 0) placed.push(label.options[index])
  })

  return chosen
}

// Rooms come first, so every room is named, and a room whose team needs the person comes before the rest.
// Then people: anyone asking for the person, anyone with finished work, leads, then everyone else.
export const roomRank = needs => (needs.asking || needs.ready ? -2 : -1)
export const labelRank = (person, isLead) => (person.request ? 0 : person.isFinished ? 1 : isLead ? 2 : 3)

// What a room's label says its team needs, so that's visible even when its people's names don't fit.
export function roomNeeds(members) {
  return { asking: members.filter(person => person.request).length, ready: members.filter(person => !person.request && person.isFinished).length }
}

// The short form of a room's name, for when the full label doesn't fit.
const SHORT_NAME = 9
export const shortRoomName = name => (name.length <= SHORT_NAME + 1 ? name : `${name.slice(0, SHORT_NAME).trimEnd()}…`)

// Where a room's label can go: its full form where it belongs, then its short form there, below, above, left, right, and a row further out.
export function roomOptions(left, top, full, short) {
  const at = ([w, h], dx, dy) => ({ left: left - w / 2 + dx, right: left + w / 2 + dx, top: top - h + dy, bottom: top + dy, dx, dy })
  const [w, h] = short, row = h + 3

  return [at(full, 0, 0), ...[[0, 0], [0, row], [0, -row], [-w - 3, 0], [w + 3, 0], [0, row * 2], [0, -row * 2]].map(([dx, dy]) => at(short, dx, dy))]
}
