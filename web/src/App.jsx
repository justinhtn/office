import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { DiffEditor, Editor } from '@monaco-editor/react'
import { Tree } from 'react-arborist'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  Building2, ChevronRight, File as FileIcon, FileDiff, Folder, FolderTree, MessageSquare,
  PanelRight, Search, SendHorizontal, Users,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createScene } from './scene.js'
import { age, api, parseTranscript, parseTranscriptHeader, teamsOf, withId } from './api.js'

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
const statusOf = p => (p.isRunning ? 'working' : p.isFinished ? 'finished' : 'idle')
const STATUS_LABEL = { working: 'Working', finished: 'Finished', idle: 'Idle' }
const PANELS = [
  { id: 'team', label: 'Team', icon: Users },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'files', label: 'Files', icon: FolderTree },
]

function Room({ people, room, selected, onPick }) {
  const stage = useRef(null), canvas = useRef(null), tags = useRef(null), scene = useRef(null)
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    scene.current = createScene(stage.current, canvas.current, tags.current, id => pick.current(id))

    return () => scene.current.dispose()
  }, [])
  useEffect(() => {
    scene.current.update(people, room, selected)
  }, [people, room, selected])

  return (
    <div className="room" ref={stage}>
      <canvas ref={canvas} aria-label={`3D office for ${room}`} />
      <div className="tags" ref={tags} />
    </div>
  )
}

function Roster({ people, everyone, selected, onPick }) {
  return (
    <div className="scroll pad">
      {teamsOf(people, everyone).map(team => (
        <section key={team.lead.id} className="team">
          <h3>{team.members.length > 1 ? `${team.lead.name}'s team` : 'Solo'}</h3>
          {team.members.map(person => (
            <button key={person.id} className={`row ${person.id === selected ? 'on' : ''}`} onClick={() => onPick(person.id)}>
              <span className={`dot ${statusOf(person)}`} />
              <span className="row-main">
                <b>{person.name}</b>
                <small>{person.title}</small>
              </span>
              <small className="row-age">{age(person.lastActivityAt)}</small>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function Empty({ text }) {
  return <div className="empty">{text}</div>
}

const EMPTY_PAGE_RETRIES = 8

function Chat({ person, onPick }) {
  const [latest, setLatest] = useState(null)
  const [older, setOlder] = useState([])
  const [cursor, setCursor] = useState(null)
  const [total, setTotal] = useState(null)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [state, setState] = useState('')
  const [isSending, setIsSending] = useState(false)
  const end = useRef(null)
  const scroller = useRef(null)
  const hasPagedBack = useRef(false)
  const fetchPage = useCallback(async before => {
    const data = await api(withId('/api/transcript', person.id, before ? { before } : {}))
    if (data.status !== 'ok') throw new Error(data.error || "Couldn't read this session.")

    return { messages: parseTranscript(data.text || ''), ...parseTranscriptHeader(data.text || '') }
  }, [person.id])
  // Long tool runs can fill a whole page with nothing to show, so keep going back.
  const fetchUntilVisible = useCallback(async before => {
    let page = await fetchPage(before)
    for (let tries = 0; page.messages.length === 0 && page.cursor && tries < EMPTY_PAGE_RETRIES; tries++) {
      page = await fetchPage(page.cursor)
    }

    return page
  }, [fetchPage])
  const load = useCallback(async () => {
    try {
      const page = await fetchUntilVisible()
      setLatest(page.messages)
      setTotal(page.total)
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
  const messages = latest && [...older, ...latest]
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
      <div className="scroll pad messages" ref={scroller}>
        {error && <p className="error">{error}</p>}
        {latest && (cursor ? (
          <button className="load-older" disabled={isLoadingOlder} onClick={loadOlder}>
            {isLoadingOlder ? 'Loading…' : 'Load earlier messages'}
          </button>
        ) : <div className="tool">Start of available history</div>)}
        {total !== null && cursor && <div className="tool">{total} transcript entries in this session</div>}
        {!error && !messages && <Empty text="Loading conversation…" />}
        {messages?.length === 0 && <Empty text="No messages yet." />}
        {messages?.map((message, index) =>
          message.role === 'tool' ? (
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

function Files({ person }) {
  const [paths, setPaths] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [ref, size] = useSize()
  useEffect(() => {
    setPaths(null); setError(''); setOpen(null)
    api(withId('/api/files', person.id)).then(data => setPaths(data.files), failure => setError(failure.message))
  }, [person.id])
  const tree = useMemo(() => toTree(paths || []), [paths])
  async function view(path) {
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

export default function App() {
  const [everyone, setEveryone] = useState([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [problem, setProblem] = useState('')
  const [room, setRoom] = useState(null)
  const [selected, setSelected] = useState(null)
  const [panel, setPanel] = useState('team')
  const [isPanelOpen, setIsPanelOpen] = useState(true)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)

  useEffect(() => {
    const poll = () =>
      api('/api/sessions').then(
        data => { setEveryone(data.people || []); setUpdatedAt(data.updatedAt || ''); setProblem('') },
        failure => setProblem(failure.message),
      )
    poll()
    const timer = setInterval(poll, 5000)

    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsPaletteOpen(open => !open)
      }
      if (event.key === 'Escape') setIsPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rooms = useMemo(() => {
    const latest = name => everyone.filter(p => p.project === name).reduce((most, p) => ((p.lastActivityAt || '') > most ? p.lastActivityAt : most), '')

    return [...new Set(everyone.map(p => p.project))].sort((a, b) =>
      a === 'Older projects' ? 1 : b === 'Older projects' ? -1 : latest(b).localeCompare(latest(a)),
    )
  }, [everyone])
  const activeRoom = rooms.includes(room) ? room : rooms[0]
  const inRoom = useMemo(() => everyone.filter(p => p.project === activeRoom), [everyone, activeRoom])
  const person = everyone.find(p => p.id === selected)
  const working = everyone.filter(p => p.isRunning).length
  const finished = everyone.filter(p => p.isFinished).length

  function pick(id) {
    const target = everyone.find(p => p.id === id)
    setSelected(id)
    if (panel === 'team') setPanel('chat')
    setIsPanelOpen(true)
    if (target?.isFinished) api('/api/seen', { id }).catch(() => {})
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AGENT OFFICE</span>
        <button className="search" onClick={() => setIsPaletteOpen(true)}>
          <Search size={14} /><span>Search agents and rooms</span><kbd>⌘</kbd><kbd>K</kbd>
        </button>
        <span className="counts"><span className="dot working" />{working} working<span className="dot finished" />{finished} finished</span>
      </header>

      <div className="body">
        <nav className="rail left" aria-label="Sections">
          <button className="on" title="Office" aria-label="Office"><Building2 size={18} /></button>
        </nav>
        <PanelGroup direction="horizontal" autoSaveId="office-layout" className="work">
          <Panel minSize={30} defaultSize={62}>
            <div className="center">
              <div className="tabs" role="tablist">
                {rooms.map(name => {
                  const live = everyone.filter(p => p.project === name && p.isRunning).length

                  return (
                    <button key={name} role="tab" aria-selected={name === activeRoom} className={name === activeRoom ? 'on' : ''} onClick={() => { setRoom(name); setSelected(null); setPanel('team') }}>
                      {live > 0 && <span className="dot working" />}{name}
                      <small>{everyone.filter(p => p.project === name).length}</small>
                    </button>
                  )
                })}
              </div>
              {problem && <p className="error banner">{problem}</p>}
              {activeRoom
                ? <Room people={everyone} room={activeRoom} selected={selected} onPick={pick} />
                : !problem && <Empty text="Waiting for session data…" />}
            </div>
          </Panel>
          {isPanelOpen && (
            <>
              <PanelResizeHandle className="handle" />
              <Panel minSize={24} defaultSize={38}>
                <aside className="side">
                  <div className="crumbs">
                    <span>{activeRoom || 'Office'}</span>
                    {person && panel !== 'team' && <><ChevronRight size={12} /><b>{person.name}</b><span className={`pill ${statusOf(person)}`}>{STATUS_LABEL[statusOf(person)]}</span></>}
                  </div>
                  {person && panel !== 'team' && (
                    <div className="who">
                      <p>{person.title}</p>
                      {person.link?.startsWith('claude://') && <a href={person.link}>Open in Claude app</a>}
                    </div>
                  )}
                  {panel === 'team' && <Roster people={inRoom} everyone={everyone} selected={selected} onPick={pick} />}
                  {panel !== 'team' && !person && <Empty text="Pick someone from the room or the Team list." />}
                  {panel === 'chat' && person && <Chat key={person.id} person={person} onPick={pick} />}
                  {panel === 'changes' && person && <Changes person={person} />}
                  {panel === 'files' && person && <Files person={person} />}
                </aside>
              </Panel>
            </>
          )}
        </PanelGroup>
        <nav className="rail right" aria-label="Panels">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button key={id} title={label} aria-label={label} className={isPanelOpen && panel === id ? 'on' : ''} onClick={() => { setPanel(id); setIsPanelOpen(true) }}><Icon size={18} /></button>
          ))}
        </nav>
      </div>

      <footer className="statusbar">
        <small>{everyone.length} agents · {updatedAt ? `updated ${age(updatedAt)} ago` : 'no data yet'}</small>
        <button title="Toggle panel" aria-label="Toggle panel" onClick={() => setIsPanelOpen(open => !open)}><PanelRight size={15} /></button>
      </footer>

      {isPaletteOpen && (
        <Palette
          everyone={everyone}
          rooms={rooms}
          onClose={() => setIsPaletteOpen(false)}
          onRoom={name => { setRoom(name); setSelected(null); setPanel('team'); setIsPaletteOpen(false) }}
          onPerson={target => { setRoom(target.project); pick(target.id); setPanel('chat'); setIsPaletteOpen(false) }}
        />
      )}
    </div>
  )
}
