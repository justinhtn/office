import assert from 'node:assert/strict'
import test from 'node:test'
import { busiestTeams, clearPane, firstPanes, placeTeam, shownPanes, nextFirstSlot, visibleSlots } from './split.js'
import { parseSplitLayout } from './savedView.js'

const team = (id, member = {}) => ({ lead: { id }, members: [{ id, ...member }] })
const office = [team('a'), team('b', { isRunning: true }), team('c', { request: { id: 'r' } }), team('d', { isFinished: true }), team('e')]

test('panes first fill with teams asking, then working, then finished, then the rest', () => {
  assert.deepEqual(busiestTeams(office), ['c', 'b', 'd', 'a', 'e'])
  assert.deepEqual(firstPanes(office), ['c', 'b', 'd', 'a'])
})

test('fewer than four teams leaves the other panes empty', () => {
  assert.deepEqual(firstPanes([team('a')]), ['a', null, null, null])
})

test('dropping a team into a pane replaces what was there', () => {
  assert.deepEqual(placeTeam(['a', 'b', null, null], 'c', 1), ['a', 'c', null, null])
})

test('dropping a team already on screen swaps the two panes', () => {
  assert.deepEqual(placeTeam(['a', 'b', 'c', null], 'a', 2), ['c', 'b', 'a', null])
  assert.deepEqual(placeTeam(['a', 'b', 'c', null], 'a', 3), [null, 'b', 'c', 'a'])
  assert.deepEqual(placeTeam(['a', 'b', 'c', null], 'b', 1), ['a', 'b', 'c', null])
})

test('clearing a pane empties only that pane', () => {
  assert.deepEqual(clearPane(['a', 'b', 'c', 'd'], 2), ['a', 'b', null, 'd'])
})

test('a team that has gone shows as an empty pane', () => {
  assert.deepEqual(shownPanes(['a', 'gone', null, 'b'], office).map(one => one?.lead.id ?? null), ['a', null, null, 'b'])
})

test('a screen showing fewer panes shows a run of slots, wrapping round', () => {
  assert.deepEqual(visibleSlots(4), [0, 1, 2, 3])
  assert.deepEqual(visibleSlots(2, 2), [2, 3])
  assert.deepEqual(visibleSlots(2, 3), [3, 0])
  assert.deepEqual(visibleSlots(1, 1), [1])
  assert.deepEqual(visibleSlots(9), [0, 1, 2, 3])
})

test('swiping moves between runs of panes, wrapping round', () => {
  assert.equal(nextFirstSlot(0, 1, 2), 2)
  assert.equal(nextFirstSlot(2, 1, 2), 0)
  assert.equal(nextFirstSlot(0, -1, 2), 2)
  assert.equal(nextFirstSlot(2, -1, 2), 0)
  assert.equal(nextFirstSlot(0, 1, 4), 0)
  assert.equal(nextFirstSlot(1, 1, 1), 2)
})

test('a layout saved before choices were recorded keeps its panes but not its on or off', () => {
  assert.deepEqual(parseSplitLayout('{"isOn":false,"panes":["a",null,null,null]}'), { isOn: null, panes: ['a', null, null, null] })
  assert.deepEqual(parseSplitLayout('{"isOn":true,"panes":null}'), { isOn: null, panes: null })
})

test('a saved layout must be four team keys or empty panes', () => {
  assert.deepEqual(parseSplitLayout('{"choice":"on","panes":["a",null,"b",null]}'), { isOn: true, panes: ['a', null, 'b', null] })
  assert.deepEqual(parseSplitLayout('{"choice":"off","panes":null}'), { isOn: false, panes: null })
  assert.deepEqual(parseSplitLayout('{"choice":null,"panes":null}'), { isOn: null, panes: null })
  assert.equal(parseSplitLayout('{"choice":"on","panes":["a"]}'), null)
  assert.equal(parseSplitLayout('{"choice":"on","panes":[1,2,3,4]}'), null)
  assert.equal(parseSplitLayout('not json'), null)
  assert.equal(parseSplitLayout(null), null)
})
