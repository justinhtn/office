import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { Tree } from 'react-arborist'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  Building2, ChevronRight, File as FileIcon, FileDiff, Folder, FolderTree, MessageSquare,
  Check, Circle, CircleDot, Maximize2, Pause, Pencil, Play, Search, SendHorizontal, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createScene } from './scene.js'
import { age, api, parseTranscript, parseTranscriptHeader, teamsOf, withId } from './api.js'

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
const statusOf = p => (p.request ? 'asks' : p.isRunning ? 'working' : p.isFinished ? 'finished' : 'idle')
const STATUS_LABEL = { asks: 'Asking for you', working: 'Working', finished: 'Finished', idle: 'Idle' }
function Room({ people, selected, onPick }) {
  const stage = useRef(null), canvas = useRef(null), tags = useRef(null), scene = useRef(null)
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    scene.current = createScene(stage.current, canvas.current, tags.current, id => pick.current(id))

    return () => scene.current.dispose()
  }, [])
  useEffect(() => {
    scene.current.update(people, selected)
  }, [people, selected])

  return (
    <div className="room" ref={stage}>
      <canvas ref={canvas} aria-label="3D office floor showing active agents" />
      <div className="tags" ref={tags} />
    </div>
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

// Runs of steps collapse into one line, so the conversation stays readable.
function groupActivity(messages) {
  const grouped = []
  messages.forEach(message => {
    const last = grouped[grouped.length - 1]
    if (message.role === 'activity' && last?.role === 'steps') last.steps.push(message)
    else if (message.role === 'activity') grouped.push({ role: 'steps', steps: [message] })
    else grouped.push(message)
  })

  return grouped
}

function Steps({ steps }) {
  const failed = steps.filter(step => step.isError).length

  return (
    <details className="steps">
      <summary>
        {steps.length === 1 ? steps[0].body : `${steps.length} steps · ${steps[steps.length - 1].body}`}
        {failed > 0 && <span className="failed"> · {failed} failed</span>}
      </summary>
      {steps.map((step, index) => (
        <details key={index} className={`step ${step.isError ? 'failed' : ''}`}>
          <summary>{step.body}</summary>
          {step.detail && <pre>{step.detail}</pre>}
          {step.output && <pre>{step.output}</pre>}
        </details>
      ))}
    </details>
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
      {person.name} is working{current ? ` on: ${current.content}` : ''}
      {turnStartedAt && <small> · {age(turnStartedAt)}</small>}
    </div>
  )
}

function Chat({ person, onPick, onExpand }) {
  const [latest, setLatest] = useState(null)
  const [older, setOlder] = useState([])
  const [cursor, setCursor] = useState(null)
  const [total, setTotal] = useState(null)
  const [plan, setPlan] = useState([])
  const [turnStartedAt, setTurnStartedAt] = useState('')
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [state, setState] = useState('')
  const [isSending, setIsSending] = useState(false)
  const end = useRef(null)
  const scroller = useRef(null)
  const hasPagedBack = useRef(false)
  const useBridge = useRef(false)
  const fetchPage = useCallback(async before => {
    if (!useBridge.current) {
      try {
        const data = await api(withId('/api/messages', person.id, before !== undefined ? { before } : {}))

        return { messages: data.messages, total: data.total, cursor: data.cursor, plan: data.plan, turnStartedAt: data.turnStartedAt }
      } catch {
        // The transcript file format is internal, so fall back to the app's own tool.
        useBridge.current = true
      }
    }
    const data = await api(withId('/api/transcript', person.id, before ? { before } : {}))
    if (data.status !== 'ok') throw new Error(data.error || "Couldn't read this session.")

    return { messages: parseTranscript(data.text || ''), ...parseTranscriptHeader(data.text || '') }
  }, [person.id])
  // Long tool runs can fill a whole page with nothing to show, so keep going back.
  const fetchUntilVisible = useCallback(async before => {
    let page = await fetchPage(before)
    for (let tries = 0; page.messages.length === 0 && page.cursor != null && tries < EMPTY_PAGE_RETRIES; tries++) {
      page = await fetchPage(page.cursor)
    }

    return page
  }, [fetchPage])
  const load = useCallback(async () => {
    try {
      const page = await fetchUntilVisible()
      setLatest(page.messages)
      setTotal(page.total)
      setPlan(page.plan || [])
      setTurnStartedAt(page.turnStartedAt || '')
      if (!hasPagedBack.current) setCursor(page.cursor)
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }, [fetchUntilVisible])
  useEffect(() => {
    setLatest(null)
    setOlder([])
    setCursor(null)
    setTotal(null)
    setPlan([])
    setTurnStartedAt('')
    hasPagedBack.current = false
    setError('')
    setState('')
    load()
    const timer = setInterval(load, 8000)

    return () => clearInterval(timer)
  }, [load])
  async function loadOlder() {
    const box = scroller.current
    const fromBottom = box.scrollHeight - box.scrollTop
    setIsLoadingOlder(true)
    try {
      const page = await fetchUntilVisible(cursor)
      hasPagedBack.current = true
      setOlder(current => [...page.messages, ...current])
      setCursor(page.cursor)
      requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight - fromBottom
      })
    } catch (failure) {
      setError(failure.message)
    } finally {
      setIsLoadingOlder(false)
    }
  }
  const messages = latest && groupActivity([...older, ...latest])
  const newestCount = latest?.length
  useEffect(() => {
    end.current?.scrollIntoView()
  }, [newestCount])

  async function send(event) {
    event.preventDefault()
    const message = draft.trim()
    if (!message) {
      setState('Enter a message first.')

      return
    }
    setIsSending(true)
    setState('Sending…')
    try {
      const data = await api('/api/send', { id: person.id, message })
      if (data.status !== 'ok') throw new Error(data.error || 'Not delivered.')
      setDraft('')
      setState(/queued/i.test(data.text || '') ? `Queued for ${person.name}` : `Delivered to ${person.name}`)
      load()
    } catch (failure) {
      setState(failure.message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="chat">
      <WorkingLine person={person} plan={plan} turnStartedAt={turnStartedAt} />
      {plan.length > 0 && <Plan plan={plan} />}
      <div className="scroll pad messages" ref={scroller}>
        {error && <p className="error">{error}</p>}
        {latest && (cursor != null ? (
          <button className="load-older" disabled={isLoadingOlder} onClick={loadOlder}>
            {isLoadingOlder ? 'Loading…' : 'Load earlier messages'}
          </button>
        ) : <div className="tool">Start of available history</div>)}
        {total !== null && cursor != null && <div className="tool">{total} items in this conversation</div>}
        {!error && !messages && <Empty text="Loading conversation…" />}
        {messages?.length === 0 && <Empty text="No messages yet." />}
        {messages?.map((message, index) =>
          message.role === 'steps' ? (
            <Steps key={index} steps={message.steps} />
          ) : message.role === 'recap' ? (
            <aside key={index} className="recap">
              <b>Where it stands</b>
              <p>{message.body}</p>
              {message.ask && <p className="recap-ask">{message.ask}</p>}
            </aside>
          ) : message.role === 'media' ? (
            <article key={index} className="bubble assistant media">
              <header>{person.name}</header>
              {message.caption && <p>{message.caption}</p>}
              <div className="media-row">
                {message.files.map(file => <div key={file.url} className="media-item"><MediaItem file={file} controls /></div>)}
              </div>
              <button className="expand" onClick={() => onExpand(message.files, message.caption)}>
                <Maximize2 size={12} /> {message.files.filter(file => file.kind === 'video').length > 1 ? 'Compare side by side' : 'Open large'}
              </button>
            </article>
          ) : message.role === 'tool' ? (
            <div key={index} className="tool">{message.isNote ? message.body : `Used ${message.body}`}</div>
          ) : message.role === 'result' ? (
            <div key={index} className="tool">{message.body}</div>
          ) : (
            <article key={index} className={`bubble ${message.role}`}>
              <header>{message.role === 'user' ? 'You' : message.role === 'peer' ? message.from : person.name}</header>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href = '', children }) =>
                    href.startsWith('#local_')
                      ? <button className="link" onClick={() => onPick(href.slice(1))}>{children}</button>
                      : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                }}
              >{message.body}</ReactMarkdown>
            </article>
          ),
        )}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send(event)
          }}
          placeholder={`Message ${person.name}. Press fn twice to dictate.`}
          aria-label={`Message ${person.name}`}
        />
        <div className="composer-row">
          <small>{state || 'Sends as this session · ⌘↵'}</small>
          <button className="primary" disabled={isSending}><SendHorizontal size={14} /> Send</button>
        </div>
      </form>
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
                <span className={`dot ${statusOf(person)}`} /> <b>{person.name}</b> <small>{person.title}</small>
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
  person.isRunning || person.isFinished || Boolean(person.request) ||
  Date.now() - Date.parse(person.lastActivityAt || 0) < ACTIVE_DAYS * 86400000
const SESSION_TABS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'files', label: 'Files', icon: FolderTree },
]

function NameEditor({ person }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  if (draft === null) {
    return <button className="name" title="Rename" onClick={() => setDraft(person.name)}>{person.name}<Pencil size={12} /></button>
  }
  async function save(event) {
    event.preventDefault()
    try {
      if (draft.trim() !== person.name) await api('/api/rename', { id: person.id, name: draft })
      setDraft(null)
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }

  return (
    <form className="name-form" onSubmit={save}>
      <input autoFocus aria-label="Agent name" value={draft} onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Escape') { setError(''); setDraft(null) } }} />
      {error && <small className="error">{error}</small>}
    </form>
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

function Session({ person, everyone, tab, onTab, onClose, onPick }) {
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
          <span className={`dot ${statusOf(person)}`} />
          <NameEditor key={person.id} person={person} />
          <span className={`pill ${statusOf(person)}`}>{statusOf(person) !== 'idle' ? STATUS_LABEL[statusOf(person)] : `Idle ${age(person.lastActivityAt)}`}</span>
          <small className="session-title">{person.title}{boss ? ` · for ${boss.name}` : ''}{person.prNumber ? ` · PR ${person.prNumber}` : ''}</small>
        </div>
        {person.link?.startsWith('claude://') && <a className="open-app" href={person.link}>Open in Claude app</a>}
        <button className="icon" aria-label="Back to the floor" title="Back to the floor" onClick={onClose}><X size={16} /></button>
      </header>
      <nav className="session-tabs" role="tablist">
        {SESSION_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}><Icon size={14} /> {label}</button>
        ))}
      </nav>
      {person.request && <RequestBanner person={person} onShow={show} />}
      {stage && <Stage files={stage.files} caption={stage.caption} onClose={() => setStage(null)} />}
      {tab === 'chat' && <Chat key={person.id} person={person} onPick={onPick} onExpand={(files, caption) => setStage({ files, caption })} />}
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
  const [tab, setTab] = useState('chat')
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isAwayOpen, setIsAwayOpen] = useState(false)

  useEffect(() => {
    const poll = () =>
      api('/api/sessions').then(
        data => { setEveryone(data.people || []); setUpdatedAt(data.updatedAt || ''); setProblem('') },
        failure => setProblem(failure.message),
      )
    poll()
    const timer = setInterval(poll, 3000)

    return () => clearInterval(timer)
  }, [])
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
    }
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = useMemo(() => everyone.filter(isActive), [everyone])
  const away = useMemo(() => everyone.filter(person => !isActive(person)), [everyone])
  const needsYou = [...active.filter(person => person.request), ...active.filter(person => person.isFinished && !person.request)]
  const working = active.filter(person => person.isRunning)
  const person = everyone.find(other => other.id === selected)

  function pick(id) {
    const target = everyone.find(other => other.id === id)
    setSelected(id)
    setTab('chat')
    setIsAwayOpen(false)
    setIsPaletteOpen(false)
    if (target?.isFinished) api('/api/seen', { id }).catch(() => {})
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AGENT OFFICE</span>
        <button className="search" onClick={() => setIsPaletteOpen(true)}>
          <Search size={14} /><span>Search agents and rooms</span><kbd>⌘</kbd><kbd>K</kbd>
        </button>
        <span className="counts"><span className="dot working" />{working.length} working</span>
      </header>

      <div className="needs" aria-label="Needs you">
        <b>Needs you</b>
        {needsYou.length === 0 && <small>Nothing right now</small>}
        {needsYou.map(target => (
          <button key={target.id} className="need" onClick={() => pick(target.id)}>
            <span className={`dot ${target.request ? 'asks' : 'finished'}`} /><b>{target.name}</b>
            {target.request ? <small className="asks-text">{target.request.message}</small> : <>finished <small>{target.title}</small></>}
          </button>
        ))}
      </div>

      {problem && <p className="error banner">{problem}</p>}
      <PanelGroup direction="horizontal" className="work" autoSaveId={person ? 'office-session' : 'office-floor'}>
        <Panel id="floor" order={1} minSize={20} defaultSize={person ? 34 : 100}>
          {active.length > 0
            ? <Room people={active} selected={selected} onPick={pick} />
            : !problem && <Empty text="Waiting for session data…" />}
        </Panel>
        {person && (
          <>
            <PanelResizeHandle className="handle" />
            <Panel id="session" order={2} minSize={35} defaultSize={66}>
              <Session person={person} everyone={everyone} tab={tab} onTab={setTab} onPick={pick} onClose={() => setSelected(null)} />
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
          everyone={everyone}
          rooms={[...new Set(everyone.map(other => other.project))]}
          onClose={() => setIsPaletteOpen(false)}
          onRoom={() => { setSelected(null); setIsPaletteOpen(false) }}
          onPerson={target => pick(target.id)}
        />
      )}
    </div>
  )
}
