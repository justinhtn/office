// A view the person saved as their default. Anything odd in storage is ignored, and the automatic fit applies.
const VIEW_SETTING = 'office-default-view'
const LIMITS = { x: [-500, 500], y: [-100, 300], z: [-500, 500], az: [-7, 7], el: [0, 1.5], dist: [1, 600] }

export function parseSavedView(text) {
  try {
    const view = JSON.parse(text)
    const isValid = view && Object.entries(LIMITS).every(([key, [low, high]]) => Number.isFinite(view[key]) && view[key] >= low && view[key] <= high)

    return isValid ? Object.fromEntries(Object.keys(LIMITS).map(key => [key, view[key]])) : null
  } catch {
    return null
  }
}

export function readSavedView() {
  try {
    return parseSavedView(localStorage.getItem(VIEW_SETTING))
  } catch {
    return null
  }
}

export function writeSavedView(view) {
  try {
    if (view) localStorage.setItem(VIEW_SETTING, JSON.stringify(view))
    else localStorage.removeItem(VIEW_SETTING)
  } catch {}
}
