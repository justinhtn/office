// A touch screen is the main pointer, or ?touch asks to behave as if it were.
export const isTouchDevice = new URLSearchParams(window.location.search).has('touch') || Boolean(window.matchMedia?.('(pointer: coarse)').matches)
