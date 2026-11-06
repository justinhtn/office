// A touch screen is the main pointer, or ?touch asks to behave as if it were.
export const isTouchDevice = new URLSearchParams(window.location.search).has('touch') || Boolean(window.matchMedia?.('(pointer: coarse)').matches)
// A touch screen big enough for four rooms at once, like an iPad, rather than a phone.
export const isTablet = isTouchDevice && Math.min(window.screen.width, window.screen.height) >= 600
