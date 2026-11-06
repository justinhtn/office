import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, GitMerge, HelpCircle, ScanFace, X } from 'lucide-react'
import { api } from './api.js'
import { approvalOptions, approveWithFaceId } from './faceId.js'
import { cardStatus, isOpen, minutesLeft, orderedCards } from './approvalCards.js'

const POLL_MS = 3000
// Challenges last five minutes on the server, so they're fetched again before then.
const OPTIONS_MS = 4 * 60 * 1000

function MergeFacts({ card }) {
  return (
    <>
      <p className="card-title">
        <a href={card.url} target="_blank" rel="noreferrer">Pull request {card.pr} <ExternalLink size={12} /></a>
      </p>
      <ul className="card-facts" aria-label="What GitHub says">
        <li>In {card.repo}, at commit <code>{card.sha.slice(0, 7)}</code></li>
        <li>The <code>check</code> passed on that commit, which doesn't change the workflows</li>
        {card.verdict && <li>The reviewer, {card.verdict.by}: “{card.verdict.line}”</li>}
      </ul>
      {/* Whoever wrote the PR chose its title, so it's shown as their words, not as a fact. */}
      <blockquote className="card-summary"><small>Its title, by its author</small>{card.title}</blockquote>
    </>
  )
}

function Card({ card, canApprove, options, onDone }) {
  const [problem, setProblem] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const act = async run => {
    setProblem('')
    setIsBusy(true)
    try { onDone(await run()) } catch (failure) { setProblem(failure.name === 'NotAllowedError' ? 'Face ID was cancelled.' : failure.message) } finally { setIsBusy(false) }
  }
  const open = isOpen(card)

  return (
    <article className={`approval-card ${card.status}`}>
      <header>
        {card.kind === 'merge' ? <GitMerge size={16} /> : <HelpCircle size={16} />}
        <b>{card.kind === 'merge' ? 'Merge a pull request' : 'A question'}</b>
        <small>{card.requestedBy.name} asks{open ? ` · ${minutesLeft(card)} min left` : ''}</small>
      </header>
      {card.kind === 'merge' ? <MergeFacts card={card} /> : <p className="card-title"><span>{card.question}</span></p>}
      {card.summary && <blockquote className="card-summary"><small>{card.requestedBy.name} says</small>{card.summary}</blockquote>}
      {open && canApprove !== null && (
        <div className="card-actions">
          {card.kind === 'choice'
            ? card.options.map(option => <button key={option} disabled={isBusy} onClick={() => act(() => api('/api/approvals/answer', { id: card.id, option }))}>{option}</button>)
            : canApprove
              ? <button className="primary" disabled={isBusy || !options} onClick={() => act(() => approveWithFaceId(card.id, options))}><ScanFace size={15} /> Approve with Face ID</button>
              : <small>Set up Face ID on this device to approve here.</small>}
          <button className="decline" disabled={isBusy} onClick={() => act(() => api('/api/approvals/decline', { id: card.id }))}>Decline</button>
        </div>
      )}
      {open && canApprove === null && <small className="card-status">Answer on your iPhone or iPad. On the Mac, cards are read-only.</small>}
      {!open && <small className="card-status">{cardStatus(card)}</small>}
      {problem && <p className="error">{problem}</p>}
    </article>
  )
}

// Approval cards. On a signed-in device they can be answered; on the Mac's own port they're shown read-only.
export default function ApprovalCards({ isPhone, isDevice, onClose }) {
  const [view, setView] = useState(null)
  const [problem, setProblem] = useState('')
  const [options, setOptions] = useState({})
  const fetchedAt = useRef({})

  useEffect(() => {
    let isStopped = false
    let timer
    const load = async () => {
      try {
        const next = await api('/api/approvals')
        if (!isStopped) { setView(next); setProblem('') }
      } catch (failure) {
        if (!isStopped) setProblem(failure.message)
      }
      if (!isStopped) timer = setTimeout(load, POLL_MS)
    }
    load()

    return () => { isStopped = true; clearTimeout(timer) }
  }, [])

  // Face ID's challenge is fetched before the tap, because Safari may refuse Face ID if the tap waits on the network first.
  useEffect(() => {
    if (!view?.canApprove) return
    view.cards.filter(card => card.kind === 'merge' && isOpen(card)).forEach(card => {
      if (Date.now() - (fetchedAt.current[card.id] ?? 0) < OPTIONS_MS) return
      fetchedAt.current[card.id] = Date.now()
      approvalOptions(card.id).then(found => setOptions(all => ({ ...all, [card.id]: found })), () => { fetchedAt.current[card.id] = 0 })
    })
  }, [view])

  useEffect(() => {
    const close = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)

    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const done = next => {
    setView(next)
    // A challenge works once, so a used or stale one is fetched again.
    fetchedAt.current = {}
  }
  const cards = orderedCards(view?.cards)

  return createPortal(
    <>
      {!isPhone && <div className="mia-backdrop" onClick={onClose} />}
      <section className={`mia-sheet approvals-sheet ${isPhone ? 'full' : ''}`} role="dialog" aria-label="Approval cards">
        <header className="mia-head">
          <div className="mia-who"><b>Approvals</b><small>{isDevice ? 'Approving a merge takes Face ID on this device' : 'Read-only on the Mac'}</small></div>
          <button className="icon" aria-label="Close" title="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="mia-messages">
          {view && cards.length === 0 && <p className="mia-empty">Nothing is waiting for your approval.</p>}
          {cards.map(card => <Card key={card.id} card={card} canApprove={isDevice ? Boolean(view?.canApprove) : null} options={options[card.id]} onDone={done} />)}
        </div>
        {problem && <p className="error mia-problem">{problem}</p>}
      </section>
    </>,
    document.body,
  )
}
