import React, { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, ExternalLink, Moon, Newspaper, Plane, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { age, api, withId } from './api.js'
import './phone.css'

const PHONE_WIDTH = '(max-width: 640px)'
const STATUS = { asks: 'Asking for you', working: 'Working', finished: 'Finished', idle: 'Idle' }
const FACE_COLORS = ['#6366f1', '#0f766e', '#b45309', '#be185d', '#1d4ed8', '#7c3aed', '#15803d', '#b91c1c']
const statusOf = person => (person.request ? 'asks' : person.isRunning ? 'working' : person.isFinished ? 'finished' : 'idle')
// Each video fetches its preview, which adds up quickly on mobile data.
const PHONE_OUTPUTS = 4
const isMedia = path => /\.(mp4|m4v|mov|webm|png|jpe?g|gif|webp)$/i.test(path)

export function usePhoneWidth() {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_WIDTH).matches)
  useEffect(() => {
    const query = window.matchMedia(PHONE_WIDTH)
    const onChange = event => setIsPhone(event.matches)
    query.addEventListener('change', onChange)

    return () => query.removeEventListener('change', onChange)
  }, [])

  return isPhone
}

// Initials rather than the desktop's portraits, which load a 3D model for each person.
function Face({ person }) {
  const hash = [...person.name].reduce((total, letter) => total * 31 + letter.charCodeAt(0) >>> 0, 7)

  return <span className="phone-face" style={{ background: FACE_COLORS[hash % FACE_COLORS.length] }} aria-hidden="true">{person.name[0]}</span>
}

function PersonRow({ person, onPick }) {
  const status = statusOf(person)

  return (
    <button className="phone-row" onClick={() => onPick(person.id)}>
      <Face person={person} />
      <span className="phone-row-text">
        <b>{person.name}</b>
        <small>{person.request?.message || person.title || person.label}</small>
      </span>
      <span className={`phone-status ${status}`}>{status === 'idle' ? `Idle ${age(person.lastActivityAt)}` : STATUS[status]}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  )
}

function Control({ icon: Icon, label, isOn, title, onClick }) {
  return (
    <button className={`phone-control ${isOn ? 'on' : ''}`} aria-pressed={isOn} title={title} onClick={onClick}>
      <Icon size={18} aria-hidden="true" /><span>{label}</span>
    </button>
  )
}

function newsLine(day) {
  if (day.edition) return "Read today's piece"
  if (day.pick) return 'Nell is writing your pick'
  if (day.topics.length) return "Pick today's topics"

  return 'Nothing yet today'
}

function Home({ everyone, teams, loungers, away, needsYou, newsDay, needsNews, shutDown, awayMode, voices, problem, onSleep, onAway, onPick, onNews }) {
  const [showAway, setShowAway] = useState(false)
  const assistant = everyone.find(person => person.isAssistant)
  const speaker = voices.speaker && everyone.find(person => person.id === voices.speaker)

  return (
    <main className="phone-screen">
      <header className="phone-head"><h1>Agent Office</h1></header>
      <div className="phone-controls">
        <Control icon={Moon} label={shutDown ? 'Wake' : 'Sleep'} isOn={shutDown} title="Nobody alerts you, and agents keep working" onClick={onSleep} />
        <Control icon={Plane} label={awayMode ? "I'm back" : 'Set away'} isOn={awayMode} title="Nobody alerts you until you come back" onClick={onAway} />
        <Control icon={voices.isOn ? Volume2 : VolumeX} label={voices.isOn ? 'Voice on' : 'Voice off'} isOn={voices.isOn} title="Voice uses ElevenLabs credits" onClick={voices.toggle} />
      </div>
      {speaker && <div className="phone-speaking"><span>{speaker.name} is speaking</span><button aria-label="Skip" onClick={voices.skip}><SkipForward size={18} /></button></div>}
      {/* The phone has no hear button, and turning voice on wrongly reports this message. */}
      {voices.problem && voices.problem !== 'Voice mode is off' && <p className="error phone-note">{voices.problem}</p>}
      {problem && <p className="error phone-note">{problem}</p>}

      {(needsYou.length > 0 || needsNews) && (
        <section aria-label="Needs you">
          <h2>Needs you</h2>
          <div className="phone-list">
            {needsNews && <button className="phone-row" onClick={onNews}><span className="phone-face news"><Newspaper size={17} /></span><span className="phone-row-text"><b>Nell</b><small>{newsLine(newsDay)}</small></span><ChevronRight size={16} /></button>}
            {needsYou.map(person => <PersonRow key={person.id} person={person} onPick={onPick} />)}
          </div>
        </section>
      )}

      {newsDay && !needsNews && (
        <section aria-label="Today's reading">
          <h2>Today's reading</h2>
          <div className="phone-list"><button className="phone-row" onClick={onNews}><span className="phone-face news"><Newspaper size={17} /></span><span className="phone-row-text"><b>Newsroom</b><small>{newsLine(newsDay)}</small></span><ChevronRight size={16} /></button></div>
        </section>
      )}

      {teams.map(team => (
        <section key={team.key || team.lead.id} aria-label={team.name}>
          <h2>{team.name}<small>{team.isIndependent ? 'Independent' : `Led by ${team.lead.name}`}</small></h2>
          <div className="phone-list">{team.members.map(person => <PersonRow key={person.id} person={person} onPick={onPick} />)}</div>
        </section>
      ))}

      {(assistant || loungers.length > 0) && (
        <section aria-label="Not on a team">
          <h2>Not on a team</h2>
          <div className="phone-list">
            {assistant && <PersonRow person={assistant} onPick={onPick} />}
            {loungers.map(person => <PersonRow key={person.id} person={person} onPick={onPick} />)}
          </div>
        </section>
      )}

      {away.length > 0 && (
        <section aria-label="Away">
          <button className="phone-more" aria-expanded={showAway} onClick={() => setShowAway(open => !open)}>{showAway ? 'Hide' : 'Show'} {away.length} inactive</button>
          {showAway && <div className="phone-list">{away.map(person => <PersonRow key={person.id} person={person} onPick={onPick} />)}</div>}
        </section>
      )}
    </main>
  )
}

function Person({ person, parts, onBack }) {
  const { Memory, Outputs, RequestBanner, Stage } = parts
  const [stage, setStage] = useState(null)
  const [note, setNote] = useState('')
  const status = statusOf(person)
  async function show(path) {
    setNote('')
    if (isMedia(path)) {
      try {
        setStage({ files: [await api(withId('/api/media-link', person.id, { path }))], caption: path })

        return
      } catch {
        // Falls through to the note below.
      }
    }
    setNote(`Open ${path} on your Mac.`)
  }

  return (
    <main className="phone-screen phone-person">
      <header className="phone-bar">
        <button aria-label="Back" onClick={onBack}><ArrowLeft size={20} /></button>
        <Face person={person} />
        <span className="phone-row-text"><b>{person.name}</b><small>{person.label}</small></span>
      </header>
      <div className="phone-person-state">
        <span className={`phone-status ${status}`}>{status === 'idle' ? `Idle ${age(person.lastActivityAt)}` : STATUS[status]}</span>
        {person.teamName && !person.isIndependent && <small>{person.teamName}</small>}
      </div>
      {person.title && <p className="phone-doing">{person.title}</p>}
      <Memory person={person} />
      {person.request && <RequestBanner person={person} onShow={show} />}
      {note && <p className="phone-note">{note}</p>}
      {person.lastUpdate && <section aria-label="Latest update"><h2>Latest update</h2><p className="phone-update">{person.lastUpdate}</p></section>}
      {person.link?.startsWith('claude://') && <a className="phone-open" href={person.link}><ExternalLink size={16} /> Open in Claude app</a>}
      <section aria-label="Outputs"><h2>Work and outputs</h2><Outputs person={person} limit={PHONE_OUTPUTS} onExpand={(files, caption) => setStage({ files, caption })} /></section>
      {stage && <div className="phone-stage"><Stage files={stage.files} caption={stage.caption} onClose={() => setStage(null)} /></div>}
    </main>
  )
}

// Leads with people and teams, without the 3D room, which is heavy on a phone.
export default function PhoneApp({ person, isNewsOpen, newsDay, parts, onClosePerson, onCloseNews, onNewsSent, ...home }) {
  const isOpen = Boolean(person) || (isNewsOpen && Boolean(newsDay))
  // The phone's back gesture leaves a person or the Newsroom, not the app.
  useEffect(() => {
    if (!isOpen) return
    let isPushed = true
    window.history.pushState({ phoneView: true }, '')
    const onPop = () => {
      isPushed = false
      onClosePerson()
      onCloseNews()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      if (isPushed) window.history.back()
    }
  }, [isOpen])
  const { Newsroom } = parts

  return (
    <div className="phone">
      {person
        ? <Person key={person.id} person={person} parts={parts} onBack={onClosePerson} />
        : isNewsOpen && newsDay
          ? <div className="phone-news"><Newsroom day={newsDay} onClose={onCloseNews} onSent={onNewsSent} /></div>
          : <Home newsDay={newsDay} {...home} />}
    </div>
  )
}
