import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Texture } from 'three'
import { markFailed, texturesState } from './textureState.js'

// The office's own three.js: its Texture has no userData, which is what broke this before.
const arrived = () => new Texture({ complete: true, width: 4, height: 4 })

test('a texture still on its way keeps the face waiting, without throwing', () => {
  assert.equal(texturesState([new Texture()]), 'waiting')
  assert.equal(texturesState([arrived(), new Texture()]), 'waiting')
})

test('once every texture has arrived, the face can be drawn', () => {
  assert.equal(texturesState([arrived(), arrived()]), 'loaded')
  assert.equal(texturesState([]), 'loaded')
})

test('one texture that could not be fetched fails the face at once', () => {
  const broken = new Texture()
  markFailed(broken)
  assert.equal(texturesState([arrived(), broken, new Texture()]), 'failed')
})

test("an image that hasn't finished decoding isn't counted", () => {
  assert.equal(texturesState([new Texture({ complete: false, width: 4 })]), 'waiting')
  assert.equal(texturesState([new Texture({ complete: true, width: 0, naturalWidth: 0 })]), 'waiting')
})
