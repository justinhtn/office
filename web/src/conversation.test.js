import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grouped, merge } from './conversation.js'

const at = minute => `2026-01-01T10:${String(minute).padStart(2, '0')}:00.000Z`
const message = (index, role = 'agent', extra = {}) => ({ index, role, text: `m${index}`, at: at(index), ...extra })

test('a refreshed newest page joins the older pages loaded before it', () => {
  const older = [message(0), message(1)]
  const merged = merge(older, { messages: [message(2), message(3)], total: 4 })
  assert.deepEqual(merged.map(one => one.index), [0, 1, 2, 3])
})

test('a page replaces what was known at the same positions', () => {
  const merged = merge([message(0), message(1, 'agent', { text: 'old' })], { messages: [message(1, 'agent', { text: 'new' })], total: 2 })
  assert.deepEqual(merged.map(one => one.text), ['m0', 'new'])
})

test('a transcript that got shorter starts over', () => {
  const merged = merge([message(0), message(5)], { messages: [message(0, 'person')], total: 1 })
  assert.deepEqual(merged.map(one => [one.index, one.role]), [[0, 'person']])
})

test('the person is on the right, the agent and peers on the left, and steps apart', () => {
  const items = grouped([message(0, 'person'), message(1), message(2, 'peer', { from: 'Zoe' }), message(3, 'step')])
  assert.deepEqual(items.map(one => one.side), ['out', 'in', 'in', 'step'])
})

test('a peer never joins the agent\'s group, so its name shows', () => {
  const items = grouped([message(0), message(1, 'peer', { from: 'Zoe' }), message(2, 'peer', { from: 'Zoe' }), message(3, 'peer', { from: 'Leo' })])
  assert.deepEqual(items.map(one => one.isFirst), [true, true, false, true])
})

test('a new day starts a new group, and messages without a time never claim one', () => {
  const items = grouped([{ index: 0, role: 'agent', at: '2026-01-01T23:59:00Z' }, { index: 1, role: 'agent', at: '2026-01-03T00:01:00Z' }, { index: 2, role: 'agent', at: '' }])
  assert.deepEqual(items.map(one => one.newDay), [true, true, false])
  assert.equal(items[1].isFirst, true)
})
