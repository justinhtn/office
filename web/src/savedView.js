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

// The split view, and which team is in each pane, are kept per device.
// isOn is null until the person turns split view on or off there, so the device's default applies until then.
// Layouts saved before that was recorded only hold the default, so they count as no choice.
const SPLIT_SETTING = 'office-split-view'

export function parseSplitLayout(text, paneCount = 4) {
  try {
    const layout = JSON.parse(text)
    const isValid = layout && (layout.panes === null || (Array.isArray(layout.panes) && layout.panes.length === paneCount && layout.panes.every(key => key === null || (typeof key === 'string' && key.length > 0 && key.length <= 200))))

    return isValid ? { isOn: layout.choice === 'on' ? true : layout.choice === 'off' ? false : null, panes: layout.panes } : null
  } catch {
    return null
  }
}

export function readSplitLayout() {
  try {
    return parseSplitLayout(localStorage.getItem(SPLIT_SETTING))
  } catch {
    return null
  }
}

export function writeSplitLayout(layout) {
  try {
    localStorage.setItem(SPLIT_SETTING, JSON.stringify({ choice: layout.isOn === null ? null : layout.isOn ? 'on' : 'off', panes: layout.panes }))
  } catch {}
}
