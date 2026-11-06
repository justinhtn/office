import assert from 'node:assert/strict'
import test from 'node:test'
import { labelRank, labelsToShow, roomNeeds, roomRank } from './labels.js'

const box = (name, left, top, rank = 3) => ({ name, left, top, right: left + 40, bottom: top + 16, rank })
const names = shown => [...shown].map(label => label.name).sort()

test('labels apart from each other all show', () => {
  assert.deepEqual(names(labelsToShow([box('a', 0, 0), box('b', 100, 0), box('c', 0, 100)])), ['a', 'b', 'c'])
})

test('of two overlapping labels, the one ranked first shows', () => {
  assert.deepEqual(names(labelsToShow([box('member', 0, 0, 3), box('lead', 10, 5, 2)])), ['lead'])
})

test('a room name wins over a person on top of it', () => {
  assert.deepEqual(names(labelsToShow([box('asking', 5, 5, labelRank({ request: {} })), box('Clancy', 0, 0, roomRank({ asking: 0, ready: 0 }))])), ['Clancy'])
})

test('a room whose team needs the person wins over another room', () => {
  assert.deepEqual(names(labelsToShow([box('quiet', 0, 0, roomRank({ asking: 0, ready: 0 })), box('needs', 5, 5, roomRank({ asking: 1, ready: 0 }))])), ['needs'])
})

test('a skipped label leaves room for the next one', () => {
  assert.deepEqual(names(labelsToShow([box('a', 0, 0, 1), box('b', 30, 0, 2), box('c', 60, 0, 3)])), ['a', 'c'])
})

test('asking comes first, then finished work, then leads, then everyone else', () => {
  assert.deepEqual([labelRank({ request: {} }, false), labelRank({ isFinished: true }, true), labelRank({}, true), labelRank({}, false)], [0, 1, 2, 3])
})

test("a room's needs count who is asking, and who has work ready but isn't asking", () => {
  assert.deepEqual(roomNeeds([{ request: {} }, { request: {}, isFinished: true }, { isFinished: true }, {}]), { asking: 2, ready: 1 })
})
