import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Eye, Wrench } from 'lucide-react'
import { api, withId } from './api.js'
import { BUSY_POLL_MS, IDLE_POLL_MS, grouped, merge } from './conversation.js'
import { dayLabel, timeOf } from './miaChat.js'

// Everything here comes from an agent's transcript, which can hold anything, so it is only ever drawn as plain text.
function Message({ item }) {
  if (item.side === 'step') {
    return <p className={`chat-step ${item.isFirst ? 'first' : ''}`}><Wrench size={11} aria-hidden="true" /> <span>{item.text}</span></p>
  }

  return (
    <div className={`bubble-row ${item.side} ${item.isFirst ? 'first' : ''} ${item.isLast ? 'last' : ''}`}>
      <div className={`chat-bubble ${item.side}`}>
        {item.role === 'peer' && item.isFirst && <small className="note-to">From {item.from || 'another agent'}</small>}
        <p className="bubble-text">{item.text}</p>
        <time>{timeOf(Date.parse(item.at) || 0)}</time>
      </div>
    </div>
  )
}

// What an agent is working on, read-only, on a phone: their conversation with the newest at the bottom, kept fresh while open.
export default function AgentConversation({ person, state, team, portrait, onClose }) {
  const [messages, setMessages] = useState([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [problem, setProblem] = useState('')
  const list = useRef(null)
  const isNearEnd = useRef(true)
  const keepFromBottom = useRef(null)
  const isBusy = useRef(person.isRunning)
  isBusy.current = person.isRunning
  const shownId = useRef(person.id)
  shownId.current = person.id

  useEffect(() => {
    let isStopped = false
    let timer
    setMessages([])
    setIsLoaded(false)
    isNearEnd.current = true
    const load = async () => {
      try {
        const page = await api(withId('/api/conversation', person.id))
        if (isStopped) return
        setMessages(known => merge(known, page))
        setIsLoaded(true)
        setProblem('')
      } catch (failure) {
        if (!isStopped) setProblem(failure.message)
      }
      if (!isStopped) timer = setTimeout(load, isBusy.current ? BUSY_POLL_MS : IDLE_POLL_MS)
    }
    load()

    return () => { isStopped = true; clearTimeout(timer) }
  }, [person.id])

  useEffect(() => {
    const close = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)

    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const loadOlder = async () => {
    if (!messages.length || isLoadingOlder) return
    setIsLoadingOlder(true)
    try {
      const page = await api(withId('/api/conversation', person.id, { before: String(messages[0].index) }))
      // Someone else's conversation may be showing by now.
      if (shownId.current !== person.id) return
      // Older messages go in above, so the one being read stays where it was.
      keepFromBottom.current = list.current ? list.current.scrollHeight - list.current.scrollTop : null
      setMessages(known => merge(known, page))
    } catch (failure) {
      setProblem(failure.message)
    } finally {
      setIsLoadingOlder(false)
    }
  }

  const items = grouped(messages)
  const hasOlder = messages.length > 0 && messages[0].index > 0
  const last = items[items.length - 1]
  // New messages keep the newest in view, unless the person has scrolled up to read.
  useLayoutEffect(() => {
    if (!list.current) return
    if (keepFromBottom.current !== null) {
      list.current.scrollTop = list.current.scrollHeight - keepFromBottom.current
      keepFromBottom.current = null
    } else if (isNearEnd.current) {
      list.current.scrollTop = list.current.scrollHeight
    }
  }, [items.length, last?.index, last?.text])

  return createPortal(
    <section className="mia-sheet full agent-chat" role="dialog" aria-label={`${person.name}'s conversation`}>
      <header className="mia-head chat-head">
        <button className="icon chat-back" aria-label="Back" title="Back" onClick={onClose}><ChevronLeft size={26} /></button>
        <span className="chat-photo">{portrait ?? <span className="chat-initial" aria-hidden="true">{person.name.slice(0, 1)}</span>}</span>
        <div className="mia-who">
          <b>{person.name}</b>
          <small>{team} · <span className={`chat-state ${person.isRunning ? 'working' : ''}`}>{state}</span></small>
        </div>
      </header>
      <div className="mia-messages chat-thread" ref={list} aria-live="polite" onScroll={event => { const el = event.currentTarget; isNearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}>
        {hasOlder && <button className="chat-older" disabled={isLoadingOlder} onClick={loadOlder}>{isLoadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
        {isLoaded && items.length === 0 && <p className="mia-empty">Nothing in {person.name}'s conversation yet.</p>}
        {items.map(item => (
          <React.Fragment key={item.index}>
            {item.newDay && <div className="chat-day"><span>{dayLabel(Date.parse(item.at))}</span></div>}
            <Message item={item} />
          </React.Fragment>
        ))}
      </div>
      {problem && <p className="error mia-problem">{problem}</p>}
      <footer className="chat-readonly"><Eye size={14} aria-hidden="true" /> Read-only. Messages can't be sent from here.</footer>
    </section>,
    document.body,
  )
}
