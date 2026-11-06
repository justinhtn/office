import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Send, X } from 'lucide-react'
import { api } from './api.js'
import { FAST_POLL_MS, SLOW_POLL_MS, chatItems, isBusy, noteStatus } from './miaChat.js'

// The chat follows the part of the screen the keyboard leaves, so the text box stays in view as the person types.
function useVisibleHeight(sheet) {
  useEffect(() => {
    const view = window.visualViewport
    if (!view) return
    const fit = () => {
      if (!sheet.current) return
      sheet.current.style.setProperty('--visible-height', `${view.height}px`)
      sheet.current.style.setProperty('--visible-top', `${view.offsetTop}px`)
      // With the keyboard up, the home bar's space would only sit between the box and the keys.
      sheet.current.toggleAttribute('data-keyboard', window.innerHeight - view.height > 120)
    }
    fit()
    view.addEventListener('resize', fit)
    view.addEventListener('scroll', fit)

    return () => { view.removeEventListener('resize', fit); view.removeEventListener('scroll', fit) }
  }, [])
}

function Note({ note, onDecide }) {
  const [isDeciding, setIsDeciding] = useState(false)
  const decide = async send => {
    setIsDeciding(true)
    try { await onDecide(note.id, send) } finally { setIsDeciding(false) }
  }

  return (
    <div className={`mia-note ${note.status}`}>
      <small className="mia-note-head"><Send size={12} /><span>Note to <b>{note.leadName}</b>, from you, passed on by Mia</span></small>
      <p>{note.text}</p>
      {note.status === 'draft'
        ? <div className="mia-note-actions">
            <button disabled={isDeciding} onClick={() => decide(false)}>Cancel</button>
            <button className="primary" disabled={isDeciding} onClick={() => decide(true)}>Send to {note.leadName}</button>
          </div>
        : <small className="mia-note-status">{noteStatus(note)}</small>}
    </div>
  )
}

// Ask Mia: a chat with the always-on Mia. On a phone it fills the screen; elsewhere it slides in from the right.
export default function AskMia({ portrait, isPhone, onClose }) {
  const [chat, setChat] = useState(null)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const [isSending, setIsSending] = useState(false)
  const sheet = useRef(null)
  const list = useRef(null)
  const box = useRef(null)
  const isNearEnd = useRef(true)
  const latest = useRef(null)
  useVisibleHeight(sheet)

  const show = next => { latest.current = next; setChat(next) }

  useEffect(() => {
    let isStopped = false
    let timer
    const load = async () => {
      try {
        const next = await api('/api/mia')
        if (!isStopped) { show(next); setProblem('') }
      } catch (failure) {
        if (!isStopped) setProblem(failure.message)
      }
      if (!isStopped) timer = setTimeout(load, isBusy(latest.current) ? FAST_POLL_MS : SLOW_POLL_MS)
    }
    load()

    return () => { isStopped = true; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const close = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)

    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const items = chatItems(chat)
  const last = items[items.length - 1]
  // New words keep the newest message in view, unless the person has scrolled up to read.
  useLayoutEffect(() => {
    if (isNearEnd.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [items.length, last?.text, last?.status])

  const send = async () => {
    const words = text.trim()
    if (!words || isSending) return
    setIsSending(true)
    setProblem('')
    try {
      show(await api('/api/mia/ask', { text: words }))
      setText('')
      isNearEnd.current = true
    } catch (failure) {
      setProblem(failure.message)
    } finally {
      setIsSending(false)
    }
  }

  const decide = async (id, isSent) => {
    try { show(await api('/api/mia/note', { id, send: isSent })) } catch (failure) { setProblem(failure.message) }
  }

  // The box grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    if (!box.current) return
    box.current.style.height = 'auto'
    box.current.style.height = `${Math.min(box.current.scrollHeight, 132)}px`
  }, [text])

  const isReady = chat?.isRunning
  const placeholder = !chat ? 'Connecting…' : !chat.isOn ? 'Turn on device access to talk to Mia' : isReady ? 'Ask Mia about the office' : 'Mia is on her way…'

  return createPortal(
    <>
      {!isPhone && <div className="mia-backdrop" onClick={onClose} />}
      <section ref={sheet} className={`mia-sheet ${isPhone ? 'full' : ''}`} role="dialog" aria-label="Ask Mia">
        <header className="mia-head">
          {portrait}
          <div className="mia-who"><b>Mia</b><small>{isReady ? (chat.isAnswering ? 'Writing…' : 'Front desk, read-only') : 'Starting'}</small></div>
          <button className="icon" aria-label="Close" title="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="mia-messages" ref={list} aria-live="polite" onScroll={event => { const el = event.currentTarget; isNearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}>
          {chat && items.length === 0 && <p className="mia-empty">Ask who needs you, how a team is doing, or have Mia pass a note to a lead. She can read the office but can't change anything.</p>}
          {items.map(item => item.kind === 'note'
            ? <Note key={`note-${item.id}`} note={item} onDecide={decide} />
            : (
              <div key={item.id} className={`mia-message ${item.role}`}>
                {item.text ? <p>{item.text}</p> : null}
                {item.isWriting && <small className="mia-writing">{item.step ? `${item.step}…` : item.text ? '' : 'Thinking…'}</small>}
              </div>
            ))}
        </div>
        {problem && <p className="error mia-problem">{problem}</p>}
        <form className="mia-compose" onSubmit={event => { event.preventDefault(); send() }}>
          <textarea
            ref={box} rows={1} value={text} maxLength={4000} placeholder={placeholder} aria-label="Message to Mia" enterKeyHint="send"
            disabled={!isReady}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }}
          />
          <button type="submit" className="mia-send" aria-label="Send" title="Send" disabled={!isReady || !text.trim() || isSending}><ArrowUp size={18} /></button>
        </form>
      </section>
    </>,
    document.body,
  )
}
