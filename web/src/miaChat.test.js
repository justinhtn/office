import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatItems, dayLabel, grouped, isBusy, noteStatus } from './miaChat.js'

test('a note comes just after the reply that drafted it, and her reply in progress stays last', () => {
  const chat = {
    messages: [
      { id: 'a', role: 'person', text: 'Tell Zoe hi', at: 1 },
      // Her reply is kept when she finishes it, after the note she drafted while writing it.
      { id: 'b', role: 'mia', text: "It's ready to check.", at: 5 },
      { id: 'c', role: 'person', text: 'Thanks', at: 7 },
      { id: 'reply', role: 'mia', text: 'Also…', at: 8, isWriting: true },
    ],
    notes: [{ id: 'n', leadName: 'Zoe', text: 'Hi', status: 'draft', at: 3 }, { id: 'm', leadName: 'Zoe', text: 'Later', status: 'draft', at: 9 }],
  }
  assert.deepEqual(chatItems(chat).map(item => item.id), ['a', 'b', 'n', 'c', 'm', 'reply'])
})

test('nothing to show before the first answer', () => {
  assert.deepEqual(chatItems(null), [])
})

test('messages from the same side close together form one group, with the tail on the last', () => {
  const minute = 60 * 1000
  const items = grouped([
    { kind: 'message', role: 'person', at: 0 },
    { kind: 'message', role: 'person', at: minute },
    { kind: 'message', role: 'mia', at: 2 * minute },
    { kind: 'note', at: 3 * minute },
    { kind: 'message', role: 'mia', at: 20 * minute },
  ])
  assert.deepEqual(items.map(item => [item.side, item.isFirst, item.isLast]), [
    ['out', true, false],
    ['out', false, true],
    ['in', true, false],
    ['in', false, true],
    ['in', true, true],
  ])
  assert.deepEqual(items.map(item => item.newDay), [true, false, false, false, false])
})

test('a new day starts a new group and gets a label', () => {
  const now = new Date('2026-11-06T12:00:00').getTime()
  const items = grouped([{ kind: 'message', role: 'mia', at: now - 86400000 }, { kind: 'message', role: 'mia', at: now }])
  assert.deepEqual(items.map(item => [item.newDay, item.isLast]), [[true, true], [true, true]])
  assert.equal(dayLabel(now, now), 'Today')
  assert.equal(dayLabel(now - 86400000, now), 'Yesterday')
})

test('she is busy while answering or while a note goes out', () => {
  assert.equal(isBusy({ isAnswering: true, notes: [] }), true)
  assert.equal(isBusy({ isAnswering: false, notes: [{ status: 'sending' }] }), true)
  assert.equal(isBusy({ isAnswering: false, notes: [{ status: 'draft' }, { status: 'sent' }] }), false)
  assert.equal(isBusy(null), false)
})

test('a note says where it got to', () => {
  assert.equal(noteStatus({ status: 'sent', leadName: 'Zoe' }), 'Sent to Zoe')
  assert.equal(noteStatus({ status: 'failed', problem: 'Zoe is not running' }), "Didn't send: Zoe is not running")
  assert.equal(noteStatus({ status: 'draft' }), 'Waiting for you')
})
