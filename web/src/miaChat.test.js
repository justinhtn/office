import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatItems, isBusy, noteStatus } from './miaChat.js'

test('messages and notes come in the order they happened, with her reply in progress last', () => {
  const chat = {
    messages: [
      { id: 'a', role: 'person', text: 'Tell Zoe hi', at: 1 },
      { id: 'b', role: 'mia', text: 'Drafted it.', at: 5 },
      { id: 'reply', role: 'mia', text: 'Also…', at: 6, isWriting: true },
    ],
    notes: [{ id: 'n', leadName: 'Zoe', text: 'Hi', status: 'draft', at: 3 }, { id: 'm', leadName: 'Zoe', text: 'Later', status: 'draft', at: 9 }],
  }
  assert.deepEqual(chatItems(chat).map(item => item.id), ['a', 'n', 'b', 'm', 'reply'])
})

test('nothing to show before the first answer', () => {
  assert.deepEqual(chatItems(null), [])
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
  assert.equal(noteStatus({ status: 'draft' }), 'Not sent yet')
})
