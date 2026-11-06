import assert from 'node:assert/strict'
import test from 'node:test'
import { labelRank, placeLabels, roomNeeds, roomOptions, roomRank, shortRoomName } from './labels.js'

const box = (left, top, w = 40, h = 16) => ({ left, top, right: left + w, bottom: top + h })
const label = (name, rank, options, mustShow = false) => ({ name, rank, options, mustShow })
const picks = labels => Object.fromEntries([...placeLabels(labels)].map(([one, index]) => [one.name, index]))

test('labels apart from each other all show', () => {
  assert.deepEqual(picks([label('a', 3, [box(0, 0)]), label('b', 3, [box(100, 0)])]), { a: 0, b: 0 })
})

test('of two overlapping labels, the one ranked first shows', () => {
  assert.deepEqual(picks([label('member', 3, [box(0, 0)]), label('lead', 2, [box(10, 5)])]), { lead: 0, member: -1 })
})

test('a room that does not fit takes its next option instead of being dropped', () => {
  const rooms = [label('first', -1, [box(0, 0)], true), label('second', -1, [box(10, 0), box(10, 40)], true)]
  assert.deepEqual(picks(rooms), { first: 0, second: 1 })
})

test('a room with nowhere free still shows, where it covers the least', () => {
  const rooms = [label('first', -1, [box(0, 0, 100, 100)], true), label('second', -1, [box(10, 10), box(90, 90), box(50, 50)], true)]
  assert.deepEqual(picks(rooms), { first: 0, second: 1 })
})

test('rooms are placed before people, and a room that needs the person before the rest', () => {
  const ranks = [roomRank({ asking: 1, ready: 0 }), roomRank({ asking: 0, ready: 0 }), labelRank({ request: {} }, false), labelRank({ isFinished: true }, true), labelRank({}, true), labelRank({}, false)]
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
  assert.equal(new Set(ranks).size, ranks.length)
})

test("a room's needs count who is asking, and who has work ready but isn't asking", () => {
  assert.deepEqual(roomNeeds([{ request: {} }, { request: {}, isFinished: true }, { isFinished: true }, {}]), { asking: 2, ready: 1 })
})

test('a long room name is cut short, and a short one is kept', () => {
  assert.equal(shortRoomName('Clancy'), 'Clancy')
  assert.equal(shortRoomName('Legal RAG'), 'Legal RAG')
  assert.equal(shortRoomName('Older projects'), 'Older pro…')
})

test("a room tries its full label first, then its short label in place and around it", () => {
  const options = roomOptions(100, 50, [80, 16], [40, 16])
  assert.deepEqual(options[0], { left: 60, right: 140, top: 34, bottom: 50, dx: 0, dy: 0 })
  assert.deepEqual(options.slice(1).map(({ dx, dy }) => [dx, dy]), [[0, 0], [0, 19], [0, -19], [-43, 0], [43, 0], [0, 38], [0, -38]])
})
