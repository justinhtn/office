// A touch screen is the main pointer, or ?touch asks to behave as if it were.
export const isTouchDevice = new URLSearchParams(window.location.search).has('touch') || Boolean(window.matchMedia?.('(pointer: coarse)').matches)
// A touch screen too small for the side panel beside the room, like a phone in either orientation. It follows the window, not the device.
export const PHONE_SIZE = '(max-width: 599px), (max-height: 499px)'
