import { mark, startTimeline } from './timeline.js'
import { token } from './api.js'
import { isTouchDevice } from './device.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import App from './App.jsx'
import './styles.css'

// Bundled locally, so viewing code never depends on a CDN.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

startTimeline(token)
createRoot(document.getElementById('root')).render(<App />)
mark('app.render')
if (isTouchDevice) document.documentElement.classList.add('touch')
