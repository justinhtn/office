import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { Tree } from 'react-arborist'
import {
  Building2, ChevronDown, ChevronRight, File as FileIcon, FileDiff, Folder, FolderTree, Images, ExternalLink,
  Check, Circle, Gauge, CircleDot, Dices, LayoutGrid, Maximize2, Pause, Pencil, Play, MessageCircle, Newspaper, Power, Search, Moon, Users, Volume2, VolumeX, SkipForward, X,
  Hand, Maximize, Minus, Pin, Plus, RotateCcw,
} from 'lucide-react'
import { CAST, OWNER_AVATAR, createScene, helperCast, portrait } from './scene.js'
import { isTouchDevice } from './device.js'
import { age, announce, api, listenToEdition, speak, teamsOf, withId } from './api.js'
import ReactMarkdown from 'react-markdown'

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
const statusOf = p => (p.request ? 'asks' : p.isRunning ? 'working' : p.isFinished ? 'finished' : 'idle')
const STATUS_LABEL = { asks: 'Asking for you', working: 'Working', finished: 'Finished', idle: 'Idle' }
// Each font is only downloaded once someone picks it.
async function loadBoardFont(family) {
  const id = `board-font-${family.replace(/ /g, '-')}`
  if (family !== 'Inter' && !document.getElementById(id)) {
    const link = Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;500;600&display=swap` })
    document.head.appendChild(link)
    await new Promise(resolve => { link.onload = resolve; link.onerror = resolve })
  }
  await Promise.all(['400', '500', '600'].map(weight => document.fonts.load(`${weight} 20px "${family}"`))).catch(() => {})
}

// How fast the room draws. This only changes the page: unlike the Sleep button, it leaves alerts and voices alone.
function useRoomPace() {
  const [pace, setPace] = useState('active')
  const lastInput = useRef(Date.now())
  const wake = () => {
    lastInput.current = Date.now()
    setPace(document.hidden ? 'hidden' : 'active')
  }
  useEffect(() => {
    const check = () => {
      const idle = Date.now() - lastInput.current
      setPace(document.hidden ? 'hidden' : idle >= ROOM_ASLEEP_MS ? 'asleep' : idle >= ROOM_WATCHING_MS ? 'watching' : 'active')
    }
    const onVisibility = () => (document.hidden ? check() : wake())
    const inputs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']
    inputs.forEach(name => window.addEventListener(name, wake, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    check()
    const timer = setInterval(check, 1000)

    return () => {
      clearInterval(timer)
      inputs.forEach(name => window.removeEventListener(name, wake))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return [pace, wake]
}

const CLAIM_MARKS = { checked: 'Checked', flagged: 'Flagged', unconfirmed: "Couldn't confirm" }
const PRESENTATION_CHOICE = 'office-presentation-choice'
const PRESENTATION_SHIFT = .29
const ignoreRoomClick = () => {}
const ZOOM_STEP = 8

// A teammate walks the person through finished work, claim by claim. Marks come from the server's code checks.
function Presentation({ person, everyone, onClose }) {
  const [work, setWork] = useState(null)
  const [problem, setProblem] = useState('')
  const [step, setStep] = useState(0)
  const [isWalking, setIsWalking] = useState(true)
  const [pointer, setPointer] = useState(null)
  const [choice, setChoice] = useState(null)
  const page = useRef(null)
  useEffect(() => {
    api('/api/presentation').then(next => {
      setWork(next)
      try {
        const saved = JSON.parse(localStorage.getItem(PRESENTATION_CHOICE))
        if (saved?.id === next.id) setChoice(saved.choice)
      } catch {}
    }, failure => setProblem(failure.message))
  }, [])
  const claims = work?.claims ?? []
  const current = isWalking ? claims[step] : null
  const atEnd = work && !current
  useEffect(() => {
    const place = () => {
      const target = current && page.current?.querySelector(`[data-claim="${current.id}"]`)
      if (!target) return setPointer(null)
      const box = page.current.getBoundingClientRect(), spot = target.getClientRects()[0]
      setPointer(spot.top - box.top + page.current.scrollTop)
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    place()
    window.addEventListener('resize', place)

    return () => window.removeEventListener('resize', place)
  }, [current?.id])
  const next = () => (step + 1 < claims.length ? setStep(step + 1) : setIsWalking(false))
  const back = () => { setIsWalking(true); setStep(Math.max(0, isWalking ? step - 1 : claims.length - 1)) }
  const onKey = useRef()
  onKey.current = event => {
    if (/^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return
    const action = { ArrowRight: () => isWalking && next(), ArrowLeft: back, Escape: () => (isWalking ? setIsWalking(false) : onClose()) }[event.key]
    if (!action) return
    event.stopImmediatePropagation()
    action()
  }
  useEffect(() => {
    const listen = event => onKey.current(event)
    window.addEventListener('keydown', listen, true)

    return () => window.removeEventListener('keydown', listen, true)
  }, [])
  const decide = made => {
    setChoice(made)
    try { localStorage.setItem(PRESENTATION_CHOICE, JSON.stringify({ id: work.id, choice: made, at: new Date().toISOString() })) } catch {}
  }
  const count = mark => claims.filter(claim => claim.mark === mark).length
  const claimById = Object.fromEntries(claims.map(claim => [claim.id, claim]))
  const open = claims.filter(claim => claim.mark !== 'checked')

  return (
    <section className="presentation" aria-label={`${person.name} presents finished work`}>
      <header className="presentation-head">
        <Avatar person={person} everyone={everyone} size={36} />
        <div><small>{person.name} is showing you</small><b>{work?.title ?? 'Finished work'}</b></div>
        <button className="icon" aria-label="Close" title="Close" onClick={onClose}><X size={16} /></button>
      </header>
      {problem && <p className="error">{problem}</p>}
      {work && <>
        <p className="presentation-counts">
          <span className="claim-mark checked">{count('checked')} {CLAIM_MARKS.checked}</span>
          <span className="claim-mark flagged">{count('flagged')} {CLAIM_MARKS.flagged}</span>
          <span className="claim-mark unconfirmed">{count('unconfirmed')} {CLAIM_MARKS.unconfirmed}</span>
        </p>
        <article className="presentation-page" ref={page}>
          {work.paragraphs.map((parts, index) => (
            <p key={index}>{parts.map((part, at) => {
              if (!part.claim) return <span key={at}>{part.text}</span>
              const claim = claimById[part.claim]

              return (
                <button key={at} data-claim={claim.id} className={`claim ${claim.mark} ${current?.id === claim.id ? 'current' : ''}`} onClick={() => { setIsWalking(true); setStep(claims.indexOf(claim)) }}>
                  {claim.text} <span className={`claim-mark ${claim.mark}`}>{CLAIM_MARKS[claim.mark]}</span>
                </button>
              )
            })}</p>
          ))}
          {pointer !== null && <span className="presentation-pointer" style={{ transform: `translateY(${pointer}px)` }}>{person.name}<i /></span>}
        </article>
        <p className="presentation-origin">{work.origin}</p>
        {current ? (
          <div className="presentation-step">
            <p className="presentation-line"><b>{person.name}:</b> {current.line}</p>
            <p className="presentation-checked"><span className={`claim-mark ${current.mark}`}>{CLAIM_MARKS[current.mark]}</span>{current.mark === 'checked' && ` ${current.checked}.`}</p>
            <div className="presentation-controls">
              <button onClick={back} disabled={step === 0}>Back</button>
              <button onClick={next}>{step + 1 < claims.length ? 'Next' : 'Finish'}</button>
              <button onClick={() => setIsWalking(false)}>Stop</button>
              <small>{step + 1} of {claims.length}</small>
            </div>
          </div>
        ) : atEnd && (
          <div className="presentation-step">
            {open.length > 0 && <>
              <p className="presentation-line"><b>Not confirmed as fact:</b></p>
              <ul className="presentation-open">{open.map(claim => <li key={claim.id}><span className={`claim-mark ${claim.mark}`}>{CLAIM_MARKS[claim.mark]}</span> <q>{claim.text}</q> {claim.checked}.</li>)}</ul>
            </>}
            <div className="presentation-controls">
              <button className={choice === 'looks-good' ? 'chosen' : 'primary'} onClick={() => decide('looks-good')}>Looks good</button>
              <button className={choice === 'change-this' ? 'chosen' : ''} onClick={() => decide('change-this')}>Change this</button>
              <button onClick={back}>Back</button>
            </div>
            {choice && <small>Saved on this computer: {choice === 'looks-good' ? 'Looks good' : 'Change this'}. Nothing was sent.</small>}
          </div>
        )}
      </>}
    </section>
  )
}

function Room({ people, selected, focus, speaker, usage, boardFont, lightsOut, pace, viewShift = 0, mapHost, onPick, onSpace, onHome }) {
  const stage = useRef(null), canvas = useRef(null), tags = useRef(null), scene = useRef(null)
  const pick = useRef(onPick), space = useRef(onSpace)
  const [hasSavedView, setHasSavedView] = useState(false)
  const [isHandTool, setIsHandTool] = useState(false)
  const homeLabel = hasSavedView ? 'Back to your default view' : 'Back to the whole office'
  pick.current = onPick
  space.current = onSpace
  useEffect(() => {
    scene.current = createScene(stage.current, canvas.current, tags.current, (id, isMap) => pick.current(id, isMap), (key, isMap) => space.current(key, isMap))
    mapHost.current?.appendChild(scene.current.map)
    setHasSavedView(scene.current.hasSavedView())

    return () => scene.current.dispose()
  }, [])
  useEffect(() => {
    scene.current.update(people, selected, focus, speaker, usage)
  }, [people, selected, focus, speaker, usage])
  useEffect(() => {
    scene.current.setLightsOut(lightsOut)
  }, [lightsOut])
  useEffect(() => {
    // Its button is hidden during a presentation, so it rests until that ends.
    scene.current.setHandTool(isHandTool && !viewShift)
  }, [isHandTool, viewShift])
  useEffect(() => {
    scene.current.setPace(pace)
  }, [pace])
  useEffect(() => {
    scene.current.setViewShift(viewShift)
  }, [viewShift])

  useEffect(() => {
    let isCurrent = true
    loadBoardFont(boardFont).then(() => { if (isCurrent) scene.current.setBoardFont(boardFont) })

    return () => { isCurrent = false }
  }, [boardFont])

  return (
    <div className="room" ref={stage}>
      <canvas ref={canvas} aria-label="3D office floor showing active agents" />
      <div className="tags" ref={tags} />
      <div className="zoom-controls" role="group" aria-label="Zoom the office" onMouseUp={event => event.target.closest('button')?.blur()}>
        <button aria-label="Zoom in" title="Zoom in" onClick={() => scene.current.zoomBy(-ZOOM_STEP)}><Plus size={16} /></button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => scene.current.zoomBy(ZOOM_STEP)}><Minus size={16} /></button>
        <button className={isHandTool ? 'on' : ''} aria-label="Hand tool: drag to pan" aria-pressed={isHandTool} title={isHandTool ? 'Hand tool on: drag to pan' : 'Hand tool: drag to pan'} onClick={() => setIsHandTool(!isHandTool)}><Hand size={15} /></button>
        <button aria-label={homeLabel} title={homeLabel} onClick={() => { scene.current.resetView(); onHome() }}><Maximize size={15} /></button>
        <button className={hasSavedView ? 'on' : ''} aria-label="Set this view as the default" title="Set this view as the default" onClick={() => { scene.current.saveView(); setHasSavedView(true); onHome() }}><Pin size={15} /></button>
        {hasSavedView && <button aria-label="Clear the default view" title="Clear the default view, and fit the whole office" onClick={() => { scene.current.clearSavedView(); setHasSavedView(false); onHome() }}><RotateCcw size={15} /></button>}
      </div>
    </div>
  )
}

const isBusy = person => person.isRunning || person.isFinished || Boolean(person.request) || person.meetingWith?.length > 0

// Teams as the office lays them out: anyone idle and alone is in the lounge, unless their team has a name.
function officeTeams(active) {
  return teamsOf(active).filter(team => team.members.length > 1 || isBusy(team.lead) || team.lead.isNamedTeam || team.lead.teamId === 'project:Newsroom')
}

const OWNER = { name: 'You', avatar: OWNER_AVATAR, project: 'Your office' }

// The morning's ten topics to choose from, and then the finished piece to read or listen to.
function Newsroom({ day, onClose }) {
  const [chosen, setChosen] = useState([])
  const [custom, setCustom] = useState('')
  const [problem, setProblem] = useState('')
  const [audio, setAudio] = useState(null)
  const toggle = index => setChosen(current => (current.includes(index) ? current.filter(one => one !== index) : [...current, index].slice(-2)))
  const send = () => api('/api/newsroom/pick', { choices: chosen, custom }).catch(failure => setProblem(failure.message))
  const listen = async () => {
    setProblem('')
    try { setAudio(await listenToEdition()) } catch (failure) { setProblem(failure.message) }
  }

  return (
    <section className="session newsroom">
      <header className="session-head">
        <div className="session-who"><b className="name">Newsroom</b><small>{day.date}</small></div>
        <button className="icon" aria-label="Close" title="Close" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="scroll pad newsroom-body">
        {problem && <p className="error">{problem}</p>}
        {day.edition ? <>
          {audio ? <audio src={audio} controls autoPlay /> : <button className="voice-mode" onClick={listen}><Volume2 size={14} /> Listen, using ElevenLabs credits</button>}
          <article className="newsroom-piece"><ReactMarkdown components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{day.edition}</ReactMarkdown></article>
        </> : day.pick ? <p>Your pick is in. Nell is writing it now.</p> : day.topics.length ? <>
          <p>Pick one or two for today, or type your own.</p>
          {day.topics.map((topic, index) => (
            <label key={index} className={`newsroom-topic ${chosen.includes(index) ? 'on' : ''}`}>
              <input type="checkbox" checked={chosen.includes(index)} onChange={() => toggle(index)} />
              <span><b>{topic.title}</b><small>{[topic.area, topic.minutes && `${topic.minutes} min`].filter(Boolean).join(' · ')}</small><span>{topic.why}</span></span>
            </label>
          ))}
        </> : <p>Nothing yet today. Nell looks for topics each morning.</p>}
      </div>
      {!day.edition && !day.pick && day.topics.length > 0 && (
        <footer className="newsroom-send">
          <input className="newsroom-custom" placeholder="Or something else you're curious about" value={custom} onChange={event => setCustom(event.target.value)} />
          <button className="primary" disabled={!chosen.length && !custom.trim()} onClick={send}>Write today's piece</button>
        </footer>
      )}
    </section>
  )
}

function TeamMenu({ focus, mapHost, onPlace, onNews, children }) {
  return (
    <nav className="team-menu team-list" aria-label="Go to a team">
      {children}
      <span className="team-divider" />
      <button className={`team-button ${focus ? '' : 'on'}`} onClick={() => onPlace(null)}>
        <span className="place-icon"><LayoutGrid size={17} /></span><b>Overview</b>
      </button>
      <div className="map-host" ref={mapHost} />
      <button className="team-button" onClick={onNews}><span className="place-icon"><Newspaper size={17} /></span><b>Today's reading</b></button>
    </nav>
  )
}

// Slides over the room when asked for, so the office keeps the whole window the rest of the time.
// It leaves the team list, whose glass would otherwise hold it inside the panel.
function Drawer({ onClose, children }) {
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">{children}</aside>
    </>,
    document.querySelector('.corner'),
  )
}

// Opens at the top of the team list. Its row stays in view and folds it away again.
function ListSection({ icon: Icon, title, label, className = '', onClose, children }) {
  return (
    <section className={`list-section ${className}`} aria-label={label}>
      <button className="team-button on" aria-expanded="true" aria-label={`${title}. Back to the floor`} title="Back to the floor" onClick={onClose}>
        <span className="place-icon"><Icon size={17} /></span><b>{title}</b><ChevronDown size={14} />
      </button>
      <div className="list-section-body">{children}</div>
    </section>
  )
}

function TeamName({ person }) {
  return <EditableText key={person.teamId} value={person.teamName} label="team name" className="team-rename" onSave={name => api('/api/team-name', { teamId: person.teamId, name })} />
}

// Which team someone is on, chosen here if the office guessed wrong.
function TeamChoice({ person, teams }) {
  const [problem, setProblem] = useState('')
  const names = [...new Set(teams.filter(team => !team.isIndependent).map(team => team.name))]
  if (!person.isIndependent && !names.includes(person.teamName)) names.push(person.teamName)
  const current = person.isIndependent ? 'independent' : person.teamName
  const choose = async event => {
    let team = event.target.value
    if (team === 'new') team = window.prompt('Name the new team') || ''
    if (!team) return
    try {
      await api('/api/team', { id: person.id, team })
      setProblem('')
    } catch (failure) {
      setProblem(failure.message)
    }
  }

  return (
    <div className="team-choice">
      <label>Team
        <select value={current} onChange={choose}>
          {names.map(name => <option key={name} value={name}>{name}</option>)}
          <option value="independent">Independent developer</option>
          <option value="new">New team…</option>
        </select>
      </label>
      {!person.isIndependent && <TeamName person={person} />}
      {problem && <small className="error">{problem}</small>}
    </div>
  )
}

function Teammates({ person, teams, onPick }) {
  const team = teams.find(one => one.members.some(member => member.id === person.id))
  if (!team || team.members.length < 2) return null

  return (
    <nav className="teammates" aria-label="Team members">
      {team.members.map(member => (
        <button key={member.id} className={`mate ${member.id === person.id ? 'on' : ''}`} onClick={() => onPick(member.id)}>
          <Avatar person={member} size={22} />{member.name}{member.id === team.lead.id ? ' · lead' : ''}
        </button>
      ))}
    </nav>
  )
}

function Avatar({ person, size = 24 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let isCurrent = true
    portrait(person).then(made => { if (isCurrent) setUrl(made) }, () => {})

    return () => { isCurrent = false }
  }, [person.avatar, person.project])

  return url
    ? <img className="avatar" src={url} alt="" width={size} height={size} />
    : <span className="avatar blank" style={{ width: size, height: size }}>{person.name[0]}</span>
}

const FONT_SETTING = 'office-board-font'
const BOARD_FONTS = ['Inter', 'Geist', 'IBM Plex Sans', 'DM Sans', 'Manrope', 'Space Grotesk']
const LINES_SETTING = 'office-voice-lines'
const BUILD_CHECK_MS = 15000
const NEWS_READ_SETTING = 'office-news-read'
const USAGE_CHECK_MS = 15000
const ROOM_WATCHING_MS = 30 * 1000
const ROOM_ASLEEP_MS = 30 * 60 * 1000
const COMPACTED_NOTE_S = 3600
const PRESENCE_CHECK_MS = 5000
const DESK_QUIET_MS = 180000
const DESK_CHECK_MS = 30000
const ANNOUNCED_SETTING = 'office-announced'
const ANNOUNCED_KEPT = 200

// One voice at a time: agents you have open, and anyone asking for you. The rest stay quiet.
function useVoices(everyone, listening, isAway, isOn, setIsOn) {
  const [speaksWhileWorking, setSpeaksWhileWorking] = useState(() => {
    try { return localStorage.getItem(LINES_SETTING) !== 'off' } catch { return true }
  })
  const [speaker, setSpeaker] = useState(null)
  const [problem, setProblem] = useState('')
  const heard = useRef(new Map())
  const heardLines = useRef(new Map())
  // Remembered across reloads, so nobody is announced twice.
  const announced = useRef((() => {
    try { return new Set(JSON.parse(localStorage.getItem(ANNOUNCED_SETTING) || '[]')) } catch { return new Set() }
  })())
  const lastAnnouncement = useRef(0)
  const wasAway = useRef(false)
  const checkDesk = useRef(() => {})
  const spokenLines = useRef(new Map())
  const queue = useRef([])
  const player = useRef(null)
  const next = useRef(() => {})
  next.current = async () => {
    if (player.current || !queue.current.length) return
    const { id, kind, ids, isWelcome } = queue.current.shift()
    const audio = player.current = new Audio()
    const finish = () => {
      if (audio.src) URL.revokeObjectURL(audio.src)
      if (player.current === audio) player.current = null
      setSpeaker(null)
      next.current()
    }
    audio.stop = finish
    audio.onended = finish
    audio.onerror = finish
    setSpeaker(id)
    try {
      audio.src = ids ? await announce(ids, isWelcome) : await speak(id, kind)
      if (player.current !== audio) return
      await audio.play()
      setProblem('')
    } catch (failure) {
      // Browsers block sound until a window is clicked, so the Mac plays it instead.
      if (failure.name === 'NotAllowedError') {
        await (ids ? announce(ids, isWelcome, true) : speak(id, kind, true)).catch(() => {})
      } else {
        setProblem(failure.message)
      }
      finish()
    }
  }
  useEffect(() => {
    for (const person of everyone) {
      const isListening = listening.includes(person.id)
      // Lines written mid-turn replace any still waiting, so you never hear a backlog.
      const wasLine = heardLines.current.get(person.id)
      heardLines.current.set(person.id, person.lineKey)
      if (isOn && !isAway && speaksWhileWorking && isListening && person.isActing && wasLine !== undefined && wasLine !== person.lineKey) {
        queue.current = [...queue.current.filter(item => item.ids || item.id !== person.id || item.kind !== 'line'), { id: person.id, kind: 'line' }]
        spokenLines.current.set(person.id, person.lineKey)
      }
      const wasHeard = heard.current.get(person.id)
      if (person.isActing && !person.request) continue
      heard.current.set(person.id, person.wordsKey)
      const isNew = wasHeard !== undefined && wasHeard !== person.wordsKey
      if (!isOn || isAway || !isNew || !isListening) continue
      if (person.wordsAreLine && spokenLines.current.get(person.id) === person.lineKey) continue
      queue.current = [...queue.current.filter(item => item.ids || item.id !== person.id), { id: person.id, kind: 'words' }]
    }
    checkDesk.current()
    next.current()
  }, [everyone, listening.join(), isOn, speaksWhileWorking, isAway])
  // Requests and finished work are announced once by the front desk, and held while you're away.
  checkDesk.current = () => {
    const wanting = everyone.filter(person => (person.request || person.isFinished) && !person.isAssistant && !listening.includes(person.id))
    const keyOf = person => (person.request ? `${person.id}:${person.request.id}` : `${person.id}:${person.wordsKey}`)
    const isBack = wasAway.current && !isAway
    wasAway.current = isAway
    const waiting = wanting.filter(person => !announced.current.has(keyOf(person)))
    if (!isOn || isAway || !waiting.length) return
    if (!isBack && Date.now() - lastAnnouncement.current < DESK_QUIET_MS) return
    waiting.forEach(person => announced.current.add(keyOf(person)))
    try { localStorage.setItem(ANNOUNCED_SETTING, JSON.stringify([...announced.current].slice(-ANNOUNCED_KEPT))) } catch {}
    lastAnnouncement.current = Date.now()
    queue.current.push({ id: everyone.find(person => person.isAssistant)?.id ?? null, ids: waiting.map(person => person.id), isWelcome: isBack })
    next.current()
  }
  useEffect(() => {
    const timer = setInterval(() => checkDesk.current(), DESK_CHECK_MS)

    return () => clearInterval(timer)
  }, [])
  function toggle() {
    const on = !isOn
    setIsOn(on)
    api('/api/voice-mode', { isOn: on }).catch(failure => setProblem(failure.message))
    // Hearing someone straight away shows it works, and the click lets the browser play sound.
    if (on) hear(listening[0] || [...everyone].sort((one, other) => Date.parse(other.lastActivityAt || 0) - Date.parse(one.lastActivityAt || 0))[0]?.id)
  }
  // Also covers voice mode being turned off in another window, and anyone stepping away.
  useEffect(() => {
    if (isOn && !isAway) return
    queue.current = []
    skip()
  }, [isOn, isAway])
  function hear(id) {
    if (!id) return
    if (!isOn) {
      setProblem('Voice mode is off')
      return
    }
    queue.current = [{ id, kind: 'words' }, ...queue.current.filter(item => item.ids || item.id !== id)]
    next.current()
  }
  function toggleWhileWorking() {
    const on = !speaksWhileWorking
    setSpeaksWhileWorking(on)
    try { localStorage.setItem(LINES_SETTING, on ? 'on' : 'off') } catch {}
    if (!on) queue.current = queue.current.filter(item => item.kind !== 'line')
  }
  function skip() {
    const audio = player.current
    if (!audio) return
    audio.pause()
    audio.stop()
  }

  return { isOn, speaker, problem, toggle, skip, hear, speaksWhileWorking, toggleWhileWorking }
}

function Meter({ label, percent, detail }) {
  return (
    <div className="meter">
      <span><b>{label}</b><small>{detail}</small></span>
      <div className="meter-track"><i className={percent >= 80 ? 'high' : ''} style={{ width: `${Math.min(100, percent)}%` }} /></div>
    </div>
  )
}

// What's running and what it's costing, on the person's own desk.
function Usage({ usage, people, boardFont, onBoardFont, onPick, onClose }) {
  const working = people.filter(person => person.isActing)
  const jobs = people.flatMap(person => (person.jobs || []).map(job => ({ person, job })))
  const speech = usage?.speech
  const claude = usage?.claude

  return (
    <section className="session usage">
      <header className="session-head">
        <div className="session-who"><b className="name">Usage</b></div>
        <button className="icon" aria-label="Back to the floor" title="Back to the floor" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="scroll pad usage-list">
        {!people.some(person => person.isAssistant) && (
          <button className="primary assistant-setup" onClick={() => api('/api/assistant', {}).catch(() => {})}>Set up your assistant</button>
        )}
        <h3>Claude Code{claude?.plan ? ` · ${claude.plan}` : ''}</h3>
        {claude?.windows?.map(window => <Meter key={window.label} label={window.label} percent={window.percentUsed} detail={`${window.percentUsed}% · resets in ${window.resetsIn}`} />)}
        {claude?.extraUsage?.enabled && <Meter label="Extra usage" percent={100 * Number(claude.extraUsage.spent) / Number(claude.extraUsage.monthlyLimit || 1)} detail={`$${claude.extraUsage.spent} of $${claude.extraUsage.monthlyLimit}`} />}
        {!claude?.windows?.length && <small>Not available yet. It appears once a session running the latest plugin reports it.</small>}

        <h3>ElevenLabs</h3>
        {speech?.isOn ? <>
          <Meter label="Today" percent={100 * speech.today / speech.cap} detail={`${speech.today.toLocaleString()} of ${speech.cap.toLocaleString()} characters`} />
          <small>{speech.month.toLocaleString()} characters this month, from the office only. Voices stop for the day at the limit.</small>
        </> : <small>Voices aren't set up.</small>}

        <h3>Modal</h3>
        {usage?.modal
          ? usage.modal.isUnknownFormat ? <small>Can't read Modal's list. This version of the modal command uses a format the office doesn't know.</small> : (usage.modal.count ? usage.modal.running.map((app, index) => <div key={index} className="usage-row"><span className="dot working" /><span>{app}</span></div>).concat(usage.modal.count > usage.modal.running.length ? <small key="more">and {usage.modal.count - usage.modal.running.length} more</small> : []) : <small>No apps running.</small>)
          : <small>{usage?.modalChecked ? 'Not available. Install the Modal command to see running apps. Spend is on the Modal dashboard.' : 'Checking Modal…'}</small>}

        <h3>Running now</h3>
        {working.map(person => <button key={person.id} className="usage-row" onClick={() => onPick(person.id)}><span className="dot working" /><b>{person.name}</b><small>{person.step || 'Working'}</small></button>)}
        {jobs.map(({ person, job }) => <button key={`${person.id}${job}`} className="usage-row" onClick={() => onPick(person.id)}><span className="dot finished" /><b>{person.name}</b><small>{job}{person.jobStartedAt ? ` · ${Math.max(1, Math.round((Date.now() / 1000 - person.jobStartedAt) / 60))}m` : ''}</small></button>)}
        {!working.length && !jobs.length && <small>Nothing is running.</small>}

        <h3>Screens</h3>
        <label className="font-choice">Font
          <select value={boardFont} onChange={event => onBoardFont(event.target.value)}>
            {BOARD_FONTS.map(font => <option key={font} value={font}>{font}</option>)}
          </select>
        </label>
      </div>
    </section>
  )
}

function Empty({ text }) {
  return <div className="empty">{text}</div>
}

function MediaItem({ file, ...props }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="media-missing">{file.name} is no longer available.</div>

  return file.kind === 'video'
    ? <video src={file.url} preload="metadata" playsInline onError={() => setFailed(true)} {...props} />
    : <img src={file.url} alt={file.name} onError={() => setFailed(true)} />
}

function formatTime(seconds) {
  const whole = Math.floor(seconds || 0)

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

// Plays every video together from one set of controls, so differences are easy to see.
function Stage({ files, caption, onClose }) {
  const box = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const videos = () => [...box.current.querySelectorAll('video')]
  const hasVideo = files.some(file => file.kind === 'video')
  function toggle() {
    const next = !isPlaying
    videos().forEach(video => (next ? video.play().catch(() => {}) : video.pause()))
    setIsPlaying(next)
  }
  function seek(value) {
    videos().forEach(video => { video.currentTime = value })
    setTime(value)
  }
  function onTick(event) {
    const [lead, ...rest] = videos()
    if (event.target !== lead) return
    setTime(lead.currentTime)
    rest.forEach(video => {
      if (Math.abs(video.currentTime - lead.currentTime) > 0.12) video.currentTime = lead.currentTime
    })
  }
  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className="stage" aria-label="Media viewer">
      <div className={`stage-grid count-${Math.min(files.length, 4)}`} ref={box}>
        {files.map(file => (
          <figure key={file.url}>
            <MediaItem file={file} loop muted onTimeUpdate={onTick} onLoadedMetadata={event => setDuration(current => Math.max(current, event.target.duration || 0))} />
            <figcaption>{file.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="stage-controls">
        {hasVideo && <>
          <button className="icon" aria-label={isPlaying ? 'Pause all' : 'Play all'} onClick={toggle}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
          <input type="range" min="0" max={duration || 0} step="0.01" value={Math.min(time, duration || 0)} aria-label="Position in the videos" onChange={event => seek(Number(event.target.value))} />
          <small>{formatTime(time)} / {formatTime(duration)}</small>
        </>}
        <small className="stage-caption">{caption}</small>
        <button className="icon" aria-label="Close viewer" onClick={onClose}><X size={16} /></button>
      </div>
    </section>
  )
}

function Plan({ plan }) {
  const done = plan.filter(item => item.status === 'completed').length

  return (
    <details className="plan" open={done < plan.length}>
      <summary>Tasks · {done} of {plan.length} done</summary>
      <ul>
        {plan.map((item, index) => (
          <li key={index} className={item.status}>
            {item.status === 'completed' ? <Check size={13} /> : item.status === 'in_progress' ? <CircleDot size={13} /> : <Circle size={13} />}
            <span>{item.content}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function WorkingLine({ person, plan, turnStartedAt }) {
  if (!person.isRunning) return null
  const current = plan.find(item => item.status === 'in_progress')

  return (
    <div className="working-line">
      <span className="dot working" />
      {person.isWaiting
        ? `${person.name} is waiting on a job: ${person.jobs[0]}${person.jobs.length > 1 ? ` (+${person.jobs.length - 1})` : ''}`
        : `${person.name} is working${current ? ` on: ${current.content}` : ''}`}
      {turnStartedAt && <small> · {age(turnStartedAt)}</small>}
    </div>
  )
}

function Helpers({ person }) {
  if (!person.helpers?.length) return null

  return (
    <div className="helpers">
      <small>{person.helpers.length} helper{person.helpers.length > 1 ? 's' : ''} working</small>
      {person.helpers.map((label, index) => (
        <span key={`${label}-${index}`} className="helper">
          <Avatar person={{ avatar: CAST[helperCast(label, index)], project: person.project, name: label }} size={22} />
          {label}
        </span>
      ))}
    </div>
  )
}

// Chat and approvals happen in the Claude app, so this shows what an agent has made.
function Outputs({ person, onExpand }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    setError('')
    const load = () => api(withId('/api/outputs', person.id)).then(
      next => { setData(next); setError('') },
      failure => setError(failure.message),
    )
    load()
    const timer = setInterval(load, 8000)

    return () => clearInterval(timer)
  }, [person.id])

  return (
    <div className="chat">
      {data && <WorkingLine person={person} plan={data.plan} turnStartedAt={data.turnStartedAt} />}
      <Helpers person={person} />
      {data?.plan.length > 0 && <Plan plan={data.plan} />}
      <div className="scroll pad messages">
        {error && <p className="error">{error}</p>}
        {!error && !data && <Empty text="Loading…" />}
        {data?.outputs.length === 0 && <Empty text="Videos, images and artifacts this agent shares will appear here." />}
        {data?.outputs.map(output => output.role === 'artifact' ? (
          <a key={output.url} className="artifact" href={output.url} target="_blank" rel="noreferrer">
            <FileIcon size={14} /><span><b>{output.title}</b><small>Artifact</small></span><ExternalLink size={13} />
          </a>
        ) : (
          <article key={output.files[0].url} className="bubble assistant media">
            {output.caption && <p>{output.caption}</p>}
            <div className="media-row">
              {output.files.map(file => <div key={file.url} className="media-item"><MediaItem file={file} controls /></div>)}
            </div>
            <button className="expand" onClick={() => onExpand(output.files, output.caption)}>
              <Maximize2 size={12} /> {output.files.filter(file => file.kind === 'video').length > 1 ? 'Compare side by side' : 'Open large'}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}

function Changes({ person }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(null)
  const [pair, setPair] = useState(null)
  useEffect(() => {
    setData(null); setError(''); setPicked(null); setPair(null)
    api(withId('/api/changed', person.id)).then(setData, failure => setError(failure.message))
  }, [person.id])
  useEffect(() => {
    if (!picked) return
    setPair(null)
    api(withId('/api/filediff', person.id, { path: picked })).then(setPair, failure => setError(failure.message))
  }, [picked, person.id])
  if (error) return <div className="pad"><p className="error">{error}</p></div>
  if (!data) return <Empty text="Loading changes…" />

  return (
    <div className="split-v">
      <div className="pad meta-line"><small>On {data.branch || 'no branch'}</small></div>
      {data.files.length === 0 && <Empty text="No uncommitted changes." />}
      <div className={picked ? 'file-strip' : 'scroll'}>
        {data.files.map(file => (
          <button key={file.path} className={`row ${file.path === picked ? 'on' : ''}`} onClick={() => setPicked(file.path)}>
            <code className="badge">{file.code}</code><span className="row-main"><span>{file.path}</span></span>
          </button>
        ))}
      </div>
      {picked && (
        <div className="editor">
          {pair ? (
            <DiffEditor
              original={pair.original}
              modified={pair.modified}
              theme={isDark() ? 'vs-dark' : 'vs'}
              options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 12 }}
            />
          ) : <Empty text="Loading diff…" />}
        </div>
      )}
    </div>
  )
}

function toTree(paths) {
  const root = { children: [] }
  paths.forEach(path => {
    let node = root
    path.split('/').forEach((name, index, parts) => {
      const id = parts.slice(0, index + 1).join('/')
      node.index ??= {}
      let child = node.index[name]
      if (!child) {
        child = { id, name, ...(index < parts.length - 1 ? { children: [] } : {}) }
        node.index[name] = child
        node.children.push(child)
      }
      node = child
    })
  })
  const clean = nodes =>
    nodes
      .map(({ id, name, children }) => (children ? { id, name, children: clean(children) } : { id, name }))
      .sort((a, b) => Boolean(b.children) - Boolean(a.children) || a.name.localeCompare(b.name))

  return clean(root.children)
}

function useSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 300, height: 300 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(ref.current)

    return () => observer.disconnect()
  }, [])

  return [ref, size]
}

function Files({ person, initialPath, onMedia }) {
  const [paths, setPaths] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [ref, size] = useSize()
  useEffect(() => {
    setPaths(null); setError(''); setOpen(null)
    api(withId('/api/files', person.id)).then(data => setPaths(data.files), failure => setError(failure.message))
  }, [person.id])
  const tree = useMemo(() => toTree(paths || []), [paths])
  useEffect(() => {
    if (initialPath) view(initialPath)
  }, [initialPath, person.id])
  async function view(path) {
    if (/\.(mp4|m4v|mov|webm|png|jpe?g|gif|webp)$/i.test(path) && path !== initialPath) {
      onMedia(path)

      return
    }
    setOpen({ path, text: null })
    try {
      const data = await api(withId('/api/file', person.id, { path }))
      setOpen({ path, text: data.text + (data.truncated ? '\n\n(cut off: file is large)' : '') })
    } catch (failure) {
      setOpen({ path, text: failure.message })
    }
  }

  return (
    <div className="split-v">
      {error && <div className="pad"><p className="error">{error}</p></div>}
      <div className={open ? 'tree short' : 'tree'} ref={ref}>
        {paths && (
          <Tree data={tree} openByDefault={false} width={size.width} height={size.height} rowHeight={26} indent={14} disableDrag disableDrop disableEdit>
            {({ node, style }) => (
              <button
                style={style}
                className={`tree-row ${open?.path === node.id ? 'on' : ''}`}
                onClick={() => (node.isLeaf ? view(node.id) : node.toggle())}
              >
                {node.isLeaf ? <FileIcon size={13} /> : <><ChevronRight size={12} className={node.isOpen ? 'turned' : ''} /><Folder size={13} /></>}
                <span>{node.data.name}</span>
              </button>
            )}
          </Tree>
        )}
      </div>
      {open && (
        <div className="editor">
          <div className="crumb">{open.path}</div>
          {open.text === null ? <Empty text="Loading file…" /> : (
            <Editor
              path={`${person.id}/${open.path}`}
              value={open.text}
              theme={isDark() ? 'vs-dark' : 'vs'}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Palette({ everyone, rooms, onClose, onRoom, onPerson }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <Command label="Search agents and rooms" className="palette" onMouseDown={event => event.stopPropagation()}>
        <Command.Input autoFocus placeholder="Search agents, tasks and rooms" />
        <Command.List>
          <Command.Empty>No matches.</Command.Empty>
          <Command.Group heading="Rooms">
            {rooms.map(room => <Command.Item key={room} value={`room ${room}`} onSelect={() => onRoom(room)}><Building2 size={14} /> {room}</Command.Item>)}
          </Command.Group>
          <Command.Group heading="Agents">
            {everyone.map(person => (
              <Command.Item key={person.id} value={`${person.name} ${person.title} ${person.project}`} onSelect={() => onPerson(person)}>
                <Avatar person={person} everyone={everyone} size={22} /> <span className={`dot ${statusOf(person)}`} /> <b>{person.name}</b> <small>{person.label} · {person.title}</small>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  )
}

const ACTIVE_DAYS = 7
const isActive = person =>
  person.isAssistant || (person.isNamedTeam && person.id === person.teamLeadId) || person.teamId === 'project:Newsroom' || person.isRunning || person.isFinished || Boolean(person.request) || person.meetingWith?.length > 0 ||
  Date.now() - Date.parse(person.lastActivityAt || 0) < ACTIVE_DAYS * 86400000
const SESSION_TABS = [
  { id: 'outputs', label: 'Outputs', icon: Images },
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'files', label: 'Files', icon: FolderTree },
]

function EditableText({ value, label, className, onSave }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  if (draft === null) {
    return <button className={className} title={`Change ${label}`} onClick={() => setDraft(value)}>{value}<Pencil size={11} /></button>
  }
  async function save(event) {
    event.preventDefault()
    try {
      if (draft.trim() !== value) await onSave(draft)
      setDraft(null)
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }

  return (
    <form className="name-form" onSubmit={save}>
      <input autoFocus aria-label={label} value={draft} onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Escape') { setError(''); setDraft(null) } }} />
      {error && <small className="error">{error}</small>}
    </form>
  )
}

// A session works from a summary after compacting, so details may be gone.
function Memory({ person }) {
  const percent = person.contextPercent
  const isRecent = person.compactedAt && Date.now() / 1000 - person.compactedAt < COMPACTED_NOTE_S
  if (!person.isCompacting && !isRecent && percent == null) return null

  return (
    <div className="memory">
      {percent != null && <Meter label="Memory" percent={100 * percent / (person.compactsAt || 100)} detail={`${percent}% full`} />}
      {person.isCompacting && <small>{person.name} is compacting and will carry on from a summary.</small>}
      {!person.isCompacting && isRecent && <small>{person.name} compacted at {new Date(person.compactedAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Check anything important made it through.</small>}
    </div>
  )
}

function RequestBanner({ person, onShow }) {
  const [problem, setProblem] = useState('')
  const dismiss = () => api('/api/dismiss', { id: person.id }).catch(failure => setProblem(failure.message))

  return (
    <div className="request" role="status">
      <div className="request-main">
        <b>{person.name} is asking for you</b>
        <p>{person.request.message}</p>
        {person.request.show.map(path => (
          <button key={path} className="request-file" onClick={() => onShow(path)}><FileIcon size={12} /> {path}</button>
        ))}
        {problem && <small className="error">{problem}</small>}
      </div>
      <button className="dismiss" onClick={dismiss}>Dismiss</button>
    </div>
  )
}

function Session({ person, everyone, teams, tab, isOpen, onOpen, onCloseDetails, onClose, onPick, onHear }) {
  const [showPath, setShowPath] = useState(null)
  const [stage, setStage] = useState(null)
  useEffect(() => setStage(null), [person.id])
  async function show(path) {
    onOpen('files')
    if (/\.(mp4|m4v|mov|webm|png|jpe?g|gif|webp)$/i.test(path)) {
      try {
        const file = await api(withId('/api/media-link', person.id, { path }))
        setStage({ files: [file], caption: path })

        return
      } catch {
        // Falls through to the file viewer, which explains what's wrong.
      }
    }
    setShowPath(path)
  }
  const boss = everyone.find(other => other.id === person.startedBy)
  // Their room's TV already says what they're doing. Mia, the lounge and anyone away have none.
  const hasTv = teams.some(team => team.members.some(member => member.id === person.id))

  return (
    <>
      <ListSection key={person.id} className="person-section" icon={person.isAssistant ? Building2 : Users} title={person.isAssistant ? 'Your office' : person.isIndependent ? 'Independent' : person.teamName} label={person.name} onClose={onClose}>
        <header className="section-head">
          <Avatar person={person} everyone={everyone} size={36} />
          <div className="section-who">
            <EditableText key={`name-${person.id}`} value={person.name} label="name" className="name" onSave={name => api('/api/rename', { id: person.id, name })} />
            <EditableText key={`label-${person.id}`} value={person.label} label="job label" className="job" onSave={label => api('/api/label', { id: person.id, label })} />
          </div>
        </header>
        <div className="section-state">
          <span className={`pill ${statusOf(person)}`}>{statusOf(person) !== 'idle' ? STATUS_LABEL[statusOf(person)] : person.prOutcome || `Idle ${age(person.lastActivityAt)}`}</span>
          <small className="session-title">{boss ? `For ${boss.name}` : ''}{person.prNumber ? ` · PR ${person.prNumber}` : ''}</small>
        </div>
        {!hasTv && person.title && !person.title.startsWith(person.label) && <p className="section-doing">{person.title}</p>}
        <Memory person={person} />
        {person.request && <RequestBanner person={person} onShow={show} />}
        <div className="section-actions">
          {SESSION_TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} className="section-action" onClick={() => onOpen(id)}><Icon size={13} /> {label}</button>
          ))}
          <button className="icon" title="Hear their latest update" aria-label="Hear their latest update" onClick={() => onHear(person.id)}><Volume2 size={14} /></button>
          <button className="icon" title="Try a different look" aria-label="Try a different look" onClick={() => api('/api/reroll', { id: person.id })}><Dices size={14} /></button>
          {person.link?.startsWith('claude://') && <a className="icon" href={person.link} title="Open in Claude app" aria-label="Open in Claude app"><ExternalLink size={14} /></a>}
        </div>
        <details className="section-team">
          <summary>Teammates and team</summary>
          <Teammates person={person} teams={teams} onPick={onPick} />
          <TeamChoice person={person} teams={teams} />
        </details>
      </ListSection>
      {isOpen && (
        <Drawer onClose={onCloseDetails}>
          <section className="session">
            <nav className="session-tabs" role="tablist">
              {SESSION_TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onOpen(id)}><Icon size={14} /> {label}</button>
              ))}
              <button className="icon drawer-close" aria-label="Close" title="Close" onClick={onCloseDetails}><X size={16} /></button>
            </nav>
            {stage && <Stage files={stage.files} caption={stage.caption} onClose={() => setStage(null)} />}
            {tab === 'outputs' && <Outputs person={person} onExpand={(files, caption) => setStage({ files, caption })} />}
            {tab === 'changes' && <Changes person={person} />}
            {tab === 'files' && <Files person={person} initialPath={showPath} onMedia={show} />}
          </section>
        </Drawer>
      )}
    </>
  )
}

function Away({ people, onPick, onClose }) {
  const projects = [...new Set(people.map(person => person.project))]

  return (
    <div className="overlay" onMouseDown={onClose}>
      <section className="away" aria-label="Away" onMouseDown={event => event.stopPropagation()}>
        <h2>Away <small>No activity for {ACTIVE_DAYS} days</small></h2>
        <div className="scroll">
          {projects.map(project => (
            <div key={project} className="team">
              <h3>{project}</h3>
              {people.filter(person => person.project === project).map(person => (
                <button key={person.id} className="row" onClick={() => onPick(person.id)}>
                  <Avatar person={person} size={26} />
                  <span className="row-main"><b>{person.name}</b><small>{person.title}</small></span>
                  <small className="row-age">{age(person.lastActivityAt)}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [everyone, setEveryone] = useState([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [problem, setProblem] = useState('')
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('outputs')
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isAwayOpen, setIsAwayOpen] = useState(false)
  const [place, setPlace] = useState(null)
  const lastPeople = useRef('')

  useEffect(() => {
    const poll = () =>
      api('/api/sessions').then(
        data => {
          // Checked often for quick voices, so only redraw the room when something changed.
          const latest = JSON.stringify(data.people || [])
          if (latest !== lastPeople.current) {
            lastPeople.current = latest
            setEveryone(data.people || [])
          }
          setUpdatedAt(data.updatedAt || '')
          setOnScreen((data.onScreen || []).join(','))
          setProblem('')
        },
        failure => setProblem(failure.message),
      )
    poll()
    const timer = setInterval(poll, 1000)

    return () => clearInterval(timer)
  }, [])
  const [onScreen, setOnScreen] = useState('')
  // Whoever is open in the Claude app speaks, and whoever you clicked here.
  const [usage, setUsage] = useState(null)
  const [newsDay, setNewsDay] = useState(null)
  const [isNewsOpen, setIsNewsOpen] = useState(false)
  const mapHost = useRef(null)
  const [newsRead, setNewsRead] = useState(() => {
    try { return localStorage.getItem(NEWS_READ_SETTING) } catch { return null }
  })
  const newsReadOn = newsRead === newsDay?.date
  function markNewsRead(date) {
    setNewsRead(date)
    try { localStorage.setItem(NEWS_READ_SETTING, date) } catch {}
  }
  useEffect(() => {
    const poll = () => api('/api/newsroom').then(setNewsDay, () => {})
    poll()
    const timer = setInterval(poll, USAGE_CHECK_MS)

    return () => clearInterval(timer)
  }, [])
  const [boardFont, setBoardFont] = useState(() => {
    try { return BOARD_FONTS.find(font => font === localStorage.getItem(FONT_SETTING)) || 'Inter' } catch { return 'Inter' }
  })
  function chooseBoardFont(font) {
    setBoardFont(font)
    try { localStorage.setItem(FONT_SETTING, font) } catch {}
  }
  useEffect(() => {
    const poll = () => api('/api/usage').then(setUsage, () => {})
    poll()
    const timer = setInterval(poll, USAGE_CHECK_MS)

    return () => clearInterval(timer)
  }, [])
  const [isAway, setIsAway] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [awayMode, setAwayMode] = useState(false)
  const [shutDown, setShutDown] = useState(false)
  function toggleShutDown() {
    const on = !shutDown
    setShutDown(on)
    setIsAway(on || awayMode)
    // Waking up lands on the morning's topics, if they're waiting for a pick.
    if (!on && newsDay?.topics.length > 0 && !newsDay.pick && !newsDay.edition) setIsNewsOpen(true)
    api('/api/shut-down', { isOn: on }).catch(failure => setProblem(failure.message))
  }
  function toggleAway() {
    const on = !awayMode
    setAwayMode(on)
    setIsAway(on || shutDown)
    api('/api/away-mode', { isOn: on }).catch(failure => setProblem(failure.message))
  }
  // Step away and the view settles on your desk, where anyone who needs you waits.
  useEffect(() => {
    const poll = () => api('/api/presence').then(data => { setIsAway(Boolean(data.isAway)); setVoiceMode(Boolean(data.voiceMode)); setAwayMode(Boolean(data.awayMode)); setShutDown(Boolean(data.shutDown)) }, () => {})
    poll()
    const timer = setInterval(poll, PRESENCE_CHECK_MS)

    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!isAway) return
    setIsPresenting(false)
    setSelected(null)
    setPlace('office')
  }, [isAway])
  const [presenterId, setPresenterId] = useState(null)
  const [isPresenting, setIsPresenting] = useState(false)
  // The demo presenter's real session isn't read aloud while they present.
  const voices = useVoices(everyone, [...onScreen.split(',').filter(Boolean), isPresenting && selected === presenterId ? null : selected].filter(Boolean), isAway, voiceMode, setVoiceMode)
  const [idlePace, wakeRoom] = useRoomPace()
  // Someone asking for you, or speaking, lights the room back up, and it stays lit while anyone waits.
  const requestIds = everyone.filter(person => person.request).map(person => person.request.id).sort().join()
  const lastRequestIds = useRef(requestIds)
  useEffect(() => {
    const known = lastRequestIds.current.split(',')
    if (!shutDown && requestIds && requestIds.split(',').some(id => !known.includes(id))) wakeRoom()
    lastRequestIds.current = requestIds
  }, [requestIds])
  const roomPace = idlePace === 'asleep' && requestIds && !shutDown ? 'watching' : idlePace
  useEffect(() => {
    if (voices.speaker) wakeRoom()
  }, [voices.speaker])
  // A window left open picks up new builds by itself.
  useEffect(() => {
    const own = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src')
    const timer = setInterval(() => {
      // During a build the page is briefly missing, so only reload for a working one.
      fetch('/', { cache: 'no-store' }).then(response => (response.ok ? response.text() : '')).then(page => {
        if (own && page.includes('/assets/index-') && !page.includes(own)) window.location.reload()
      }).catch(() => {})
    }, BUILD_CHECK_MS)

    return () => clearInterval(timer)
  }, [])
  const keyActions = useRef({ escape() {}, team() {} })
  useEffect(() => {
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsPaletteOpen(open => !open)
      }
      if (event.key === 'Escape') {
        setIsPaletteOpen(false)
        setIsAwayOpen(false)
      }
      const isTyping = /^(INPUT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable
      if (isTyping || event.metaKey || event.ctrlKey) return
      if (event.key === 'Escape' && !document.querySelector('.stage')) keyActions.current.escape()
      if (/^[1-9]$/.test(event.key)) keyActions.current.team(Number(event.key) - 1)
    }
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cast = everyone
  const realActive = useMemo(() => cast.filter(isActive), [cast])
  // ?present is the demo: one teammate has finished work ready. ?present=Name picks who.
  const presentAs = useMemo(() => new URLSearchParams(window.location.search).get('present'), [])
  useEffect(() => {
    if (presentAs === null || presenterId) return
    const floorNow = realActive.filter(other => !other.isAssistant)
    const team = officeTeams(floorNow).find(one => one.members.length > 1) ?? officeTeams(floorNow)[0]
    // Left alone by default: anyone working or asking for the person.
    const isFree = other => !other.isRunning && !other.request
    const chosen = realActive.find(other => other.name === presentAs) ?? team?.members.find(other => other.id !== team.lead.id && isFree(other)) ?? officeTeams(floorNow).flatMap(one => one.members).find(isFree) ?? team?.lead
    if (chosen) setPresenterId(chosen.id)
  }, [presentAs, presenterId, realActive])
  const active = useMemo(() => realActive.map(other => (other.id === presenterId ? { ...other, isRunning: false, isActing: false, isFinished: true, plan: null, label: isPresenting ? 'Presenting' : 'Ready for you', readyLine: isPresenting ? 'Showing you their work' : 'Ready for you' } : other)), [realActive, presenterId, isPresenting])
  const presenter = active.find(other => other.id === presenterId)
  const isShowing = isPresenting && Boolean(presenter)
  const away = useMemo(() => cast.filter(person => !isActive(person)), [cast])
  const needsYou = [...active.filter(person => person.request), ...active.filter(person => person.isFinished && !person.request)].filter(person => person.id !== presenterId || person.request)
  const working = active.filter(person => person.isRunning)
  const person = cast.find(other => other.id === selected)

  const floor = useMemo(() => active.filter(other => !other.isAssistant), [active])
  const teams = useMemo(() => officeTeams(floor), [floor])
  const personTeam = person && teams.find(team => team.members.some(member => member.id === person.id))
  const focus = place || (person?.isAssistant ? 'office' : person && active.some(other => other.id === person.id) ? personTeam?.lead.id || 'lounge' : null)

  function goToPlace(key) {
    setIsPresenting(false)
    setSelected(null)
    setPlace(key)
    setIsDetailOpen(false)
  }
  // On the map, clicking what's already open folds its section away.
  function goToSpace(key, isMap) {
    const team = teams.find(one => one.lead.id === key)
    const isOpen = team ? selected === team.lead.id : key === 'office' && (selected ? person?.isAssistant : place === 'office')
    if (isMap && isOpen) goToPlace(null)
    else if (team) pick(team.lead.id)
    else goToPlace(key)
  }
  const pickInRoom = (id, isMap) => (isMap && id === selected ? goToPlace(null) : pick(id))
  function pick(id) {
    // The demo opens the work, and doesn't switch the Claude app's session.
    if (id === presenterId) {
      setSelected(id)
      setPlace(null)
      setIsDetailOpen(false)
      setIsPresenting(true)
      return
    }
    setIsPresenting(false)
    const target = everyone.find(other => other.id === id)
    setSelected(id)
    setPlace(null)
    setTab('outputs')
    setIsDetailOpen(false)
    // The left side of the Claude app follows whoever is clicked here.
    // A tablet's tap shouldn't switch the session on the Mac.
    if (!isTouchDevice) api('/api/open', { id }).catch(failure => setProblem(failure.message))
    setIsAwayOpen(false)
    setIsPaletteOpen(false)
    if (target?.isFinished) api('/api/seen', { id }).catch(() => {})
  }

  keyActions.current = {
    // Closes the nearest thing first, so Escape only leaves a team once nothing is open over it.
    escape: () => {
      if (isDetailOpen) setIsDetailOpen(false)
      else goToPlace(null)
    },
    team: index => { if (teams[index]) pick(teams[index].lead.id) },
  }

  return (
    <div className={`app ${isShowing ? 'presenting' : ''}`}>

      {((presenter && !isPresenting) || needsYou.length > 0 || (newsDay?.topics.length > 0 && !newsDay.pick && !newsDay.edition) || (newsDay?.edition && !newsReadOn)) && (
      <div className="needs" aria-label="Needs you">
        <b>Needs you</b>
        {presenter && !isPresenting && <button className="need" onClick={() => pick(presenter.id)}><Avatar person={presenter} everyone={everyone} size={20} /><span className="dot finished" /><b>{presenter.name}</b> ready for you <small>Demo: a finished report</small></button>}
        {newsDay?.topics.length > 0 && !newsDay.pick && !newsDay.edition && <button className="need" onClick={() => setIsNewsOpen(true)}><Newspaper size={14} /><b>Nell</b> has today's topics</button>}
        {newsDay?.edition && !newsReadOn && <button className="need" onClick={() => { setIsNewsOpen(true); markNewsRead(newsDay.date) }}><Newspaper size={14} /><b>Nell</b> finished today's piece</button>}
        {needsYou.map(target => (
          <button key={target.id} className="need" onClick={() => pick(target.id)}>
            <Avatar person={target} everyone={everyone} size={20} /><span className={`dot ${target.request ? 'asks' : 'finished'}`} /><b>{target.name}</b>
            {target.request ? <small className="asks-text">{target.request.message}</small> : <>finished <small>{target.title}</small></>}
          </button>
        ))}
      </div>
      )}

      {problem && <p className="error banner">{problem}</p>}
      <div className="work floor">
        {active.length > 0
          ? <Room people={active} selected={selected} focus={focus} speaker={voices.speaker} usage={usage} boardFont={boardFont} lightsOut={shutDown || roomPace === 'asleep'} pace={roomPace} viewShift={isShowing ? PRESENTATION_SHIFT : 0} mapHost={mapHost} onPick={isShowing ? ignoreRoomClick : pickInRoom} onSpace={isShowing ? ignoreRoomClick : goToSpace} onHome={() => goToPlace(null)} />
          : !problem && <Empty text="Waiting for session data…" />}
        {personTeam && !personTeam.isIndependent && <div className="room-title"><TeamName person={personTeam.lead} /></div>}
        {isShowing && <Presentation person={presenter} everyone={everyone} onClose={() => { setIsPresenting(false); setSelected(null) }} />}
        <div className="corner">
          {isNewsOpen && newsDay && <Drawer onClose={() => setIsNewsOpen(false)}><Newsroom day={newsDay} onClose={() => setIsNewsOpen(false)} /></Drawer>}
          <TeamMenu onNews={() => setIsNewsOpen(true)} focus={focus} mapHost={mapHost} onPlace={goToPlace}>
            {!person && !shutDown && place === 'office' && (
              <ListSection icon={Building2} title="Your office" label="Your office" onClose={() => goToPlace(null)}>
                <div className="section-actions"><button className="section-action" onClick={() => setIsDetailOpen(true)}><Gauge size={13} /> Usage</button></div>
                {isDetailOpen && (
                  <Drawer onClose={() => setIsDetailOpen(false)}>
                    <Usage usage={usage} people={cast} boardFont={boardFont} onBoardFont={chooseBoardFont} onPick={pick} onClose={() => setIsDetailOpen(false)} />
                  </Drawer>
                )}
              </ListSection>
            )}
            {person && (
              <Session
                person={person} everyone={cast} teams={teams} tab={tab} isOpen={isDetailOpen}
                onOpen={id => { setTab(id); setIsDetailOpen(true) }} onCloseDetails={() => setIsDetailOpen(false)}
                onPick={pick} onHear={voices.hear} onClose={() => goToPlace(null)}
              />
            )}
            <span className="voices">
            <button className={`voice-mode shut-down ${shutDown ? 'on' : ''}`} title={shutDown ? "Turn the lights back on, and hear what's waiting" : 'Put the office to sleep: lights, TVs and name tags go off, and nobody alerts you. Agents keep working'} aria-pressed={shutDown} onClick={toggleShutDown}><Power size={14} /> {shutDown ? 'Wake up' : 'Sleep'}</button>
            <button className={`voice-mode away-mode ${awayMode ? 'on' : ''}`} title={awayMode ? "You're away. Click when you're back to hear what's waiting" : 'Nobody alerts you until you come back. Mia keeps everything waiting'} aria-pressed={awayMode} onClick={toggleAway}>{awayMode ? <><Moon size={14} /> I'm back</> : <><Moon size={14} /> Set away</>}</button>
          {voices.speaker && <small>{everyone.find(other => other.id === voices.speaker)?.name} is speaking</small>}
          {voices.speaker && <button className="icon" title="Skip" aria-label="Skip" onClick={voices.skip}><SkipForward size={14} /></button>}
          {voices.problem && <small className="error">{voices.problem}</small>}
          {voices.isOn && <button className={`icon ${voices.speaksWhileWorking ? 'on' : ''}`} title={voices.speaksWhileWorking ? 'Speaking while working. Turn off for end-of-turn only' : 'Speak while working'} aria-label="Speak while working" aria-pressed={voices.speaksWhileWorking} onClick={voices.toggleWhileWorking}><MessageCircle size={14} /></button>}
          <button className={`voice-mode ${voices.isOn ? 'on' : ''}`} title={voices.isOn ? 'Turn voice mode off: nobody speaks and no ElevenLabs credits are used' : 'Turn voice mode on'} aria-pressed={voices.isOn} onClick={voices.toggle}>{voices.isOn ? <Volume2 size={14} /> : <VolumeX size={14} />} Voice {voices.isOn ? 'on' : 'off'}</button>
        </span>
            <button className="search" onClick={() => setIsPaletteOpen(true)}>
          <Search size={14} /><span>Search agents and rooms</span><kbd>⌘</kbd><kbd>K</kbd>
        </button>
          </TeamMenu>
        </div>
      </div>

      <footer className="statusbar">
        <small>{active.length} active · {updatedAt ? `updated ${age(updatedAt)} ago` : 'no data yet'}</small>
        <button className="away-button" onClick={() => setIsAwayOpen(true)}>{away.length} away</button>
      </footer>

      {isAwayOpen && <Away people={away} onPick={pick} onClose={() => setIsAwayOpen(false)} />}
      {isPaletteOpen && (
        <Palette
          everyone={cast}
          rooms={[...new Set(everyone.map(other => other.project))]}
          onClose={() => setIsPaletteOpen(false)}
          onRoom={() => { setSelected(null); setIsPaletteOpen(false) }}
          onPerson={target => pick(target.id)}
        />
      )}
    </div>
  )
}
