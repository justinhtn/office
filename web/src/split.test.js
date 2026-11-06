import assert from 'node:assert/strict'
import test from 'node:test'
import { busiestTeams, clearPane, firstPanes, placeTeam, shownPanes } from './split.js'
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

test('a saved layout must be four team keys or empty panes', () => {
  assert.deepEqual(parseSplitLayout('{"isOn":true,"panes":["a",null,"b",null]}'), { isOn: true, panes: ['a', null, 'b', null] })
  assert.deepEqual(parseSplitLayout('{"isOn":false,"panes":null}'), { isOn: false, panes: null })
  assert.equal(parseSplitLayout('{"isOn":true,"panes":["a"]}'), null)
  assert.equal(parseSplitLayout('{"isOn":"yes","panes":null}'), null)
  assert.equal(parseSplitLayout('{"isOn":true,"panes":[1,2,3,4]}'), null)
  assert.equal(parseSplitLayout('not json'), null)
  assert.equal(parseSplitLayout(null), null)
})
