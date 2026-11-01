import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { Tree } from 'react-arborist'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  Building2, ChevronRight, File as FileIcon, FileDiff, Folder, FolderTree, Images, ExternalLink,
  Armchair, Check, Circle, Presentation, CircleDot, Dices, DoorOpen, LayoutGrid, Maximize2, Pause, Pencil, Play, MessageCircle, Search, Volume2, VolumeX, SkipForward, X,
} from 'lucide-react'
import { CAST, createScene, helperCast, portrait } from './scene.js'
import { age, announce, api, speak, teamsOf, withId } from './api.js'

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

function Room({ people, selected, focus, speaker, usage, boardFont, onPick, onSpace, children }) {
  const stage = useRef(null), canvas = useRef(null), tags = useRef(null), scene = useRef(null)
  const pick = useRef(onPick), space = useRef(onSpace)
  pick.current = onPick
  space.current = onSpace
  useEffect(() => {
    scene.current = createScene(stage.current, canvas.current, tags.current, id => pick.current(id), key => space.current(key))

    return () => scene.current.dispose()
  }, [])
  useEffect(() => {
    scene.current.update(people, selected, focus, speaker, usage)
  }, [people, selected, focus, speaker, usage])

  useEffect(() => {
    let isCurrent = true
    loadBoardFont(boardFont).then(() => { if (isCurrent) scene.current.setBoardFont(boardFont) })

    return () => { isCurrent = false }
  }, [boardFont])

  return (
    <div className="room" ref={stage}>
      <canvas ref={canvas} aria-label="3D office floor showing active agents" />
      <div className="tags" ref={tags} />
      {children}
    </div>
  )
}

const isBusy = person => person.isRunning || person.isFinished || Boolean(person.request) || person.meetingWith?.length > 0

// Teams as the office lays them out: anyone idle and alone is in the lounge.
function officeTeams(active) {
  return teamsOf(active).filter(team => team.members.length > 1 || isBusy(team.lead))
}

function teamStatus(team) {
  const working = team.members.filter(member => member.isRunning).length
  const finished = team.members.filter(member => member.isFinished).length
  if (working) return `${working} working`
  if (finished) return `${finished} finished`

  return `${team.members.length} ${team.members.length === 1 ? 'person' : 'people'}, idle`
}

function TeamBar({ teams, hasLounge, focus, onTeam, onPlace }) {
  const place = (key, label, Icon) => (
    <button key={key} className={`team-button ${focus === key ? 'on' : ''}`} onClick={() => onPlace(key)}>
      <span className="place-icon"><Icon size={17} /></span><b>{label}</b>
    </button>
  )

  return (
    <nav className="team-bar" aria-label="Go to a team">
      <button className={`team-button ${focus ? '' : 'on'}`} onClick={() => onPlace(null)}>
        <span className="place-icon"><LayoutGrid size={17} /></span><b>Overview</b>
      </button>
      <span className="team-divider" />
      {teams.map((team, index) => (
        <button key={team.lead.id} className={`team-button ${focus === team.lead.id ? 'on' : ''}`} title={index < 9 ? `Press ${index + 1}` : undefined} onClick={() => onTeam(team)}>
          <Avatar person={team.lead} size={28} />
          {team.members.some(member => member.request) && <span className="alert" aria-label="Someone is asking for you" />}
          <span><b>{team.name}</b><small>{team.isIndependent ? 'Independent' : `Led by ${team.lead.name}`} · {teamStatus(team)}</small></span>
        </button>
      ))}
      <span className="team-divider" />
      {place('meeting', 'Meeting room', Presentation)}
      {hasLounge && place('lounge', 'Lounge', Armchair)}
      {place('office', 'Your office', DoorOpen)}
    </nav>
  )
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
      {!person.isIndependent && <EditableText key={person.teamId} value={person.teamName} label="team name" className="team-rename" onSave={name => api('/api/team-name', { id: person.id, teamId: person.teamId, name })} />}
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

const VOICE_SETTING = 'office-voices'
const FONT_SETTING = 'office-board-font'
const BOARD_FONTS = ['Inter', 'Geist', 'IBM Plex Sans', 'DM Sans', 'Manrope', 'Space Grotesk']
const LINES_SETTING = 'office-voice-lines'
const BUILD_CHECK_MS = 15000
const USAGE_CHECK_MS = 15000
const COMPACTED_NOTE_S = 3600
const PRESENCE_CHECK_MS = 5000
const DESK_QUIET_MS = 180000
const DESK_CHECK_MS = 30000
const ANNOUNCED_SETTING = 'office-announced'
const ANNOUNCED_KEPT = 200

// One voice at a time: agents you have open, and anyone asking for you. The rest stay quiet.
function useVoices(everyone, listening, isAway) {
  const [isOn, setIsOn] = useState(() => {
    try { return localStorage.getItem(VOICE_SETTING) === 'on' } catch { return false }
  })
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
      if (isOn && speaksWhileWorking && isListening && person.isActing && wasLine !== undefined && wasLine !== person.lineKey) {
        queue.current = [...queue.current.filter(item => item.ids || item.id !== person.id || item.kind !== 'line'), { id: person.id, kind: 'line' }]
        spokenLines.current.set(person.id, person.lineKey)
      }
      const wasHeard = heard.current.get(person.id)
      if (person.isActing && !person.request) continue
      heard.current.set(person.id, person.wordsKey)
      const isNew = wasHeard !== undefined && wasHeard !== person.wordsKey
      if (!isOn || !isNew || !isListening) continue
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
    try { localStorage.setItem(VOICE_SETTING, on ? 'on' : 'off') } catch {}
    if (!on) {
      queue.current = []
      skip()
    }
    // Hearing someone straight away shows it works, and the click lets the browser play sound.
    if (on) hear(listening[0] || [...everyone].sort((one, other) => Date.parse(other.lastActivityAt || 0) - Date.parse(one.lastActivityAt || 0))[0]?.id)
  }
  function hear(id) {
    if (!id) return
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
          ? (usage.modal.count ? usage.modal.running.map(app => <div key={app} className="usage-row"><span className="dot working" /><span>{app}</span></div>) : <small>No apps running.</small>)
          : <small>Not available. Install the Modal command to see running apps. Spend is on the Modal dashboard.</small>}

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

const EMPTY_PAGE_RETRIES = 8

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
  person.isAssistant || person.isRunning || person.isFinished || Boolean(person.request) || person.meetingWith?.length > 0 ||
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

function Session({ person, everyone, teams, tab, onTab, onClose, onPick, onHear }) {
  const [showPath, setShowPath] = useState(null)
  const [stage, setStage] = useState(null)
  useEffect(() => setStage(null), [person.id])
  async function show(path) {
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
    onTab('files')
  }
  const boss = everyone.find(other => other.id === person.startedBy)

  return (
    <section className="session">
      <header className="session-head">
        <div className="session-who">
          <Avatar person={person} everyone={everyone} size={36} />
          <EditableText key={`name-${person.id}`} value={person.name} label="name" className="name" onSave={name => api('/api/rename', { id: person.id, name })} />
          <EditableText key={`label-${person.id}`} value={person.label} label="job label" className="job" onSave={label => api('/api/label', { id: person.id, label })} />
          <button className="icon" title="Hear their latest update" aria-label="Hear their latest update" onClick={() => onHear(person.id)}><Volume2 size={14} /></button>
          <button className="icon" title="Try a different look" aria-label="Try a different look" onClick={() => api('/api/reroll', { id: person.id })}><Dices size={14} /></button>
          <span className={`pill ${statusOf(person)}`}>{statusOf(person) !== 'idle' ? STATUS_LABEL[statusOf(person)] : `Idle ${age(person.lastActivityAt)}`}</span>
          <small className="session-title">{boss ? `For ${boss.name}` : ''}{person.prNumber ? ` · PR ${person.prNumber}` : ''}</small>
        </div>
        {person.link?.startsWith('claude://') && <a className="open-app" href={person.link}>Open in Claude app</a>}
        <button className="icon" aria-label="Back to the floor" title="Back to the floor" onClick={onClose}><X size={16} /></button>
      </header>
      <Teammates person={person} teams={teams} onPick={onPick} />
      <TeamChoice person={person} teams={teams} />
      <nav className="session-tabs" role="tablist">
        {SESSION_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}><Icon size={14} /> {label}</button>
        ))}
      </nav>
      <Memory person={person} />
      {person.request && <RequestBanner person={person} onShow={show} />}
      {stage && <Stage files={stage.files} caption={stage.caption} onClose={() => setStage(null)} />}
      {tab === 'outputs' && <Outputs person={person} onExpand={(files, caption) => setStage({ files, caption })} />}
      {tab === 'changes' && <Changes person={person} />}
      {tab === 'files' && <Files person={person} initialPath={showPath} onMedia={show} />}
    </section>
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
  // Step away and the view settles on your desk, where anyone who needs you waits.
  useEffect(() => {
    const poll = () => api('/api/presence').then(data => setIsAway(Boolean(data.isAway)), () => {})
    poll()
    const timer = setInterval(poll, PRESENCE_CHECK_MS)

    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!isAway) return
    setSelected(null)
    setPlace('office')
  }, [isAway])
  const voices = useVoices(everyone, [...onScreen.split(',').filter(Boolean), selected].filter(Boolean), isAway)
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
  const keyActions = useRef({ overview() {}, team() {} })
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
      if (event.key === 'Escape' && !document.querySelector('.stage')) keyActions.current.overview()
      if (/^[1-9]$/.test(event.key)) keyActions.current.team(Number(event.key) - 1)
    }
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cast = everyone
  const active = useMemo(() => cast.filter(isActive), [cast])
  const away = useMemo(() => cast.filter(person => !isActive(person)), [cast])
  const needsYou = [...active.filter(person => person.request), ...active.filter(person => person.isFinished && !person.request)]
  const working = active.filter(person => person.isRunning)
  const person = cast.find(other => other.id === selected)

  const floor = useMemo(() => active.filter(other => !other.isAssistant), [active])
  const teams = useMemo(() => officeTeams(floor), [floor])
  const loungers = floor.filter(other => !teams.some(team => team.members.some(member => member.id === other.id)))
  const personTeam = person && teams.find(team => team.members.some(member => member.id === person.id))
  const focus = place || (person?.isAssistant ? 'office' : person && active.some(other => other.id === person.id) ? personTeam?.lead.id || 'lounge' : null)

  function goToPlace(key) {
    setSelected(null)
    setPlace(key)
  }
  function goToSpace(key) {
    const team = teams.find(one => one.lead.id === key)
    if (team) pick(team.lead.id)
    else goToPlace(key)
  }
  function pick(id) {
    const target = everyone.find(other => other.id === id)
    setSelected(id)
    setPlace(null)
    setTab('outputs')
    // The left side of the Claude app follows whoever is clicked here.
    api('/api/open', { id }).catch(failure => setProblem(failure.message))
    setIsAwayOpen(false)
    setIsPaletteOpen(false)
    if (target?.isFinished) api('/api/seen', { id }).catch(() => {})
  }

  keyActions.current = {
    overview: () => goToPlace(null),
    team: index => { if (teams[index]) pick(teams[index].lead.id) },
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AGENT OFFICE</span>
        <button className="search" onClick={() => setIsPaletteOpen(true)}>
          <Search size={14} /><span>Search agents and rooms</span><kbd>⌘</kbd><kbd>K</kbd>
        </button>
        <span className="voices">
          {voices.speaker && <small>{everyone.find(other => other.id === voices.speaker)?.name} is speaking</small>}
          {voices.speaker && <button className="icon" title="Skip" aria-label="Skip" onClick={voices.skip}><SkipForward size={14} /></button>}
          {voices.problem && <small className="error">{voices.problem}</small>}
          {voices.isOn && <button className={`icon ${voices.speaksWhileWorking ? 'on' : ''}`} title={voices.speaksWhileWorking ? 'Speaking while working. Turn off for end-of-turn only' : 'Speak while working'} aria-label="Speak while working" aria-pressed={voices.speaksWhileWorking} onClick={voices.toggleWhileWorking}><MessageCircle size={14} /></button>}
          <button className="icon" title={voices.isOn ? 'Turn voices off' : 'Turn voices on'} aria-label={voices.isOn ? 'Turn voices off' : 'Turn voices on'} aria-pressed={voices.isOn} onClick={voices.toggle}>{voices.isOn ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
        </span>
        <span className="counts"><span className="dot working" />{working.filter(other => !other.isWaiting).length} working{working.some(other => other.isWaiting) ? ` · ${working.filter(other => other.isWaiting).length} waiting` : ''}</span>
      </header>

      <div className="needs" aria-label="Needs you">
        <b>Needs you</b>
        {needsYou.length === 0 && <small>Nothing right now</small>}
        {needsYou.map(target => (
          <button key={target.id} className="need" onClick={() => pick(target.id)}>
            <Avatar person={target} everyone={everyone} size={20} /><span className={`dot ${target.request ? 'asks' : 'finished'}`} /><b>{target.name}</b>
            {target.request ? <small className="asks-text">{target.request.message}</small> : <>finished <small>{target.title}</small></>}
          </button>
        ))}
      </div>

      {problem && <p className="error banner">{problem}</p>}
      <PanelGroup direction="horizontal" className="work" autoSaveId={person || place === 'office' ? 'office-chat-open' : 'office-floor'}>
        <Panel id="floor" order={1} minSize={25} defaultSize={person || place === 'office' ? 60 : 100}>
          {active.length > 0
            ? (
              <Room people={active} selected={selected} focus={focus} speaker={voices.speaker} usage={usage} boardFont={boardFont} onPick={pick} onSpace={goToSpace}>
                <TeamBar teams={teams} hasLounge={loungers.length > 0} focus={focus} onTeam={team => pick(team.lead.id)} onPlace={goToPlace} />
              </Room>
            )
            : !problem && <Empty text="Waiting for session data…" />}
        </Panel>
        {!person && place === 'office' && (
          <>
            <PanelResizeHandle className="handle" />
            <Panel id="session" order={2} minSize={28} defaultSize={40}>
              <Usage usage={usage} people={cast} boardFont={boardFont} onBoardFont={chooseBoardFont} onPick={pick} onClose={() => goToPlace(null)} />
            </Panel>
          </>
        )}
        {person && (
          <>
            <PanelResizeHandle className="handle" />
            <Panel id="session" order={2} minSize={28} defaultSize={40}>
              <Session person={person} everyone={cast} teams={teams} tab={tab} onTab={setTab} onPick={pick} onHear={voices.hear} onClose={() => goToPlace(null)} />
            </Panel>
          </>
        )}
      </PanelGroup>

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
