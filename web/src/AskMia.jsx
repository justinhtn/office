import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { ArrowUp, Check, Send, X } from 'lucide-react'
import { api } from './api.js'
import { FAST_POLL_MS, SLOW_POLL_MS, chatItems, dayLabel, grouped, isBusy, noteStatus, timeOf } from './miaChat.js'

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

// Her words may use bold, italics, lists, code and quotes. Nothing else in Markdown is drawn, and raw HTML never is. Links aren't
// either: her replies can carry other agents' words, and a link's label can hide where it goes, so only its text is shown.
const MARKDOWN = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'br', 'blockquote']

function Bubble({ item, children }) {
  return (
    <div className={`bubble-row ${item.side} ${item.isFirst ? 'first' : ''} ${item.isLast ? 'last' : ''}`}>
      <div className={`chat-bubble ${item.side} ${item.kind === 'note' ? 'note' : ''}`}>{children}</div>
    </div>
  )
}

// A note Mia drafted, shown as one of her messages: what it says, who it's for, and a Send button until it's decided.
function Note({ note, onDecide }) {
  const [isDeciding, setIsDeciding] = useState(false)
  const decide = async send => {
    setIsDeciding(true)
    try { await onDecide(note.id, send) } finally { setIsDeciding(false) }
  }

  return (
    <Bubble item={note}>
      <small className="note-to"><Send size={12} /> Note to {note.leadName}</small>
      <p className="bubble-text">{note.text}</p>
      <div className={`note-foot ${note.status}`}>
        <small>{note.status === 'sent' && <Check size={13} />}{noteStatus(note)}</small>
        {note.status === 'draft'
          ? (
            <span className="note-actions">
              <button disabled={isDeciding} onClick={() => decide(false)}>Cancel</button>
              <button className="note-send" disabled={isDeciding} onClick={() => decide(true)}>Send</button>
            </span>
          )
          : <time>{timeOf(note.at)}</time>}
      </div>
    </Bubble>
  )
}

function Message({ item }) {
  if (item.isWriting && !item.text) {
    return <Bubble item={item}>{item.step ? <small className="bubble-step">{item.step}…</small> : <span className="typing" aria-label="Mia is writing"><i /><i /><i /></span>}</Bubble>
  }

  return (
    <Bubble item={item}>
      {item.role === 'mia'
        ? <div className="bubble-text markdown"><ReactMarkdown allowedElements={MARKDOWN} unwrapDisallowed skipHtml>{item.text}</ReactMarkdown></div>
        : <p className="bubble-text">{item.text}</p>}
      {/* The time sits in the bubble's bottom corner, as in a messaging app. */}
      <time>{item.isWriting ? (item.step ? `${item.step}…` : 'writing…') : timeOf(item.at)}</time>
    </Bubble>
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

  const items = grouped(chatItems(chat))
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
        <div className="mia-messages chat-thread" ref={list} aria-live="polite" onScroll={event => { const el = event.currentTarget; isNearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}>
          {chat && items.length === 0 && <p className="mia-empty">Ask who needs you, how a team is doing, or have Mia pass a note to a lead. She can read the office but can't change anything.</p>}
          {items.map(item => (
            <React.Fragment key={`${item.kind}-${item.id}`}>
              {item.newDay && <div className="chat-day"><span>{dayLabel(item.at)}</span></div>}
              {item.kind === 'note' ? <Note note={item} onDecide={decide} /> : <Message item={item} />}
            </React.Fragment>
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
