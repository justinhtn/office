import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

const cloneSkinned = model => SkeletonUtils.clone(model)

import { teamsOf } from './api.js'

const AVATARS = '/assets/avatars'
export const CAST = ['Female_Adult_01','Female_Adult_03','Female_Adult_04','Female_Adult_07','Female_Adult_08','Female_Adult_12','Female_Adult_13','Female_Adult_17','Female_Party_02','Business_Female_01','Male_Adult_01','Male_Adult_02','Male_Adult_04','Male_Adult_06','Male_Adult_08','Male_Adult_09','Male_Adult_10','Male_Adult_12','Male_Adult_16','Male_Adult_17']
const UNIFORMS = [0xe0342c,0x2a5bd7,0x1fa24a,0xf08a24,0x8a4bd7,0x18a7a0,0xd23ba8,0x8b6b3d]
const nameHash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const uniformOf = project => UNIFORMS[nameHash(project) % UNIFORMS.length]
export const helperCast=(label,index)=>(nameHash(label)+index*5)%CAST.length
const MODEL_SCALE = .0122
const JAW_OPEN = .22
const SPEAKER_ANGLES = [.7, -.7, .35, -.35, 1.05, -1.05, 0]
const SPEAKER_DISTANCE = 4.6
const MIA_DESK_TURN = 1.2
const AWAY_DISTANCE = 6.5
const SPEAKER_HEIGHT = 1.35
const SPEAKER_RISE = .1
const CLIPS = { sit: 'sit_chair_idle_neutral_01', work: 'sit_chair_idle_neutral_01', stand: 'idle_neutral_01', wave: 'wave_01', walk: 'walk_neutral' }
const castOf = p => p.avatar || CAST[0]
const sexOf = id => (/Female/.test(id) ? 'f' : 'm')
const fbx = url => new Promise((resolve, reject) => new FBXLoader().load(url, resolve, undefined, reject))
const textures = new THREE.TextureLoader()
const templates = new Map(), clips = new Map()

// The files carry a stray light and TGA textures the loader skips, so both are replaced.
function template(id) {
  if (!templates.has(id)) {
    templates.set(id, fbx(`${AVATARS}/${id}/${id}.fbx`).then(model => {
      const strays = []
      model.traverse(o => { if (o.isLight || o.isCamera) strays.push(o) })
      strays.forEach(o => o.parent.remove(o))
      model.animations = []
      model.traverse(o => {
        if (!o.isSkinnedMesh) return
        o.frustumCulled = false
        o.castShadow = true
        const list = Array.isArray(o.material) ? o.material : [o.material]
        const made = list.map(old => {
          const see = /_opacity$/.test(old.name)
          const map = textures.load(`${AVATARS}/${id}/${old.name}_color.${see ? 'png' : 'jpg'}`)
          map.anisotropy = 8
          if (see) return new THREE.MeshLambertMaterial({ map, skinning: true, side: THREE.DoubleSide, alphaTest: .4 })
          const normalMap = textures.load(`${AVATARS}/${id}/${old.name}_normal.jpg`)
          const specularMap = textures.load(`${AVATARS}/${id}/${old.name}_specular.jpg`)
          return new THREE.MeshPhongMaterial({ map, normalMap, specularMap, normalScale: new THREE.Vector2(.9, .9), specular: 0x4a4a4a, shininess: 26, skinning: true })
        })
        o.material = made.length === 1 ? made[0] : made
      })
      return model
    }))
  }
  return templates.get(id)
}

// Only the skeleton's own tracks: a helper track in the files tips the whole body over.
function clip(sex, pose) {
  const name = `${sex}_${CLIPS[pose]}`
  if (!clips.has(name)) {
    clips.set(name, fbx(`${AVATARS}/anim/${name}.fbx`).then(object => {
      const source = object.animations[0]
      const tracks = source.tracks.filter(t => /^Bip01(?!_Footsteps)/.test(t.name) && !/\.scale$/.test(t.name))
      // The walk carries the body forward and snaps it back each loop, so walking on the spot here lets walk() do the moving.
      if (pose === 'walk') {
        const root = tracks.find(t => t.name === 'Bip01.position')
        if (root) for (let i = 2; i < root.values.length; i += 3) root.values[i] = root.values[2]
      }
      return new THREE.AnimationClip(pose, source.duration, tracks)
    }))
  }
  return clips.get(name)
}

const PORTRAIT_SIZE = 192
let portraitRenderer = null
const portraits = new Map()
export function portrait(p) {
  const id = castOf(p), key = `${id}|${uniformOf(p.project)}`
  if (!portraits.has(key)) {
    portraits.set(key, template(id).then(async source => {
      if (!portraitRenderer) {
        portraitRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
        portraitRenderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false)
      }
      const stage = new THREE.Scene()
      stage.background = new THREE.Color(uniformOf(p.project)).lerp(new THREE.Color(0xffffff), .7)
      stage.add(new THREE.AmbientLight(0xffffff, .75))
      const light = new THREE.DirectionalLight(0xffffff, .55); light.position.set(1, 2, 3); stage.add(light)
      const model = cloneSkinned(source); model.scale.setScalar(.01); stage.add(model)
      model.updateMatrixWorld(true)
      const head = new THREE.Vector3(); model.getObjectByName('Bip01_Head').getWorldPosition(head)
      const lens = new THREE.PerspectiveCamera(28, 1, .01, 20)
      lens.position.set(head.x + .12, head.y + .08, head.z + .95); lens.lookAt(head.x, head.y + .06, head.z)
      await new Promise(resolve => setTimeout(resolve, 400))
      portraitRenderer.render(stage, lens)
      return portraitRenderer.domElement.toDataURL()
    }))
  }
  return portraits.get(key)
}

// The N64-style room. Everything else in the app is ordinary React.
export function createScene(stage, canvas, tagsEl, onPick, onSpace = () => {}) {
const home={center:new THREE.Vector3(0,1.5,0),dist:30,az:.55,el:.08}
let lighting=new THREE.Group(),lastDaylight=0,boardFont='Inter,sans-serif',speaker=null,usage=null,usageScreen=null,directory=null,speakerView=null,awayView=null,focusKey=null,spots={},floors=[],isManual=false,drawingKey=null
const renderer = new THREE.WebGLRenderer({canvas, antialias:true})
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
const HEMI_DAY = new THREE.Color(0xfffaf0), SUN_DAY = new THREE.Color(0xfff0dc), BULB_ON = new THREE.Color(0xfff0d2), SKY_DAY = new THREE.Color(0xdbe8ef)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xdbe8ef)
const camera = new THREE.PerspectiveCamera(46, 1, .1, 300)
const hemi = new THREE.HemisphereLight(0xfffaf0, 0xc9b8a2, .62); scene.add(hemi)
const sun = new THREE.DirectionalLight(0xfff0dc, .62); sun.castShadow = true; sun.shadow.autoUpdate = false; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0006; sun.shadow.radius = 3; scene.add(sun)
let world = new THREE.Group(); scene.add(world)

const mats = {}
const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({color:c, flatShading:true}))
const glow = c => mats['g'+c] || (mats['g'+c] = new THREE.MeshBasicMaterial({color:c, fog:false}))
function box(parent,w,h,d,c,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),typeof c==='number'?mat(c):c);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m}
function pixelTex(size,draw,rx=1,ry=1){const k=document.createElement('canvas');k.width=k.height=size;draw(k.getContext('2d'),size);const t=new THREE.CanvasTexture(k);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);return t}
const texMat = t => new THREE.MeshLambertMaterial({map:t})
function paintTex(w,h,draw,rx=1,ry=1){const k=document.createElement('canvas');k.width=w;k.height=h;draw(k.getContext('2d'),w,h);const t=new THREE.CanvasTexture(k);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=4;return t}
// Pale oak boards, with the seams and variation that keep a big floor from looking painted.
const FLOOR_T=repeat=>paintTex(1024,1024,(g,w,h)=>{
  let r=73;const rand=()=>(r=(r*9301+49297)%233280)/233280
  const ROW=64
  for(let y=0;y<h;y+=ROW){
    let x=-rand()*420
    while(x<w){
      const long=320+rand()*360,tone=84+rand()*18
      g.fillStyle=`rgb(${tone+8},${tone-18},${tone-38})`;g.fillRect(x,y,long,ROW)
      for(let i=0;i<14;i++){g.strokeStyle=`rgba(30,20,12,${.1+rand()*.14})`;g.lineWidth=1+rand()*1.4;const gy=y+rand()*ROW;g.beginPath();g.moveTo(x,gy);g.bezierCurveTo(x+long*.3,gy+rand()*7-3,x+long*.7,gy+rand()*7-3,x+long,gy);g.stroke()}
      g.fillStyle='rgba(70,48,28,.28)';g.fillRect(x+long-1,y,1.5,ROW)
      x+=long
    }
    g.fillStyle='rgba(70,48,28,.3)';g.fillRect(0,y,w,1.5)
  }
},repeat,repeat)
function skyline(seed,rx=1,isNight=false){return paintTex(2048,768,(g,w,h)=>{
  let r=seed;const rand=()=>(r=(r*9301+49297)%233280)/233280
  const sky=g.createLinearGradient(0,0,0,h);if(isNight){sky.addColorStop(0,'#060b18');sky.addColorStop(.6,'#101a30');sky.addColorStop(1,'#2a2a3c')}else{sky.addColorStop(0,'#5d9fd6');sky.addColorStop(.5,'#a9d0ea');sky.addColorStop(.78,'#e4eef1');sky.addColorStop(1,'#f3efe6')};g.fillStyle=sky;g.fillRect(0,0,w,h)
  if(isNight)for(let i=0;i<220;i++){const x=(i*733+seed)%w,y=(i*419)%(h*.55);g.fillStyle=`rgba(255,255,255,${.15+(i%5)*.12})`;g.fillRect(x,y,1.6,1.6)}
  // High, thin cloud rather than cartoon puffs.
  g.save();g.filter='blur(14px)'
  for(let i=0;i<16;i++){const x=rand()*w,y=30+rand()*h*.42,long=160+rand()*420;const soft=.12+rand()*.28;g.fillStyle=isNight?`rgba(90,105,135,${soft*.3})`:`rgba(255,255,255,${soft})`;g.beginPath();g.ellipse(x,y,long,8+rand()*22,(rand()-.5)*.08,0,7);g.fill()}
  g.restore()
  // Each layer is further away and paler, with windows only where they could be seen.
  const row=(horizon,minH,maxH,minW,maxW,tones,windows,haze)=>{
    let x=-20
    while(x<w){
      const wide=minW+rand()*(maxW-minW),high=minH+rand()*(maxH-minH),top=horizon-high,dayTone=tones[Math.floor(rand()*tones.length)],tone=isNight?'#0c1220':dayTone
      g.fillStyle=tone;g.fillRect(x,top,wide,h-top)
      if(!isNight){g.fillStyle='rgba(255,255,255,.08)';g.fillRect(x,top,wide*.28,h-top);g.fillStyle='rgba(10,25,45,.12)';g.fillRect(x+wide*.72,top,wide*.28,h-top)}
      if(rand()<.4){g.fillStyle=tone;g.fillRect(x+wide*.3,top-10-rand()*22,wide*.4,32);if(rand()<.4)g.fillRect(x+wide*.5,top-55,2,50)}
      if(windows){
        const across=windows.w+windows.gap,up=windows.h+windows.gap,lit=.2+rand()*.25
        for(let wy=top+8;wy<h-4;wy+=up)for(let wx=x+6;wx<x+wide-6;wx+=across){const on=rand();g.fillStyle=isNight?(on<.42?`rgba(255,214,140,${.6+on})`:on<.5?'rgba(190,220,255,.7)':'rgba(40,50,70,.5)'):on<.1?`rgba(255,226,170,${lit+.25})`:`rgba(220,236,246,${lit})`;g.fillRect(wx,wy,windows.w,windows.h)}
      }
      x+=wide+rand()*6
    }
    if(haze&&!isNight){const fade=g.createLinearGradient(0,horizon-maxH,0,h);fade.addColorStop(0,'rgba(226,238,243,0)');fade.addColorStop(1,`rgba(236,240,238,${haze})`);g.fillStyle=fade;g.fillRect(0,horizon-maxH,w,h)}
  }
  row(h*.92,110,300,50,120,['#a9bfd0','#b4c7d6','#9fb7ca'],null,.55)
  row(h*.98,90,300,70,170,['#7f9bb3','#8ba5ba','#a3b2bd','#6f8ea9'],{w:4,h:6,gap:6},.4)
  row(h*1.02,70,260,110,240,['#526f8b','#60798f','#7c8c98','#465f78','#8d8f8c'],{w:7,h:10,gap:8},.2)
},rx,1)}
const duskSky=rx=>paintTex(64,512,(g,w,h)=>{g.clearRect(0,0,w,h);const c=g.createLinearGradient(0,0,0,h);c.addColorStop(0,'rgba(70,60,120,.15)');c.addColorStop(.5,'rgba(235,120,90,.55)');c.addColorStop(.8,'rgba(255,175,95,.75)');c.addColorStop(1,'rgba(255,205,140,.6)');g.fillStyle=c;g.fillRect(0,0,w,h)},rx,1)
const WHITE=0xf6f4ef,ORANGE=0xe0682f,WOOD=0x5c402c,CHARCOAL=0x2f3540,LEAF=0x2f8f54
const SCREEN_W=256,SCREEN_H=144,faces=new Map()
function faceImage(person){
  const key=`${castOf(person)}|${person.project}`
  if(!faces.has(key)){const entry={image:null};faces.set(key,entry);portrait(person).then(url=>{const image=new Image();image.onload=()=>{entry.image=image;actors.forEach(a=>{if(a.screen)a.screen.drawn=''})};image.src=url},()=>{})}
  return faces.get(key).image
}
// The monitor on the person's own desk shows what's running and what it costs.
function attachUsageScreen(mesh){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=324
  const texture=new THREE.CanvasTexture(canvas);texture.anisotropy=8
  mesh.material=new THREE.MeshBasicMaterial({map:texture})
  usageScreen={canvas,texture};drawUsage()
}
// A wall display in your office listing every team and independent developer. Rows can be clicked.
function directoryBoard(x0,cz){
  const width=4.8,height=2.4,y=3.45,x=x0+.14
  const body=new THREE.Mesh(roundedPanel(width+.09,height+.09,.055,.045),new THREE.MeshPhongMaterial({color:0x08090b,specular:0x6a7078,shininess:90}));body.rotation.y=Math.PI/2;body.position.set(x,y,cz);body.castShadow=true;world.add(body)
  ;[-1,1].forEach(side=>box(world,.08,y,.1,0x3a3e46,x-.06,y/2,cz+side*1.7))
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=960
  const texture=crispTexture(canvas)
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture}));panel.rotation.y=Math.PI/2;panel.position.set(x+.031,y,cz);world.add(panel)
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:glassReflection(),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));glass.rotation.y=Math.PI/2;glass.position.set(x+.036,y,cz);world.add(glass)
  const g=canvas.getContext('2d');g.scale(2,2)
  directory={g,texture,panel,hits:[],hover:null};drawDirectory()
}
function directoryRow(ray){
  if(!directory)return null
  const hit=ray.intersectObject(directory.panel)[0]
  if(!hit||!hit.uv)return null
  const x=hit.uv.x*960,y=(1-hit.uv.y)*480,row=directory.hits.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)

  return row?{...row,distance:hit.distance}:null
}
function drawDirectory(){
  if(!directory)return
  const {g,texture}=directory,W=960,H=480,rows=usage?.directory||[]
  const fit=(text,max)=>{let t=String(text||'');while(g.measureText(t).width>max&&t.length>1)t=t.slice(0,-2)+'…';return t}
  const back=g.createLinearGradient(0,0,0,H);back.addColorStop(0,'#10141b');back.addColorStop(1,'#0a0d12');g.fillStyle=back;g.fillRect(0,0,W,H)
  g.textBaseline='middle';g.textAlign='left'
  g.fillStyle=UI.text;g.font='600 24px '+boardFont;g.fillText('Everyone',28,34)
  const teams=rows.filter(r=>r.kind==='team'),solo=rows.filter(r=>r.kind!=='team')
  g.fillStyle=UI.muted;g.font='14px '+boardFont;g.fillText(`${teams.length} teams · ${solo.length} independent`,W-28-g.measureText(`${teams.length} teams · ${solo.length} independent`).width,35)
  const statusOf=row=>{
    const here=row.memberIds.map(id=>people.find(p=>p.id===id)).filter(Boolean)
    if(here.some(p=>p.request))return{label:'Asking',fg:UI.asks,bg:UI.asksWash}
    if(here.some(p=>p.isActing))return{label:'Working',fg:UI.working,bg:UI.workingWash}
    if(here.some(p=>p.isRunning))return{label:'Waiting',fg:UI.waiting,bg:UI.waitingWash}
    if(!row.stillInOffice)return{label:'Archived',fg:UI.faint,bg:null}
    return{label:shortAge(row.lastActive),fg:UI.muted,bg:null}
  }
  const hits=[]
  const card=(title,list,x,w,MAX)=>{
    g.fillStyle=UI.soft;roundRect(g,x,60,w,H-76,12);g.fill()
    g.fillStyle=UI.muted;g.font='600 13px '+boardFont;g.textAlign='left';g.fillText(title.toUpperCase(),x+16,82)
    const ROW=34
    list.slice(0,MAX).forEach((row,i)=>{
      const top=98+i*ROW,y=top+ROW/2,status=statusOf(row),canOpen=row.stillInOffice
      if(canOpen)hits.push({x,y:top,w,h:ROW,id:row.id})
      if(directory.hover===row.id){g.fillStyle=UI.hover;roundRect(g,x+6,top+1,w-12,ROW-2,8);g.fill()}
      g.textAlign='left';g.fillStyle=canOpen?UI.text:UI.faint;g.font='500 17px '+boardFont
      g.fillText(fit(row.name||row.lead,w*.46),x+16,y)
      g.fillStyle=UI.muted;g.font='14px '+boardFont;g.fillText(fit(row.kind==='team'?`Led by ${row.lead}`:row.project,w*.24),x+w*.5,y)
      g.font='500 13px '+boardFont;g.textAlign='right'
      if(status.bg){const pill=g.measureText(status.label).width+20;g.fillStyle=status.bg;roundRect(g,x+w-14-pill,y-11,pill,22,11);g.fill();g.fillStyle=status.fg;g.fillText(status.label,x+w-24,y+.5)}
      else{g.fillStyle=status.fg;g.fillText(status.label,x+w-16,y+.5)}
    })
    if(list.length>MAX){g.textAlign='left';g.fillStyle=UI.faint;g.font='13px '+boardFont;g.fillText(`${list.length-MAX} more on the Away list`,x+16,H-30)}
  }
  card('Teams',teams,20,440,9)
  card('Independent developers',solo,480,460,9)
  directory.hits=hits
  texture.needsUpdate=true
}
function crispTexture(canvas){
  const texture=new THREE.CanvasTexture(canvas);texture.anisotropy=renderer.capabilities.getMaxAnisotropy();texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter
  return texture
}
function drawUsage(){
  if(!usageScreen)return
  const {canvas,texture}=usageScreen,g=canvas.getContext('2d'),W=canvas.width,H=canvas.height
  g.fillStyle='#17181c';g.fillRect(0,0,W,H)
  g.fillStyle='#f4f4f5';g.font='600 26px '+boardFont;g.textAlign='left';g.fillText('Usage',28,44)
  const meter=(label,detail,part,y)=>{
    g.fillStyle='#d4d4d8';g.font='20px '+boardFont;g.textAlign='left';g.fillText(label,28,y)
    g.fillStyle='#a1a1aa';g.textAlign='right';g.fillText(detail,W-28,y)
    g.fillStyle='#2e2f36';g.fillRect(28,y+10,W-56,9)
    if(part!==null){g.fillStyle=part>=.8?'#ef4444':'#818cf8';g.fillRect(28,y+10,(W-56)*Math.min(1,part),9)}
  }
  const week=usage?.claude?.windows?.[0],speech=usage?.speech
  meter('Claude this week',week?`${week.percentUsed}%`:'Not available',week?week.percentUsed/100:null,92)
  meter('Voices today',speech?.isOn?`${speech.today.toLocaleString()} of ${speech.cap.toLocaleString()}`:'Off',speech?.isOn?speech.today/speech.cap:null,156)
  const working=people.filter(p=>p.isActing).length,jobs=people.reduce((n,p)=>n+(p.jobs?.length||0),0),modal=usage?.modal
  g.fillStyle='#d4d4d8';g.font='20px '+boardFont;g.textAlign='left'
  g.fillText(`${working} working · ${jobs} job${jobs===1?'':'s'} running`,28,226)
  g.fillStyle='#a1a1aa';g.fillText(modal?`Modal: ${modal.count} app${modal.count===1?'':'s'} running`:'Modal: not connected',28,262)
  texture.needsUpdate=true
}
function attachScreen(a,mesh){
  const canvas=document.createElement('canvas');canvas.width=SCREEN_W;canvas.height=SCREEN_H
  const texture=new THREE.CanvasTexture(canvas)
  mesh.material=new THREE.MeshBasicMaterial({map:texture})
  a.screen={canvas,texture,drawn:'',tick:0}
}
function drawFace(g,person,x,y,w,h){
  const image=faceImage(person)
  g.fillStyle='#26303d';g.fillRect(x,y,w,h)
  if(image){const side=Math.min(w,h);g.drawImage(image,x+(w-side)/2,y+(h-side)/2,side,side)}
}
function drawScreen(a,t){
  const {canvas,texture}=a.screen,g=canvas.getContext('2d'),p=a.p,other=p.talkingTo&&people.find(x=>x.id===p.talkingTo)
  const helpers=p.helpers||[],waiting=!p.request&&!other&&!helpers.length&&p.isWaiting,live=!p.request&&!other&&!helpers.length&&!waiting&&p.isRunning
  const key=p.request?'request':other?`call:${other.id}`:helpers.length?`helpers:${helpers.join()}`:waiting?`job:${Math.floor(t*6)}`:live?`code:${Math.floor(t*2)}`:'idle'
  if(a.screen.drawn===key)return
  a.screen.drawn=key
  if(p.request){g.fillStyle='#b4281f';g.fillRect(0,0,SCREEN_W,SCREEN_H);g.fillStyle='#fff';g.font='600 22px '+boardFont;g.textAlign='center';g.fillText('Calling you…',SCREEN_W/2,SCREEN_H/2+8)}
  else if(other){drawFace(g,other,0,0,SCREEN_W,SCREEN_H);g.fillStyle='rgba(0,0,0,.6)';g.fillRect(0,SCREEN_H-26,SCREEN_W,26);g.fillStyle='#fff';g.font='15px '+boardFont;g.textAlign='left';g.fillText(other.name,8,SCREEN_H-8)}
  else if(helpers.length){
    const shown=helpers.slice(0,4),cols=shown.length>2?2:shown.length,rows=shown.length>2?2:1,w=SCREEN_W/cols,h=SCREEN_H/rows
    shown.forEach((label,i)=>drawFace(g,{avatar:CAST[helperCast(label,i)],project:p.project,name:label},(i%cols)*w,Math.floor(i/cols)*h,w-1,h-1))
    if(helpers.length>4){g.fillStyle='rgba(0,0,0,.65)';g.fillRect(SCREEN_W-44,SCREEN_H-24,44,24);g.fillStyle='#fff';g.font='14px '+boardFont;g.textAlign='left';g.fillText(`+${helpers.length-4}`,SCREEN_W-38,SCREEN_H-7)}
  }
  else if(waiting){
    g.fillStyle='#14202c';g.fillRect(0,0,SCREEN_W,SCREEN_H)
    g.strokeStyle='#2c4258';g.lineWidth=8;g.beginPath();g.arc(SCREEN_W/2,56,24,0,7);g.stroke()
    g.strokeStyle='#59c7ff';g.beginPath();const turn=Math.floor(t*6)/6*Math.PI*2;g.arc(SCREEN_W/2,56,24,turn,turn+1.7);g.stroke()
    g.fillStyle='#d6dde5';g.font='13px '+boardFont;g.textAlign='center';g.fillText((p.jobs?.[0]||'Job running').slice(0,34),SCREEN_W/2,112)
  }
  else if(live){
    g.fillStyle='#14202c';g.fillRect(0,0,SCREEN_W,SCREEN_H)
    const shift=Math.floor(t*2),colors=['#6fd3ff','#9ee493','#f7c76b','#d6dde5']
    for(let i=0;i<9;i++){const r=(nameHash(p.id)+(i+shift)*37)%97;g.fillStyle=colors[r%4];g.fillRect(12+(r%4)*14,8+i*15,40+r%150,7)}
  }
  else{g.fillStyle='#2b3440';g.fillRect(0,0,SCREEN_W,SCREEN_H)}
  texture.needsUpdate=true
}
const fromPoint=new THREE.Vector3(),toPoint=new THREE.Vector3(),aimDirection=new THREE.Vector3(),WORLD_UP=new THREE.Vector3(0,1,0),tempAxis=new THREE.Vector3(),tempTurn=new THREE.Quaternion(),tempWorld=new THREE.Quaternion()
// Added on top of the animation each frame, using world directions so the bone's own axes don't matter.
function aimBone(bone,child,direction){
  bone.getWorldPosition(fromPoint);child.getWorldPosition(toPoint)
  const current=toPoint.sub(fromPoint).normalize()
  tempTurn.setFromUnitVectors(current,direction)
  bone.getWorldQuaternion(tempWorld)
  const toLocal=tempWorld.clone().invert()
  bone.quaternion.multiply(toLocal.multiply(tempTurn).multiply(tempWorld))
  bone.updateMatrixWorld(true)
}
// Rocketbox has no typing animation, so the arms are posed on the keyboard over the sitting one.
function typeOnKeyboard(a,t){
  const life=a.life
  if(!a.keyboard)return
  life.model.updateMatrixWorld(true)
  const right=new THREE.Vector3(1,0,0).applyQuaternion(a.g.quaternion),forward=new THREE.Vector3(0,0,1).applyQuaternion(a.g.quaternion)
  life.arms.forEach((arm,i)=>{
    if(!arm.upper||!arm.fore||!arm.hand)return
    const tap=Math.max(0,Math.sin(t*(11+i*2.3)+i*1.7+nameHash(a.p.id)%7))
    const shoulder=arm.upper.getWorldPosition(new THREE.Vector3()),elbow=arm.fore.getWorldPosition(new THREE.Vector3()),wrist=arm.hand.getWorldPosition(new THREE.Vector3())
    const upperLength=shoulder.distanceTo(elbow),foreLength=elbow.distanceTo(wrist)
    const target=a.keyboard.clone().addScaledVector(right,-arm.side*.14).addScaledVector(forward,-.1);target.y+=.055-tap*.012
    const toTarget=target.clone().sub(shoulder),reach=Math.min(toTarget.length(),(upperLength+foreLength)*.995)
    toTarget.normalize()
    const along=(upperLength*upperLength+reach*reach-foreLength*foreLength)/(2*reach),lift=Math.sqrt(Math.max(0,upperLength*upperLength-along*along))
    const bend=new THREE.Vector3(0,-1,0).addScaledVector(right,-arm.side*.35)
    bend.addScaledVector(toTarget,-bend.dot(toTarget)).normalize()
    const elbowGoal=shoulder.clone().addScaledVector(toTarget,along).addScaledVector(bend,lift)
    aimBone(arm.upper,arm.fore,elbowGoal.sub(shoulder).normalize())
    aimBone(arm.fore,arm.hand,target.clone().sub(arm.fore.getWorldPosition(new THREE.Vector3())).normalize())
    if(arm.finger)aimBone(arm.hand,arm.finger,forward.clone().multiplyScalar(.97).add(new THREE.Vector3(0,-.2-tap*.22,0)).normalize())
  })
}
// Rocketbox has no talking animation either, so speaking is layered over whatever pose they're in.
function reachArm(arm,target,right,weight){
  const before=[arm.upper.quaternion.clone(),arm.fore.quaternion.clone()]
  const shoulder=arm.upper.getWorldPosition(new THREE.Vector3()),elbow=arm.fore.getWorldPosition(new THREE.Vector3()),wrist=arm.hand.getWorldPosition(new THREE.Vector3())
  const upperLength=shoulder.distanceTo(elbow),foreLength=elbow.distanceTo(wrist)
  const toTarget=target.clone().sub(shoulder),reach=Math.min(toTarget.length(),(upperLength+foreLength)*.995)
  toTarget.normalize()
  const along=(upperLength*upperLength+reach*reach-foreLength*foreLength)/(2*reach),lift=Math.sqrt(Math.max(0,upperLength*upperLength-along*along))
  const bend=new THREE.Vector3(0,-1,0).addScaledVector(right,-arm.side*.35)
  bend.addScaledVector(toTarget,-bend.dot(toTarget)).normalize()
  aimBone(arm.upper,arm.fore,shoulder.clone().addScaledVector(toTarget,along).addScaledVector(bend,lift).sub(shoulder).normalize())
  aimBone(arm.fore,arm.hand,target.clone().sub(arm.fore.getWorldPosition(new THREE.Vector3())).normalize())
  arm.upper.quaternion.slerp(before[0],1-weight)
  arm.fore.quaternion.slerp(before[1],1-weight)
  arm.upper.updateMatrixWorld(true)
}
// The first angle in front of them with nothing like a plant or monitor in the way.
function clearViewOf(a){
  const people_=new Set(),blockers=[]
  actors.forEach(other=>other.g.traverse(o=>people_.add(o)))
  scene.traverse(o=>{if(o.isMesh&&!people_.has(o)&&o!==marker&&!(o.material?.transparent))blockers.push(o)})
  const head=a.g.position.clone();head.y+=SPEAKER_HEIGHT
  const front=a.baseTurn??a.g.rotation.y,ray=new THREE.Raycaster()
  const isClear=az=>{
    const way=new THREE.Vector3(Math.sin(az)*Math.cos(SPEAKER_RISE),Math.sin(SPEAKER_RISE),Math.cos(az)*Math.cos(SPEAKER_RISE))
    ray.set(head,way);ray.near=.3;ray.far=SPEAKER_DISTANCE+.4
    return ray.intersectObjects(blockers,false).length===0
  }
  return front+(SPEAKER_ANGLES.find(angle=>isClear(front+angle))??SPEAKER_ANGLES[0])
}
function speak(a,t,dt){
  const life=a.life,isSpeaking=a.p.id===speaker
  life.talk=(life.talk||0)+((isSpeaking?1:0)-(life.talk||0))*Math.min(1,dt*4)
  const weight=life.talk
  if(weight<.01){
    if(a.baseTurn!==undefined){a.g.rotation.y=a.baseTurn;a.baseTurn=undefined}
    if(life.jaw&&life.jawRest)life.jaw.quaternion.copy(life.jawRest)
    return
  }
  const camera_=camera.position,canTurnBody=(a.pose==='stand'||a.pose==='wave')&&!a.route
  if(canTurnBody&&a.baseTurn===undefined)a.baseTurn=a.g.rotation.y
  const baseY=a.baseTurn??a.g.rotation.y
  const forward=new THREE.Vector3(Math.sin(baseY),0,Math.cos(baseY))
  const toCamera=new THREE.Vector3(camera_.x-a.g.position.x,0,camera_.z-a.g.position.z).normalize()
  const angle=Math.atan2(forward.z*toCamera.x-forward.x*toCamera.z,forward.x*toCamera.x+forward.z*toCamera.z)
  let left=angle
  if(canTurnBody){a.g.rotation.y=baseY+angle*weight;left=0}
  const turn=(bone,amount)=>{if(!bone)return;bone.getWorldQuaternion(tempWorld);tempAxis.copy(WORLD_UP).applyQuaternion(tempWorld.invert());bone.quaternion.multiply(tempTurn.setFromAxisAngle(tempAxis,amount*weight))}
  const twist=Math.max(-.55,Math.min(.55,left*.45))
  turn(life.spine,twist)
  life.model.updateMatrixWorld(true)
  const nod=Math.sin(t*2.3+nameHash(a.p.id))*.035+Math.sin(t*5.1)*.015
  turn(life.head,Math.max(-.85,Math.min(.85,left-twist))+Math.sin(t*1.1)*.05)
  const right=new THREE.Vector3(-toCamera.z,0,toCamera.x)
  life.head.getWorldQuaternion(tempWorld)
  tempAxis.copy(right).applyQuaternion(tempWorld.invert())
  life.head.quaternion.multiply(tempTurn.setFromAxisAngle(tempAxis,nod*weight))
  // Sentences have pauses, so the mouth and hands rest now and then.
  const phrase=Math.sin(t*.9)*.5+.5>.14?1:.15
  if(life.jaw){
    const syllables=Math.max(0,Math.sin(t*13)*.6+Math.sin(t*8.3+1)*.4)
    life.jaw.parent.getWorldQuaternion(tempWorld)
    tempAxis.copy(right).applyQuaternion(tempWorld.invert())
    life.jaw.quaternion.copy(life.jawRest).premultiply(tempTurn.setFromAxisAngle(tempAxis,JAW_OPEN*syllables*phrase*weight))
  }
  life.model.updateMatrixWorld(true)
  const facing=forward.clone().add(toCamera).normalize(),across=new THREE.Vector3(facing.z,0,-facing.x)
  const chest=life.spine.getWorldPosition(new THREE.Vector3())
  life.arms.forEach((arm,i)=>{
    if(!arm.upper||!arm.fore||!arm.hand)return
    const beat=Math.sin(t*2.1+i*2.2+nameHash(a.p.id)%5)*phrase,sweep=Math.sin(t*1.3+i*1.4)*phrase
    const target=chest.clone().addScaledVector(facing,.36+beat*.05).addScaledVector(across,-arm.side*(.2+sweep*.07))
    target.y+=.04+beat*.07
    reachArm(arm,target,across,weight)
  })
}
function liven(a,t,dt){
  const life=a.life
  if(!life||!life.head)return
  if(a.pose==='work')typeOnKeyboard(a,t)
  if(a.p.isWaiting&&!a.route&&life.spine){
    life.spine.getWorldQuaternion(tempWorld)
    tempAxis.set(1,0,0).applyQuaternion(a.g.quaternion).applyQuaternion(tempWorld.invert())
    life.spine.quaternion.multiply(tempTurn.setFromAxisAngle(tempAxis,-.16+Math.sin(t*.7)*.015))
  }
  if(t>life.nextGlance){life.goal=Math.random()<.35?0:(Math.random()-.5)*.8;life.nextGlance=t+2.5+Math.random()*5}
  life.yaw+=(life.goal-life.yaw)*Math.min(1,dt*3.5)
  life.head.getWorldQuaternion(tempWorld)
  tempAxis.copy(WORLD_UP).applyQuaternion(tempWorld.invert())
  life.head.quaternion.multiply(tempTurn.setFromAxisAngle(tempAxis,life.yaw))
  if(t>life.nextBlink){life.blink=.14;life.nextBlink=t+2+Math.random()*4.5}
  if(life.blink>0){
    life.blink=Math.max(0,life.blink-dt)
    const shut=Math.sin((1-life.blink/.14)*Math.PI)
    const shift=(bone,distance)=>{bone.parent.getWorldQuaternion(tempWorld);tempAxis.copy(WORLD_UP).applyQuaternion(tempWorld.invert());bone.position.addScaledVector(tempAxis,distance*shut)}
    life.lids.forEach(bone=>shift(bone,-.75))
    life.lower.forEach(bone=>shift(bone,.2))
    life.undo=()=>{life.lids.forEach(bone=>shift(bone,.75));life.lower.forEach(bone=>shift(bone,-.2));life.undo=null}
  }
  speak(a,t,dt)
}
function character(p){
  const g=new THREE.Group(), hit=new THREE.Mesh(new THREE.BoxGeometry(1,2.3,1),new THREE.MeshBasicMaterial({visible:false}))
  hit.position.y=1.15;hit.userData.person=p;g.add(hit)
  return {g,p}
}
async function dress(a){
  const id=castOf(a.p),sex=sexOf(id),source=await template(id)
  if(!actors.includes(a))return
  const model=cloneSkinned(source);model.scale.setScalar(MODEL_SCALE);a.g.add(model)
  a.mixer=new THREE.AnimationMixer(model);a.sex=sex
  a.mixer.timeScale=.88+Math.random()*.24
  a.life={head:model.getObjectByName('Bip01_Head'),lids:['LEyeBlinkTop','REyeBlinkTop'].map(n=>model.getObjectByName(n)).filter(Boolean),lower:['LEyeBlinkBottom','REyeBlinkBottom'].map(n=>model.getObjectByName(n)).filter(Boolean),arms:['L','R'].map(side=>({side:side==='L'?-1:1,upper:model.getObjectByName(`Bip01_${side}_UpperArm`),fore:model.getObjectByName(`Bip01_${side}_Forearm`),hand:model.getObjectByName(`Bip01_${side}_Hand`),finger:model.getObjectByName(`Bip01_${side}_Finger2`)})),model,spine:model.getObjectByName('Bip01_Spine1'),jaw:model.getObjectByName('Bip01_MJaw'),yaw:0,goal:0,nextGlance:1+Math.random()*4,nextBlink:1+Math.random()*4,blink:0}
  if(a.life.jaw)a.life.jawRest=a.life.jaw.quaternion.clone()
  setPose(a,a.pose)
  if(a.holdsMug)giveMug(a)
}
async function setPose(a,pose){
  a.pose=pose
  if(!a.mixer)return
  const made=await clip(a.sex,pose)
  if(a.pose!==pose)return
  const next=a.mixer.clipAction(made)
  next.reset();next.time=Math.random()*made.duration;next.play()
  if(a.action&&a.action!==next)a.action.crossFadeTo(next,.25,false)
  a.action=next
}
function credenza(parent,x,z){
  box(parent,2.4,.08,.48,0x5e422e,x,.86,z)
  box(parent,2.3,.6,.42,0x4f3726,x,.52,z)
  ;[-.77,0,.77].forEach(dx=>{box(parent,.72,.52,.012,0x583e2b,x+dx,.52,z+.215);box(parent,.14,.02,.02,SILVER,x+dx,.6,z+.23)})
  ;[-1,1].forEach(side=>box(parent,.06,.22,.34,CHARCOAL,x+side*1.08,.11,z))
  deskPlant(parent,x-.8,z);book(parent,x+.6,.92,z,.34,.26,.05,bookColor(24),.15,24);book(parent,x+.62,.97,z,.3,.24,.04,bookColor(26),-.1,26)
}
function bookcase(parent,x,z){
  const WIDE=1.8,TALL=2.05
  box(parent,.34,TALL,.05,0x4a3324,x,TALL/2,z-WIDE/2);box(parent,.34,TALL,.05,0x4a3324,x,TALL/2,z+WIDE/2);box(parent,.03,TALL,WIDE,0x3a281c,x-.16,TALL/2,z)
  for(let shelf=0;shelf<5;shelf++){
    const y=.06+shelf*.49;box(parent,.34,.04,WIDE,0x4f3726,x,y,z)
    if(shelf===4)continue
    let at=z-WIDE/2+.08,n=shelf*7+3
    while(at<z+WIDE/2-.16){n=(n*31+11)%97;const thick=.05+(n%4)*.018;if(n%9){const high=.27+(n%5)*.028;const title=SHELF[n%SHELF.length];box(parent,.22,high,thick,bookColor(title),x,y+.02+high/2,at+thick/2);bookSpine(parent,title,x+.112,y+.02+high/2,at+thick/2,thick,high)}at+=thick+.006}
  }
}
function floorLamp(parent,x,z){
  box(parent,.34,.03,.34,CHARCOAL,x,.02,z);box(parent,.03,1.72,.03,CHARCOAL,x,.88,z)
  const shade=new THREE.Mesh(new THREE.CylinderGeometry(.17,.27,.34,18,1,true),new THREE.MeshBasicMaterial({color:0xfff0cf,side:THREE.DoubleSide}));shade.position.set(x,1.82,z);parent.add(shade)
}
function wallArt(parent,x,z){
  box(parent,1.5,1.02,.04,0x22252b,x,1.7,z)
  const art=paintTex(384,256,(g,w,h)=>{const sky=g.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#f2c58a');sky.addColorStop(.6,'#e0805f');sky.addColorStop(1,'#3a4a68');g.fillStyle=sky;g.fillRect(0,0,w,h);g.fillStyle='#fbe6b8';g.beginPath();g.arc(w*.68,h*.42,30,0,7);g.fill();g.fillStyle='#2f3d58';g.beginPath();g.moveTo(0,h);g.lineTo(0,h*.62);g.lineTo(w*.3,h*.4);g.lineTo(w*.55,h*.66);g.lineTo(w*.8,h*.5);g.lineTo(w,h*.68);g.lineTo(w,h);g.fill()})
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(1.38,.9),new THREE.MeshBasicMaterial({map:art}));panel.position.set(x,1.7,z+.024);parent.add(panel)
}
const soft=c=>mats['s'+c]||(mats['s'+c]=new THREE.MeshLambertMaterial({color:c}))
function rbox(parent,w,h,d,r,c,x=0,y=0,z=0){const m=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/2-.001,h/2-.001,d/2-.001)),typeof c==='number'?soft(c):c);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m}
// One bent, tapered leaf, instanced so a full plant is a single draw.
function makeLeaf(){
  const g=new THREE.PlaneGeometry(1,1,2,6),p=g.attributes.position
  for(let i=0;i<p.count;i++){
    const y=p.getY(i)+.5,x=p.getX(i)*2,width=Math.sin(Math.PI*Math.pow(y,.75))*.5
    p.setXYZ(i,x*width,y,-y*y*.55+Math.abs(x)*width*.18)
  }
  g.computeVertexNormals();return g
}
function foliage(parent,x,y,z,leaves,seed){
  const mesh=new THREE.InstancedMesh(makeLeaf(),new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),leaves.length),o=new THREE.Object3D(),c=new THREE.Color(),dark=new THREE.Color(0x1f6f3f),light=new THREE.Color(0x58b56f)
  leaves.forEach((l,i)=>{
    o.position.set(x+l.x,y+l.y,z+l.z);o.rotation.set(0,0,0);o.rotateY(l.yaw);o.rotateX(l.tilt);o.scale.set(l.w,l.len,l.len)
    o.updateMatrix();mesh.setMatrixAt(i,o.matrix)
    const n=((seed+i*37)%100)/100;mesh.setColorAt(i,c.copy(dark).lerp(light,n))
  })
  mesh.castShadow=true;mesh.frustumCulled=false;parent.add(mesh)
}
function planter(parent,x,z,r,h,seed,y=0){
  const pot=new THREE.Mesh(new THREE.CylinderGeometry(r,r*.76,h,20),soft([WHITE,0xb9673f,CHARCOAL][seed%3]));pot.position.set(x,y+h/2,z);pot.castShadow=pot.receiveShadow=true;parent.add(pot)
  const soil=new THREE.Mesh(new THREE.CylinderGeometry(r*.92,r*.92,.012,20),soft(0x3a2a1e));soil.position.set(x,y+h-.012,z);parent.add(soil)
}
// Black pendants: one real light per area, because many would be slow, and a soft pool on the floor under each.
function pendant(x,z,hasLight=true){
  const y=PENDANT_Y
  box(world,.02,WALL_HEIGHT-y-.3,.02,0x151515,x,(WALL_HEIGHT+y+.3)/2,z)
  const shade=new THREE.Mesh(new THREE.ConeGeometry(.42,.42,24,1,true),new THREE.MeshLambertMaterial({color:0x151515,side:THREE.DoubleSide}));shade.position.set(x,y+.1,z);lighting.add(shade)
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.13,14,10),lit.bulb);bulb.position.set(x,y-.03,z);lighting.add(bulb)
  const pool=new THREE.Mesh(new THREE.PlaneGeometry(9,9),lit.pool);pool.rotation.x=-Math.PI/2;pool.position.set(x,.05,z);lighting.add(pool)
  if(hasLight){const light=new THREE.PointLight(0xffd8a8,0,20,1.5);light.position.set(x,y-.2,z);lighting.add(light);lit.lights.push(light)}
}
function plant(parent,x,z,size=1){
  const seed=Math.abs(Math.round(x*17+z*31))
  planter(parent,x,z,.4*size,.72*size,seed)
  const leaves=[]
  if(seed%2){
    // A small tree: a slim trunk with leaves spiralling up it.
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.025*size,.05*size,1.5*size,8),soft(0x6a4a30));trunk.position.set(x,1.4*size,z);trunk.castShadow=true;parent.add(trunk)
    for(let i=0;i<58;i++){const a=i*2.4,h=1+(i/58)*1.3,spread=.04+.08*(1-i/58);leaves.push({x:Math.cos(a)*spread*size,y:h*size,z:Math.sin(a)*spread*size,yaw:a,tilt:.75+(i%5)*.13,w:.28*size,len:(.52-.0022*i)*size})}
  }else{
    // Long blades arching out from the pot.
    for(let i=0;i<34;i++){const a=i*2.4,r=i/34;leaves.push({x:Math.cos(a)*.1*size,y:.7*size,z:Math.sin(a)*.1*size,yaw:a,tilt:.1+r*.62,w:.34*size,len:(1.75-r*.62)*size})}
  }
  foliage(parent,x,0,z,leaves,seed)
}
const WOOD_TOP=()=>new THREE.MeshLambertMaterial({map:paintTex(512,256,(g,w,h)=>{g.fillStyle='#5a3f2b';g.fillRect(0,0,w,h);for(let i=0;i<90;i++){const y=(i*53)%h;g.strokeStyle=i%3?'rgba(28,18,10,.32)':'rgba(132,102,78,.2)';g.lineWidth=1+(i%3);g.beginPath();g.moveTo(0,y);g.bezierCurveTo(w*.3,y+(i%9)-4,w*.7,y-(i%7)+3,w,y+(i%5)-2);g.stroke()}})})
let woodTop=null
const SILVER=0xc9ccd1
function tableTop(parent,x,z,length,depth){
  woodTop=woodTop||WOOD_TOP()
  rbox(parent,length,.07,depth,.028,woodTop,x,1.02,z)
  const legRows=Math.max(1,Math.round(length/2.6))
  for(let i=0;i<=legRows;i++){const lx=x-length/2+.08+i*(length-.16)/legRows;[-1,1].forEach(side=>box(parent,.05,1,.05,0x30343b,lx,.5,z+side*(depth/2-.1)))}
}
function deskPlant(parent,x,z){
  const seed=Math.abs(Math.round(x*23+z*41))
  planter(parent,x,z,.085,.13,seed,1.055)
  const leaves=[];for(let i=0;i<13;i++){const a=i*2.4,r=i/13;leaves.push({x:Math.cos(a)*.02,y:1.16,z:Math.sin(a)*.02,yaw:a,tilt:.12+r*.75,w:.1,len:.34-r*.08})}
  foliage(parent,x,0,z,leaves,seed)
}
const BOOK_COLORS=[0xa33d2e,0x274f7d,0xc08a2b,0x2f6b52,0x5a3f7a,0x2b2f36]
let pageMaterial=null
// Real books on the desks and shelves, picked by what each team works on.
const LIBRARY={
  vision:[['Multiple View Geometry','Hartley & Zisserman'],['Computer Vision: Algorithms and Applications','Szeliski'],['Physically Based Rendering','Pharr, Jakob & Humphreys'],['Real-Time Rendering','Akenine-Möller et al.'],['Programming Computer Vision with Python','Solem'],['Probabilistic Robotics','Thrun, Burgard & Fox'],['State Estimation for Robotics','Barfoot'],['Digital Image Processing','Gonzalez & Woods']],
  ml:[['Deep Learning','Goodfellow, Bengio & Courville'],['Reinforcement Learning','Sutton & Barto'],['Pattern Recognition and Machine Learning','Bishop'],['The Mortal Mirror',''],['Neuronal Dynamics','Gerstner et al.'],['Theoretical Neuroscience','Dayan & Abbott'],['Information Theory, Inference, and Learning Algorithms','MacKay'],['Dive into Deep Learning','Zhang et al.']],
  law:[['Introduction to Information Retrieval','Manning, Raghavan & Schütze'],['Legal Research in a Nutshell','Cohen & Olson'],['Speech and Language Processing','Jurafsky & Martin'],["Black's Law Dictionary",'Garner'],['Legal Writing in Plain English','Garner'],['Search Engines: Information Retrieval in Practice','Croft, Metzler & Strohman'],['Thinking Like a Lawyer','Schauer'],['Foundations of Statistical NLP','Manning & Schütze']],
  general:[['Designing Data-Intensive Applications','Kleppmann'],['The Pragmatic Programmer','Hunt & Thomas'],['Structure and Interpretation of Computer Programs','Abelson & Sussman'],['The Mythical Man-Month','Brooks'],['Gödel, Escher, Bach','Hofstadter'],['Thinking, Fast and Slow','Kahneman'],['The Design of Everyday Things','Norman'],['A Philosophy of Software Design','Ousterhout']],
}
const TOPICS=Object.keys(LIBRARY),SHELF=TOPICS.flatMap((topic,t)=>LIBRARY[topic].map((_,i)=>t*8+i))
const topicOf=text=>/legal|\blaw\b|contract|court|retriev|\brag\b/i.test(text)?'law':/vision|render|\b3d\b|\bar\b|camera|track|splat|mapping|superpup/i.test(text)?'vision':/\bml\b|learn|memory|model|neural|clancy/i.test(text)?'ml':'general'
const bookColor=i=>BOOK_COLORS[i%BOOK_COLORS.length]
const COVER_W=256,COVER_H=340,SPINE_W=64
let bookAtlas=null,deskTopic='general'
function wrapped(g,text,width){const lines=[];let line='';text.split(' ').forEach(word=>{if(line&&g.measureText(`${line} ${word}`).width>width){lines.push(line);line=word}else line=line?`${line} ${word}`:word});lines.push(line);return lines}
function booksMaterial(){
  if(bookAtlas)return bookAtlas
  const tex=paintTex(2048,2048,g=>{
    TOPICS.forEach((topic,t)=>LIBRARY[topic].forEach(([title,author],n)=>{
      const i=t*8+n,x=(i%8)*COVER_W,y=Math.floor(i/8)*COVER_H,color=`#${bookColor(i).toString(16).padStart(6,'0')}`
      g.fillStyle=color;g.fillRect(x,y,COVER_W,COVER_H)
      g.strokeStyle='#e9dfc8';g.lineWidth=3;g.strokeRect(x+14,y+14,COVER_W-28,COVER_H-28)
      g.fillStyle='#f5eeda';g.textAlign='center';g.textBaseline='middle';g.font='bold 29px Georgia, serif'
      const lines=wrapped(g,title,COVER_W-52);lines.forEach((line,l)=>g.fillText(line,x+COVER_W/2,y+130+(l-(lines.length-1)/2)*35))
      g.font='20px Georgia, serif';g.fillText(author,x+COVER_W/2,y+COVER_H-44)
      const sx=i*SPINE_W,sy=4*COVER_H
      g.fillStyle=color;g.fillRect(sx,sy,SPINE_W,COVER_H)
      g.save();g.translate(sx+SPINE_W/2,sy+COVER_H/2);g.rotate(Math.PI/2);g.fillStyle='#f5eeda';g.font='bold 24px Georgia, serif';g.fillText(title.length>26?`${title.slice(0,25)}…`:title,0,0);g.restore()
    }))
  })
  tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.anisotropy=renderer.capabilities.getMaxAnisotropy();tex.keep=true
  bookAtlas=new THREE.MeshLambertMaterial({map:tex,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})
  return bookAtlas
}
function bookFace(parent,w,h,u,v,uw,vh,x,y,z){
  const geo=new THREE.PlaneGeometry(w,h),uv=geo.attributes.uv,left=u/2048,right=(u+uw)/2048,top=1-v/2048,bottom=1-(v+vh)/2048
  uv.setXY(0,left,top);uv.setXY(1,right,top);uv.setXY(2,left,bottom);uv.setXY(3,right,bottom)
  const face=new THREE.Mesh(geo,booksMaterial());face.position.set(x,y,z);face.receiveShadow=true;parent.add(face);return face
}
function bookSpine(parent,i,x,y,z,thick,high){bookFace(parent,thick,high,i*SPINE_W,4*COVER_H,SPINE_W,COVER_H,x,y,z).rotation.y=Math.PI/2}
const shelfBook=(topic,seed)=>TOPICS.indexOf(topic)*8+seed%8
function book(parent,x,y,z,width,depth,thick,color,turn,title=null){
  pageMaterial=pageMaterial||new THREE.MeshLambertMaterial({map:paintTex(32,32,(g,w,h)=>{g.fillStyle='#f3eee2';g.fillRect(0,0,w,h);g.fillStyle='#d9d2c1';for(let i=2;i<h;i+=3)g.fillRect(0,i,w,1)})})
  const volume=new THREE.Group();volume.position.set(x,y,z);volume.rotation.y=turn;parent.add(volume)
  const cover=.007
  box(volume,width,cover,depth,color,0,-thick/2+cover/2,0);box(volume,width,cover,depth,color,0,thick/2-cover/2,0)
  box(volume,.009,thick,depth,color,-width/2+.0045,0,0)
  box(volume,width-.022,thick-cover*2,depth-.012,pageMaterial,.004,0,0)
  if(title===null)box(volume,width*.42,.001,depth*.09,0xe9dfc8,0,thick/2+.0006,-depth*.22)
  else bookFace(volume,width,depth,(title%8)*COVER_W,Math.floor(title/8)*COVER_H,COVER_W,COVER_H,0,thick/2+.001,0).rotation.x=-Math.PI/2
}
function folders(parent,x,z,seed){
  let y=1.056
  for(let i=0,n=2+seed%3;i<n;i++){const thick=.028+((seed>>>i)%3)*.012;book(parent,x+(i%2?.012:-.008),y+thick/2,z+(i%2?-.01:.006),.26-(i%2)*.02,.34-(i%3)*.012,thick,bookColor(shelfBook(deskTopic,seed+i*3)),(i%2?1:-1)*.06+(seed%5)*.02,shelfBook(deskTopic,seed+i*3));y+=thick}
}
function coffee(parent,x,z,seed){
  const color=[WHITE,ORANGE,0x2f3540,0x2f7dd1][seed%4],cup=new THREE.Mesh(new THREE.CylinderGeometry(.055,.048,.115,12),mat(color));cup.position.set(x,1.115,z);cup.castShadow=true;parent.add(cup)
  const drink=new THREE.Mesh(new THREE.CylinderGeometry(.047,.047,.005,12),mat(0x4a2c1a));drink.position.set(x,1.17,z);parent.add(drink)
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.03,.009,6,10),mat(color));handle.position.set(x+.06,1.115,z);parent.add(handle)
}
function notebook(parent,x,z,seed){
  book(parent,x,1.067,z,.22,.3,.022,[0x2b2f36,0xa33d2e,0x276b52][seed%3],.12)
  const pen=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.15,6),mat(seed%2?0x2f7dd1:0x1c1c20));pen.rotation.set(Math.PI/2,0,.4);pen.position.set(x+.03,1.084,z);parent.add(pen)
}
function penCup(parent,x,z){
  const cup=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.12,10),mat(0x8d939c));cup.position.set(x,1.115,z);parent.add(cup)
  ;[0x2f7dd1,0xd9503f,0x1c1c20].forEach((c,i)=>{const pen=box(parent,.012,.2,.012,c,x-.018+i*.018,1.2,z+(i-1)*.012);pen.rotation.z=(i-1)*.12})
}
function deskLamp(parent,x,z,dir){
  box(parent,.16,.02,.16,0x30343b,x,1.067,z)
  const arm=box(parent,.018,.42,.018,0x30343b,x,1.26,z);arm.rotation.x=dir*.2
  const shade=new THREE.Mesh(new THREE.ConeGeometry(.09,.12,12),mat(0xe8a93a));shade.position.set(x,1.47,z+dir*.09);shade.castShadow=true;parent.add(shade)
}
function photo(parent,x,z,dir){
  const frame=box(parent,.17,.21,.015,0x5e4630,x,1.17,z);frame.rotation.x=-dir*.18
  const image=box(parent,.135,.175,.004,0x8dbcd8,x,1.17,z+dir*.012);image.rotation.x=-dir*.18
}
const KEYBOARD_OFFSET=.36
let keyboardMaterials=null
function keyboard(parent,x,z,dir){
  if(!keyboardMaterials){
    const keys=paintTex(512,180,(g,w,h)=>{g.fillStyle='#d9dbde';g.fillRect(0,0,w,h);const rows=[14,14,13,12,10];rows.forEach((count,r)=>{const unit=(w-14)/14.4;let kx=7;for(let i=0;i<count;i++){const wide=(r===4&&i===4)?5.6:(r>0&&i===0)?1+r*.2:(i===count-1&&r>0)?1+r*.28:1;const kw=unit*wide-3;g.fillStyle='#fafbfb';g.fillRect(kx,7+r*34,kw,29);g.fillStyle='#c6c9cd';g.fillRect(kx,7+r*34+27,kw,2);kx+=kw+3}})})
    keyboardMaterials=[mat(SILVER),mat(SILVER),new THREE.MeshLambertMaterial({map:keys}),mat(SILVER),mat(SILVER),mat(SILVER)]
  }
  const body=new THREE.Mesh(new THREE.BoxGeometry(.5,.012,.17),keyboardMaterials);body.position.set(x,1.064,z+dir*KEYBOARD_OFFSET);body.rotation.y=dir===1?Math.PI:0;body.rotation.x=dir*.035;body.castShadow=true;parent.add(body)
  const mouse=new THREE.Mesh(new THREE.SphereGeometry(.05,14,10),mat(0xf2f3f4));mouse.scale.set(.65,.3,1.1);mouse.position.set(x+.36,1.066,z+dir*KEYBOARD_OFFSET);mouse.castShadow=true;parent.add(mouse)
}
function roundedPanel(width,height,depth,radius){
  const w=width/2-radius,h=height/2-radius,shape=new THREE.Shape()
  shape.moveTo(-w,-height/2);shape.lineTo(w,-height/2);shape.quadraticCurveTo(width/2,-height/2,width/2,-h);shape.lineTo(width/2,h);shape.quadraticCurveTo(width/2,height/2,w,height/2);shape.lineTo(-w,height/2);shape.quadraticCurveTo(-width/2,height/2,-width/2,h);shape.lineTo(-width/2,-h);shape.quadraticCurveTo(-width/2,-height/2,-w,-height/2)
  const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:6});geometry.translate(0,0,-depth/2);return geometry
}
// One person's place at a table, with their own mix of things around the keyboard.
function workstation(parent,x,z,dir,isOn,owner=''){
  const seed=nameHash(owner),back=z-dir*.28
  const foot=new THREE.Mesh(roundedPanel(.25,.19,.012,.03),mat(SILVER));foot.rotation.x=Math.PI/2;foot.position.set(x,1.063,back);foot.castShadow=true;parent.add(foot)
  const stand=box(parent,.15,.3,.014,SILVER,x,1.2,back-dir*.022);stand.rotation.x=-dir*.11
  const body=new THREE.Mesh(roundedPanel(.88,.54,.018,.022),mat(SILVER));body.position.set(x,1.54,back);body.castShadow=true;parent.add(body)
  const glass=new THREE.Mesh(roundedPanel(.86,.46,.002,.012),mat(0x101217));glass.position.set(x,1.565,back+dir*.0105);if(dir===-1)glass.rotation.y=Math.PI;parent.add(glass)
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(.81,.41),isOn?glow(0x59c7ff):mat(0x262a31));screen.position.set(x,1.565,back+dir*.0125);if(dir===-1)screen.rotation.y=Math.PI;parent.add(screen)
  keyboard(parent,x,z,dir)
  coffee(parent,x-.5,z+dir*.26,seed)
  const left=x-.82,right=x+.82,rear=z-dir*.2,near=z+dir*.13
  const side=[[deskPlant,folders],[folders,notebook],[notebook,deskPlant],[penCup,folders],[deskPlant,notebook]][seed%5]
  ;[[side[0],left,rear],[side[1],right,near]].forEach(([item,ix,iz])=>item(parent,ix,iz,seed))
  if(seed%3===0)deskLamp(parent,right,rear,dir)
  else if(seed%3===1)photo(parent,left+.3,rear,dir)
  else penCup(parent,right,rear)
  return screen
}
function desk(parent,x,z,dir,isOn,owner){
  tableTop(parent,x,z,2.1,1.1)
  return workstation(parent,x,z,dir,isOn,owner)
}
function chair(parent,x,z,dir){
  rbox(parent,.74,.11,.72,.05,CHARCOAL,x,.66,z)
  rbox(parent,.68,.8,.08,.035,0x48505e,x,1.14,z+dir*.38)
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.52,10),soft(0x8d939c));stem.position.set(x,.35,z);parent.add(stem)
  for(let i=0;i<5;i++){const a=i*1.257,leg=box(parent,.42,.035,.05,0x8d939c,x+Math.cos(a)*.2,.08,z+Math.sin(a)*.2);leg.rotation.y=-a}
}
function couch(parent,x,z,w,dress=c=>c){
  const fabric=dress(0x9aa4a6),frame=dress(0x7f8a8d),backing=dress(0x8d989b),inner=w-.42,count=Math.max(2,Math.round(inner/1.5)),each=inner/count
  rbox(parent,w,.2,1.05,.05,frame,x,.26,z)
  rbox(parent,w,.72,.26,.08,frame,x,.74,z-.46)
  ;[-1,1].forEach(side=>rbox(parent,.26,.58,1.05,.09,frame,x+side*w/2,.47,z))
  for(let i=0;i<count;i++){
    const cx=x-inner/2+(i+.5)*each
    rbox(parent,each-.02,.25,.82,.075,fabric,cx,.495,z+.08)
    rbox(parent,each-.03,.5,.2,.08,backing,cx,.86,z-.3)
  }
  for(let i=0;i<count;i+=2){const px=x-inner/2+(i+.22)*each,pillow=rbox(parent,.44,.42,.13,.06,dress([0xe0682f,0xe8dcc0][(i/2)%2]),px,.84,z-.16);pillow.rotation.x=-.3;pillow.rotation.z=.12}
  ;[-1,1].forEach(a=>[-1,1].forEach(b=>box(parent,.06,.16,.06,0x30343b,x+a*(w/2-.05),.08,z+b*.45)))
}
function armchair(parent,x,z,turn){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=turn;parent.add(g)
  rbox(g,1,.2,.92,.05,0x2d7f8c,0,.3,0);rbox(g,.78,.23,.72,.07,0x3b95a3,0,.5,.07)
  rbox(g,1,.68,.22,.08,0x2d7f8c,0,.74,-.38)
  ;[-1,1].forEach(s=>rbox(g,.2,.48,.92,.08,0x2d7f8c,s*.45,.46,0))
  ;[-1,1].forEach(a=>[-1,1].forEach(b=>box(g,.05,.2,.05,WOOD,a*.42,.1,b*.38)))
}
function coffeeTable(parent,x,z,length){
  woodTop=woodTop||WOOD_TOP()
  rbox(parent,length,.06,.9,.025,woodTop,x,.5,z)
  rbox(parent,length-.3,.03,.66,.012,0x8a613b,x,.2,z)
  ;[-1,1].forEach(a=>[-1,1].forEach(b=>box(parent,.04,.48,.04,0x30343b,x+a*(length/2-.08),.24,z+b*.37)))
  book(parent,x-length*.26,.53,z-.08,.44,.32,.05,0x2f7dd1,.15);book(parent,x-length*.26,.58,z-.08,.38,.28,.04,0xd9503f,-.1)
  const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.17,.1,.09,16),soft(WHITE));bowl.position.set(x+length*.24,.575,z+.05);bowl.castShadow=true;parent.add(bowl)
}
// Amazon Berkeley Objects (CC BY 4.0) and Poly Haven (CC0) models, kept off with ?furniture=off to compare.
const REAL_FURNITURE=new URLSearchParams(location.search).get('furniture')!=='off'
const OFFICE_CHAIR='B072Z6K34L',FURNITURE='/assets/furniture',FURNITURE_SCALE=1.22,furnitureModels=new Map()
function furnitureModel(id){
  if(!furnitureModels.has(id))furnitureModels.set(id,new Promise((resolve,reject)=>new GLTFLoader().load(id.startsWith('B0')?`${FURNITURE}/abo/${id}.glb`:`${FURNITURE}/${id}/${id}_1k.gltf`,gltf=>{
    gltf.scene.traverse(o=>{
      if(!o.isMesh)return
      o.castShadow=o.receiveShadow=true;o.userData.keep=true
      if(o.material.map)o.material.map.encoding=THREE.LinearEncoding
      o.material.envMapIntensity=.75
    })
    resolve(gltf.scene)
  },undefined,reject)))
  return furnitureModels.get(id)
}
// Placed by width when given, and always standing on the floor, centred on the spot.
async function placeModel(id,x,z,turn=0,width=null,y=0){
  const room=world,source=await furnitureModel(id)
  if(room!==world)return null
  const model=source.clone(true)
  model.rotation.y=turn
  const size=new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3())
  const scale=width?width/Math.max(size.x,.001):FURNITURE_SCALE
  model.scale.setScalar(scale)
  room.add(model);model.position.set(0,0,0);model.updateMatrixWorld(true)
  const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3())
  model.position.set(x-center.x,y-box.min.y,z-center.z)
  return model
}
let lightingLoaded=false
function loadLighting(){
  if(lightingLoaded||!REAL_FURNITURE)return
  lightingLoaded=true
  new RGBELoader().setDataType(THREE.UnsignedByteType).load(`${FURNITURE}/art_studio_1k.hdr`,texture=>{
    const pmrem=new THREE.PMREMGenerator(renderer)
    scene.environment=pmrem.fromEquirectangular(texture).texture
    texture.dispose();pmrem.dispose()
  })
}
let sofaFabric=null
function fabricFor(){
  if(sofaFabric)return sofaFabric
  const tex=name=>{const t=textures.load(`${FURNITURE}/fabric/${name}.jpg`);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,2);t.anisotropy=8;return t}
  sofaFabric={map:tex('diff'),normalMap:tex('nor')}
  return sofaFabric
}
const fabricMaterial=color=>mats['f'+color]||(mats['f'+color]=new THREE.MeshStandardMaterial({color,...fabricFor(),roughness:.92,metalness:0,envMapIntensity:.6}))
const SOFA_WIDTH=2.45
const sofaCount=W=>Math.max(1,Math.floor((W-1.2)/(SOFA_WIDTH+.05)))
const sofaX=(cx,W,i)=>cx+(i-(sofaCount(W)-1)/2)*(SOFA_WIDTH+.05)
// Two people to a sofa, so nobody ends up on an armrest unless the lounge is full.
// Two couches at a right angle and square to the rug: one facing the front of the room, the other your office.
function loungeLayout(cx,cz){
  const main={x:cx+LOUNGE_MAIN_X,z:cz+LOUNGE_MAIN_Z,turn:0},along={x:1,z:0},forward={x:0,z:1}
  const at=(a,f)=>({x:main.x+along.x*a+forward.x*f,z:main.z+along.z*a+forward.z*f})
  const couch=one=>{
    const seatAt=offset=>({x:one.x+Math.cos(one.turn)*offset+Math.sin(one.turn)*.18,z:one.z-Math.sin(one.turn)*offset+Math.cos(one.turn)*.18,face:one.turn})

    return {...one,seats:[seatAt(-.56),seatAt(.56)]}
  }
  const couches=[couch({...at(LOUNGE_SIDE_ACROSS,LOUNGE_SIDE_FORWARD),turn:main.turn+Math.PI/2}),couch(main)]

  return {couches,seats:couches.flatMap(one=>one.seats),table:{...at(-.55,1.95),turn:main.turn}}
}
// Couches first, and the coffee bar once they're full.
function loungeSeat(x0,z0,cx,cz,W,i,places){
  const couches=loungeLayout(cx,cz).seats
  if(places<=couches.length)return couches[Math.round((i+.5)*couches.length/places-.5)]
  const seats=[...couches,...barSeats(x0+W-1.5,z0).map(stool=>({...stool,y:BAR_SEAT_Y}))]

  return seats[i]||{x:cx-(W-2.4)/2+((i-seats.length)+.5)*(W-2.4)/Math.max(1,places-seats.length),z:cz+3.2,face:0,y:0,isStanding:true}
}
function loungeTable(parent,x,z){
  box(parent,2.6,.07,1.25,0x4a2c18,x,.56,z)
  ;[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>box(parent,.07,.53,.07,0x20130b,x+sx*1.2,.265,z+sz*.52))
  box(parent,2.3,.03,1,0x3a2213,x,.2,z)
  book(parent,x-.72,.6,z-.14,.42,.3,.05,0x7c2f25,.12);book(parent,x-.7,.65,z-.13,.38,.28,.04,0x263f58,-.1);book(parent,x-.72,.69,z-.15,.34,.25,.04,0xd8c9a8,.2)
  book(parent,x+.72,.6,z+.18,.4,.3,.05,0x2f5a4a,-.2);book(parent,x+.71,.65,z+.17,.34,.26,.04,0xc08a3c,.1)
  // deskPlant sits at desk height, so lower it onto this table.
  const plantOnTable=new THREE.Group();plantOnTable.position.y=.595-TABLE_TOP;parent.add(plantOnTable);deskPlant(plantOnTable,x+.05,z-.1,1)
}
function realLounge(world,x0,cx,cz,W,D){
  loadLighting()
  const layout=loungeLayout(cx,cz)
  layout.couches.forEach(one=>placeModel('B07PC15YLQ',one.x,one.z,one.turn))
  const table=new THREE.Group();table.position.set(layout.table.x,0,layout.table.z);table.rotation.y=layout.table.turn;world.add(table)
  loungeTable(table,0,0)
  placeModel('B072ZLCB3M',x0+.6,cz-.1,0)
  placeModel('potted_plant_02',x0+W-.65,z0Of(cz,D)+D-.75,0)
  placeModel('B073755HVS',x0+.5,cz-1.25,.6)
}
function coffeeMachine(parent,x,y,z){
  const steel=mat(0xb9bcc0),dark=mat(0x1b1c1f)
  const part=(w,h,d,material,px,py,pz)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x+px,y+py,z+pz);m.castShadow=true;parent.add(m);return m}
  part(.62,.05,.42,steel,0,.025,0)
  part(.58,.03,.2,dark,0,.06,.1)
  part(.62,.5,.14,steel,0,.3,-.12)
  part(.62,.13,.42,steel,0,.6,0)
  part(.56,.04,.38,dark,0,.685,0)
  ;[-.14,.14].forEach(dx=>{const head=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.07,12),dark);head.position.set(x+dx,y+.5,z+.1);parent.add(head);part(.03,.02,.15,dark,dx,.46,.2)})
  const wand=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.22,8),steel);wand.position.set(x+.27,y+.42,z+.15);wand.rotation.z=.18;parent.add(wand)
  const gauge=new THREE.Mesh(new THREE.CircleGeometry(.04,16),new THREE.MeshBasicMaterial({color:0xf2f0ea}));gauge.position.set(x,y+.6,z+.212);parent.add(gauge)
  ;[-.14,.14].forEach(dx=>{const cup=new THREE.Mesh(new THREE.CylinderGeometry(.038,.03,.07,12),mat(WHITE));cup.position.set(x+dx,y+.11,z+.1);parent.add(cup)})
  ;[-.14,.14].forEach(dx=>{const cup=new THREE.Mesh(new THREE.CylinderGeometry(.038,.03,.07,12),mat(WHITE));cup.position.set(x+dx,y+.74,z);parent.add(cup)})
}
function kitchenSink(parent,x,y,z){
  const steel=mat(0xc7cacd),basin=new THREE.MeshLambertMaterial({color:0x6b6e72})
  const rim=(w,d,px,pz)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,.012,d),steel);m.position.set(x+px,y+.006,z+pz);parent.add(m)}
  const well=new THREE.Mesh(new THREE.PlaneGeometry(.5,.34),basin);well.rotation.x=-Math.PI/2;well.position.set(x,y+.004,z);parent.add(well)
  rim(.58,.04,0,-.19);rim(.58,.04,0,.19);rim(.04,.42,-.27,0);rim(.04,.42,.27,0)
  const drain=new THREE.Mesh(new THREE.CircleGeometry(.03,12),new THREE.MeshLambertMaterial({color:0x2a2b2e}));drain.rotation.x=-Math.PI/2;drain.position.set(x,y+.006,z);parent.add(drain)
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.014,.016,.32,10),steel);stem.position.set(x,y+.16,z-.25);parent.add(stem)
  const arc=new THREE.Mesh(new THREE.TorusGeometry(.1,.012,8,16,Math.PI),steel);arc.rotation.y=-Math.PI/2;arc.position.set(x,y+.32,z-.15);parent.add(arc)
  const tap=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.05,8),steel);tap.position.set(x,y+.3,z-.05);parent.add(tap)
  ;[-.08,.08].forEach(dx=>{const handle=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.07,8),steel);handle.position.set(x+dx,y+.035,z-.25);parent.add(handle)})
}
function kitchen(world,x,z0){
  placeModel('B07RP1SS3S',x,z0+.35,0)
  coffee(world,x+.5,z0+.4,0);coffee(world,x-.5,z0+.3,1);deskPlant(world,x,z0+.35)
  const counter=z0+1.25,middle=x+BAR_MIDDLE
  rbox(world,BAR_LENGTH-.25,.97,.46,.03,WOOD,middle,.485,counter);rbox(world,BAR_LENGTH,.09,.72,.03,0xe9e6df,middle,1.015,counter)
  coffeeMachine(world,middle-BAR_LENGTH/2+.5,COUNTER_TOP,counter-.02)
  kitchenSink(world,middle+BAR_LENGTH/2-.45,COUNTER_TOP,counter+.03)
  // Where people stand to make a coffee, at the machine's end of the counter.
  coffeeSpot={x:middle-BAR_LENGTH/2-.45,z:counter,face:Math.PI/2}
  barSeats(x,z0).forEach(stool=>placeModel('B08568HG2X',stool.x,stool.z-.0,Math.PI))
}
function barSeats(x,z0){return BAR_STOOLS.map(dx=>({x:x+dx,z:z0+1.85,face:Math.PI}))}
const z0Of=(cz,D)=>cz-D/2
function rug(parent,x,z,w,d,edge,fill){
  const under=new THREE.Mesh(new THREE.PlaneGeometry(w,d),soft(edge));under.rotation.x=-Math.PI/2;under.position.set(x,.03,z);under.receiveShadow=true;parent.add(under)
  const top=new THREE.Mesh(new THREE.PlaneGeometry(w-.3,d-.3),soft(fill));top.rotation.x=-Math.PI/2;top.position.set(x,.034,z);top.receiveShadow=true;parent.add(top)
}
let people=[], selected=null, actors=[], tags=[], view={az:home.az,el:home.el,dist:30,zoom:0,center:new THREE.Vector3()}
function leadOf(p,byId){let l=p;const seen=new Set([p.id]);while(l.startedBy&&byId[l.startedBy]&&!seen.has(l.startedBy)){seen.add(l.startedBy);l=byId[l.startedBy]}return l}
function teamsIn(list){return teamsOf(list.filter(p=>!p.isAssistant))}
const busy=p=>p.isRunning||p.isFinished||Boolean(p.request)||Boolean(p.meetingWith&&p.meetingWith.length)
const WALL_HEIGHT=10
const PENDANT_Y=5.2
const AISLE_GAP=3.2
const OFFICE_GAP=.9
const TABLE_TOP=1.055
const COUNTER_TOP=1.06
const BAR_LENGTH=3.7
const BAR_MIDDLE=-.9
const BAR_STOOLS=[-2.1,-1.3,-.5,.3]
const BAR_SEAT_Y=.2
const BREW_SECONDS=7
const MIN_HOME_DIST=6
const HOME_PULL_BACK=2
// Places the couches and table on the rug, a little clear of the coffee counter.
const LOUNGE_MAIN_X=.41
const LOUNGE_MAIN_Z=.1
const LOUNGE_SIDE_ACROSS=-3
const LOUNGE_SIDE_FORWARD=1.15
// Every team gets its own space, so teams read apart without closing up the floor.
function planSpaces(){
  const teams=teamsIn(people),groups=teams.filter(t=>t.members.length>1||busy(t.lead)),idle=teams.filter(t=>!groups.includes(t)).map(t=>t.lead)
  const spaces=groups.sort((a,b)=>a.lead.project.localeCompare(b.lead.project)).map(t=>({kind:'team',team:t,W:Math.max(6.4,Math.ceil(t.members.length/2)*2.5+1.6),D:7.4}))
  spaces.push({kind:'meeting',W:8.4,D:7})
  const onBreak=people.filter(p=>p.isOnBreak).length
  if(idle.length||onBreak)spaces.push({kind:'lounge',people:idle,W:Math.max(9,(idle.length+onBreak)*2.3+3.6),D:7.8,breaks:onBreak})
  spaces.push({kind:'office',W:7.4,D:7})
  return spaces
}
// Add ?perf to the address to read frame costs from window.__office in the console.
const PERF=new URLSearchParams(location.search).has('perf'),perf={drawMs:0,gpuMs:0,frameMs:0,buildMs:0,last:0}
function notePerf(drawStart,t){
  const cpu=performance.now()-drawStart
  const gpuStart=performance.now();renderer.getContext().finish();const gpu=performance.now()-gpuStart
  perf.drawMs=perf.drawMs*.9+cpu*.1;perf.gpuMs=perf.gpuMs*.9+gpu*.1
  if(perf.last)perf.frameMs=perf.frameMs*.9+(performance.now()-perf.last)*.1
  perf.last=performance.now()
  window.__office={...perf,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,rebuild:build}
}
// The room is rebuilt on status changes, so the last one has to be freed.
function releaseRoom(room){
  room.traverse(o=>{
    if(o.isSkinnedMesh&&o.skeleton)o.skeleton.dispose()
    if(!o.material||o.isSkinnedMesh||o.userData.keep)return
    if(o.geometry)o.geometry.dispose()
    ;(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
      Object.values(m).forEach(value=>{if(value&&value.isTexture&&!value.keep)value.dispose()})
      m.dispose()
    })
  })
}
// Furniture never moves once placed, so it's drawn in one go per material.
function mergeFurniture(){
  world.updateMatrixWorld(true)
  const skip=new Set(floors),shared=new Set(Object.values(mats));if(woodTop)shared.add(woodTop);if(bookAtlas)shared.add(bookAtlas);if(pageMaterial)shared.add(pageMaterial)
  actors.forEach(a=>a.g.traverse(o=>skip.add(o)))
  const piles=new Map()
  world.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.isSkinnedMesh||skip.has(o)||Array.isArray(o.material)||!shared.has(o.material))return
    const key=`${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`
    if(!piles.has(key))piles.set(key,[])
    piles.get(key).push(o)
  })
  piles.forEach(meshes=>{
    if(meshes.length<2)return
    const parts=meshes.map(m=>{
      let g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone()
      g.applyMatrix4(m.matrixWorld)
      Object.keys(g.attributes).forEach(n=>{if(!['position','normal','uv'].includes(n))g.deleteAttribute(n)})
      if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2))
      if(!g.attributes.normal)g.computeVertexNormals()
      g.morphAttributes={}
      return g
    })
    const merged=BufferGeometryUtils.mergeBufferGeometries(parts)
    parts.forEach(g=>g.dispose())
    if(!merged)return
    const one=new THREE.Mesh(merged,meshes[0].material);one.castShadow=meshes[0].castShadow;one.receiveShadow=meshes[0].receiveShadow
    meshes.forEach(m=>{m.geometry.dispose();m.parent.remove(m)})
    world.add(one)
  })
}
// The lounge's Persian-style rug, painted here: border bands, a central medallion and mirrored flowers.
const RUGS={crimson:{field:'#8c2a25',border:'#1e3050',guard:'#a9833c',cream:'#e4d4ae',a:'#2f6f73',b:'#d27f5c',c:'#c79c3d'}}
const rugTextures=new Map()
function rugTexture(W,D,name){
  const key=`${name}|${W}|${D}`
  if(rugTextures.has(key))return rugTextures.get(key)
  const p=RUGS[name],scale=1536/Math.max(W,D),t=paintTex(Math.round(W*scale),Math.round(D*scale),(g,w,h)=>{
    let r=nameHash(name)%233280;const rand=()=>(r=(r*9301+49297)%233280)/233280
    const u=Math.min(w,h),cx=w/2,cy=h/2,guard=u*.016,main=u*.06
    const frame=(inset,c)=>{g.fillStyle=c;g.fillRect(inset,inset,w-inset*2,h-inset*2)}
    const diamond=(x,y,a,b,c)=>{g.fillStyle=c;g.beginPath();g.moveTo(x,y-b);g.lineTo(x+a,y);g.lineTo(x,y+b);g.lineTo(x-a,y);g.closePath();g.fill()}
    const rosette=(x,y,R,c1,c2,c3)=>{
      g.fillStyle=c1;for(let i=0;i<8;i++){const a=i*Math.PI/4;g.beginPath();g.ellipse(x+Math.cos(a)*R*.62,y+Math.sin(a)*R*.62,R*.38,R*.22,a,0,7);g.fill()}
      g.fillStyle=c2;g.beginPath();g.arc(x,y,R*.42,0,7);g.fill()
      g.fillStyle=c3;g.beginPath();g.arc(x,y,R*.2,0,7);g.fill()
    }
    const palmette=(x,y,R,dir,c1,c2)=>{
      for(let i=-2;i<=2;i++){const a=dir+i*.42;g.fillStyle=i%2?c2:c1;g.beginPath();g.ellipse(x+Math.cos(a)*R*.6,y+Math.sin(a)*R*.6,R*.48,R*.15,a,0,7);g.fill()}
      diamond(x,y,R*.2,R*.2,c2)
    }
    frame(0,p.guard);frame(guard*.35,p.border);frame(guard*.7,p.guard)
    // Small flowers along an edge band, placed outward from the middle so opposite sides match.
    const along=(inset,size,draw)=>{
      const step=size*2.3
      const side=(length,place)=>{const n=Math.floor((length/2-inset-size)/step);for(let i=-n;i<=n;i++)place(length/2+i*step,i)}
      side(w,(x,i)=>{draw(x,inset,i);draw(x,h-inset,i)})
      side(h,(y,i)=>{draw(inset,y,i);draw(w-inset,y,i)})
    }
    along(guard*.85,guard*.42,(x,y,i)=>diamond(x,y,guard*.34,guard*.34,i%2?p.a:p.c))
    frame(guard*1.5,p.border)
    const middle=guard*1.5+main/2
    along(middle,main*.42,(x,y,i)=>{
      if(i%2){diamond(x,y,main*.42,main*.34,p.c);diamond(x,y,main*.28,main*.22,p.border);rosette(x,y,main*.2,p.b,p.cream,p.a)}
      else rosette(x,y,main*.34,p.a,p.cream,p.b)
    })
    frame(guard*1.5+main,p.guard);frame(guard*1.5+main+guard*.25,p.cream);frame(guard*1.5+main+guard*.5,p.guard);frame(guard*1.5+main+guard*.75,p.field)
    const inner=guard*1.5+main+guard*.75,fieldW=w/2-inner,fieldH=h/2-inner
    // Quarter of the field, mirrored four ways.
    const cell=u*.075
    g.lineWidth=u*.0035;g.lineCap='round'
    for(let col=0;col*cell<fieldW-cell*.3;col++)for(let row=0;row*cell<fieldH-cell*.3;row++){
      const dx=(col+.5)*cell,dy=(row+.5)*cell,kind=(col*3+row*5)%4
      if(dx/(u*.22)+dy/(u*.15)<1&&w>=h||dx/(u*.15)+dy/(u*.22)<1&&w<h)continue
      ;[[1,1],[-1,1],[1,-1],[-1,-1]].forEach(([a,b])=>{
        const x=cx+a*dx,y=cy+b*dy,turn=Math.atan2(b*dy,a*dx)
        g.strokeStyle=p.a;g.beginPath();g.moveTo(x,y);g.lineTo(x+a*cell*.5,y);g.lineTo(x+a*cell*.5,y+b*cell*.5);g.stroke()
        if(kind===0)rosette(x,y,cell*.3,p.b,p.cream,p.field)
        else if(kind===1)palmette(x,y,cell*.36,turn,p.c,p.a)
        else if(kind===2){diamond(x,y,cell*.26,cell*.26,p.a);diamond(x,y,cell*.14,cell*.14,p.cream)}
        else palmette(x,y,cell*.32,turn+Math.PI/2,p.b,p.cream)
      })
    }
    // Corner spandrels and the central medallion.
    const spand=u*.13
    ;[[inner,inner,1,1],[w-inner,inner,-1,1],[inner,h-inner,1,-1],[w-inner,h-inner,-1,-1]].forEach(([x,y,a,b])=>{
      g.fillStyle=p.border;g.beginPath();g.moveTo(x,y);g.lineTo(x+a*spand,y);g.lineTo(x,y+b*spand);g.closePath();g.fill()
      rosette(x+a*spand*.3,y+b*spand*.3,spand*.14,p.c,p.cream,p.a)
    })
    const horizontal=w>=h,mx=u*(horizontal?.22:.15),my=u*(horizontal?.15:.22)
    diamond(cx,cy,mx+u*.008,my+u*.008,p.cream);diamond(cx,cy,mx,my,p.border);diamond(cx,cy,mx*.62,my*.62,p.a);diamond(cx,cy,mx*.46,my*.46,p.field)
    rosette(cx,cy,u*.05,p.c,p.cream,p.b)
    ;[-1,1].forEach(side=>{
      rosette(cx+(horizontal?side*mx*.78:0),cy+(horizontal?0:side*my*.78),u*.022,p.b,p.cream,p.a)
      palmette(cx+(horizontal?side*(mx+u*.035):0),cy+(horizontal?0:side*(my+u*.035)),u*.035,horizontal?(side>0?0:Math.PI):(side>0?Math.PI/2:-Math.PI/2),p.c,p.cream)
    })
    // Hand-dyed wool: uneven bands of colour and a fine woven grain.
    for(let y=0;y<h;y+=4+rand()*14){const b=4+rand()*14;g.fillStyle=`rgba(${rand()<.5?'255,235,210':'20,10,5'},${rand()*.05})`;g.fillRect(0,y,w,b)}
    for(let i=0;i<w*h/50;i++){g.fillStyle=`rgba(${rand()<.5?'255,245,225':'15,8,4'},${.03+rand()*.08})`;g.fillRect(rand()*w,rand()*h,1.5,1.5)}
  })
  t.keep=true;t.anisotropy=8
  rugTextures.set(key,t)
  return t
}
// The real clock drives everything. Add ?hour=21 to the address to preview another time.
const lit={lights:[],sky:[],ceiling:null,sunPatch:null,strip:new THREE.MeshBasicMaterial({color:0xfffbee}),bulb:new THREE.MeshBasicMaterial({color:0xffe6bd}),pool:new THREE.MeshBasicMaterial({map:paintTex(128,128,(g,w)=>{const r=g.createRadialGradient(w/2,w/2,1,w/2,w/2,w/2);r.addColorStop(0,'rgba(255,214,160,.8)');r.addColorStop(1,'rgba(255,214,160,0)');g.fillStyle=r;g.fillRect(0,0,w,w)}),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:0})}
const previewHour=parseFloat(new URLSearchParams(location.search).get('hour'))
const smooth=(from,to,x)=>{const t=Math.min(1,Math.max(0,(x-from)/(to-from)));return t*t*(3-2*t)}
function applyTimeOfDay(){
  const now=new Date(),hour=Number.isNaN(previewHour)?now.getHours()+now.getMinutes()/60:previewHour
  const day=smooth(5.5,8,hour)*(1-smooth(17,19.5,hour)),night=1-day,dusk=Math.max(0,1-Math.abs(hour-6.6)/1.3,1-Math.abs(hour-18.3)/1.3)
  lit.sky.forEach(({m,type})=>{m.opacity=type==='night'?night:dusk*.8})
  hemi.intensity=.28+.36*day;hemi.color.setHex(0xffd9b0).lerp(HEMI_DAY,day)
  sun.intensity=.68*day;sun.color.setHex(0xff9d5c).lerp(SUN_DAY,1-dusk)
  // Morning from the left-hand windows, high at midday, and low through the back ones by evening.
  const arc=Math.PI*Math.min(1,Math.max(0,(hour-6)/13)),R=Math.max(floorSize.W||30,floorSize.D||30)
  sun.position.set(-Math.cos(arc)*R,Math.max(.25,Math.sin(arc))*R*.95,-R*.55)
  sun.shadow.needsUpdate=true
  lit.lights.forEach(light=>{light.intensity=.12+1.18*night})
  lit.bulb.color.setHex(0x8d7f6a).lerp(BULB_ON,Math.max(.3,night))
  lit.pool.opacity=.04+.44*night
  if(lit.sunPatch)lit.sunPatch.opacity=.11*day
  if(lit.ceiling)lit.ceiling.color.setScalar(.42+.58*day)
  lit.strip.color.setScalar(.5+.5*Math.max(day,night*.75))
  scene.background.setHex(0x0d1420).lerp(SKY_DAY,day)
}
function build(){
  const buildStart=performance.now()
  walksInProgress=new Map(actors.filter(a=>a.visit&&(a.route||a.brewUntil)).map(a=>[a.p.id,{key:a.visit.key,position:a.g.position.clone(),turn:a.g.rotation.y,route:a.route,brewAt:a.visit.brewAt,brewUntil:a.brewUntil,hasMug:a.holdsMug}]))
  scene.remove(world); releaseRoom(world); world=new THREE.Group(); scene.add(world); actors=[]; tagsEl.innerHTML=''; tags=[]; spots={}; floors=[]; boards=[]
  scene.remove(lighting);lighting=new THREE.Group();scene.add(lighting);lit.lights=[];lit.sky=[]
  const spaces=planSpaces(),perRow=Math.max(2,Math.ceil(Math.sqrt(spaces.length)))
  const rows=[];spaces.forEach((z,i)=>{const r=Math.floor(i/perRow);(rows[r]=rows[r]||[]).push(z)})
  const rowW=row=>row.reduce((n,z,i)=>n+z.W+(i?(z.kind==='office'?OFFICE_GAP:AISLE_GAP):0),0), rowD=row=>Math.max(...row.map(z=>z.D))
  const W=Math.max(16,...rows.map(rowW))+3, D=Math.max(12,rows.reduce((n,r)=>n+rowD(r),0)+(rows.length-1)*AISLE_GAP)+3.2
  visitors=0
  // The room runs on past the camera, so there's no edge to see from inside it.
  const REACH=70,H=WALL_HEIGHT,back=-D/2,left=-W/2,longX=W+REACH,longZ=D+REACH,midX=REACH/2,midZ=REACH/2
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(longX,longZ),new THREE.MeshLambertMaterial({map:FLOOR_T(Math.ceil(Math.max(longX,longZ)/3))})); floor.rotation.x=-Math.PI/2; floor.position.set(midX,0,midZ); floor.receiveShadow=true; world.add(floor)
  floorSize={W,D}
  const glass=(width,seed,rx,place)=>{
    const layer=(map,type)=>{const m=new THREE.MeshBasicMaterial({map,transparent:Boolean(type),depthWrite:!type});const pane=new THREE.Mesh(new THREE.PlaneGeometry(width,H),m);place(pane);if(type)lit.sky.push({m,type});return pane}
    world.add(layer(skyline(seed,rx)))
    const night=layer(skyline(seed,rx,true),'night'),dusk=layer(duskSky(rx),'dusk')
    night.renderOrder=1;dusk.renderOrder=2;world.add(night,dusk)
  }
  glass(longX,137,longX/27,m=>m.position.set(midX,H/2,back-.08))
  glass(longZ,911,longZ/27,m=>{m.rotation.y=Math.PI/2;m.position.set(left-.08,H/2,midZ)})
  // A low dark sill and slim bronze frames, with concrete columns at every third bay.
  const FRAME=0x2b2a2a,COLUMN=0xcfccc4
  box(world,longX,.46,.2,0x3a3836,midX,.23,back);box(world,.2,.46,longZ,0x3a3836,left,.23,midZ)
  box(world,longX,.05,.26,FRAME,midX,.48,back);box(world,.26,.05,longZ,FRAME,left,.48,midZ)
  for(let x=left,i=0;x<=left+longX;x+=3.6,i++){if(i%3===0){box(world,.62,H,.5,COLUMN,x,H/2,back);box(world,.66,.3,.54,0x8f8c86,x,.15,back)}else box(world,.05,H,.09,FRAME,x,H/2,back)}
  for(let z=back,i=0;z<=back+longZ;z+=3.6,i++){if(i%3===0){box(world,.5,H,.62,COLUMN,left,H/2,z);box(world,.54,.3,.66,0x8f8c86,left,.15,z)}else box(world,.09,H,.05,FRAME,left,H/2,z)}
  ;[.36,.72].forEach(f=>{box(world,longX,.04,.08,FRAME,midX,H*f,back);box(world,.08,.04,longZ,FRAME,left,H*f,midZ)})
  box(world,longX,.5,.2,0xd8d5ce,midX,H-.25,back);box(world,.2,.5,longZ,0xd8d5ce,left,H-.25,midZ)
  // Faces down only, so it disappears when the camera is pulled up through it.
  const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(longX,longZ),new THREE.MeshBasicMaterial({map:paintTex(256,256,(g,w)=>{
    g.fillStyle='#ece9e2';g.fillRect(0,0,w,w)
    for(let x=0;x<w;x+=32){g.fillStyle='#c9c4b8';g.fillRect(x,0,4,w);g.fillStyle='#f6f4ee';g.fillRect(x+4,0,3,w)}
    g.fillStyle='#b4afa3';g.fillRect(0,0,w,5)
  },longX/3.6,longZ/3.6)}))
  ceiling.rotation.x=Math.PI/2;ceiling.position.set(midX,H,midZ);world.add(ceiling);lit.ceiling=ceiling.material
  // Long, slim lights in rows, each in a dark channel.
  const lamp=lit.strip,channel=new THREE.MeshBasicMaterial({color:0x8f8c86})
  for(let z=back+3.6;z<back+longZ;z+=7.2)for(let x=left+2.5;x<left+longX;x+=9){
    const trim=new THREE.Mesh(new THREE.PlaneGeometry(6.2,.3),channel);trim.rotation.x=Math.PI/2;trim.position.set(x,H-.015,z);world.add(trim)
    const light=new THREE.Mesh(new THREE.PlaneGeometry(6,.16),lamp);light.rotation.x=Math.PI/2;light.position.set(x,H-.025,z);world.add(light)
  }
  // Sun falling through the back windows.
  const sunMat=new THREE.MeshBasicMaterial({color:0xfff0d0,transparent:true,opacity:.1,depthWrite:false});lit.sunPatch=sunMat
  for(let i=0,n=Math.max(3,Math.round(W/5));i<n;i++){const patch=new THREE.Mesh(new THREE.PlaneGeometry(W/n*.62,D*.82),sunMat);patch.rotation.x=-Math.PI/2;patch.position.set(left+(i+.5)*W/n+1,.012,back+D*.43);world.add(patch)}
  plant(world,left+.8,back+.8,1.25);plant(world,-left-.9,back+.8,1.05);plant(world,left+.8,-back-.9,1)
  const reach=Math.max(W,D)*.85
  Object.assign(sun.shadow.camera,{left:-reach,right:reach,top:reach,bottom:-reach,near:.5,far:Math.max(W,D)*3});sun.shadow.camera.updateProjectionMatrix()
  let z0=back+2
  meetingSeats=[];officeSpots=[];breakSeats=[];breakers=0
  rows.forEach(row=>{
    let x0=left+1.5
    row.forEach((space,i)=>{drawSpace(space,x0,z0);x0+=space.W+(row[i+1]?.kind==='office'?OFFICE_GAP:AISLE_GAP)})
    z0+=rowD(row)+AISLE_GAP
  })
  // Each area's floor is woven carpet in a quieter shade of its colour.
  floors.forEach(area=>{
    const size=area.geometry.parameters
    // Rooms without a rug are bare wood, but stay clickable.
    area.material=area.rug?new THREE.MeshLambertMaterial({color:0xcfc6b8,map:rugTexture(size.width,size.height,area.rug)}):new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});area.receiveShadow=true
  })
  actors.filter(a=>a.walkPending).forEach(startWalk)
  mergeFurniture()
  applyTimeOfDay()
  fitDirty=true
  perf.buildMs=performance.now()-buildStart
}
let fitDirty=true,floorSize={W:20,D:20}
// The closest camera distance that still shows the whole floor and back walls.
function fitCamera(){
  const first=!view.fitted
  fitDirty=false;view.fitted=true
  const {W,D}=floorSize,ceilingRoom=(WALL_HEIGHT-1.2-home.center.y)/Math.sin(home.el)
  home.dist=Math.min(Math.max(12,Math.max(W,D)*.43),ceilingRoom)
  home.center.set(W*.1,home.center.y,D*.14)
  // Just behind the near edge of the lounge rug, so Mia's desk comes into view on the right.
  const lounge=spots.lounge
  if(lounge)home.dist=Math.max(MIN_HOME_DIST,(lounge.z+lounge.D/2-home.center.z)/(Math.cos(home.az)*Math.cos(home.el))+HOME_PULL_BACK)
  if(first){view.dist=home.dist;view.center.copy(home.center)}
}
// Ribbed black rubber under the desks and chairs.
let rubberTexture=null
function rubberMat(parent,x,z,w,d){
  if(!rubberTexture){
    rubberTexture=paintTex(128,128,(g,tw,th)=>{g.fillStyle='#fff';g.fillRect(0,0,tw,th);g.fillStyle='rgba(0,0,0,.28)';for(let y=0;y<th;y+=16)g.fillRect(0,y,tw,5)},1,1)
    rubberTexture.keep=true
  }
  const m=box(parent,w,.03,d,new THREE.MeshLambertMaterial({color:0x2b2c2e,map:rubberTexture}),x,.015,z)
  const uv=m.geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w*1.6,uv.getY(i)*d*1.6)
  return m
}
function flat(w,d,c,x,y,z){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(c));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);m.receiveShadow=true;world.add(m);return m}
const WALK_SPEED=1.7, arrived=new Map()
let walksInProgress=new Map(),coffeeSpot=null,meetingSeats=[],officeSpots=[],breakSeats=[],visitors=0,breakers=0
const faceToward=(a,x,z)=>{a.g.rotation.y=Math.atan2(x-a.g.position.x,z-a.g.position.z)}
function startWalk(a){
  a.walkPending=false
  const p=a.p,toOffice=Boolean(p.request),toMeeting=!toOffice&&Boolean(p.meetingWith&&p.meetingWith.length)
  const target=toOffice?officeSpots[visitors++%Math.max(1,officeSpots.length)]:toMeeting?meetingSeats[visitors++%Math.max(1,meetingSeats.length)]:breakSeats[breakers++]
  if(!target)return
  const key=toOffice?`office:${p.request.id}`:toMeeting?`meeting:${[p.id,...p.meetingWith].sort().join()}`:`break:${p.jobs?.[0]}`
  const arrive=toOffice?'wave':'sit'
  a.visit={target,key,arrive,mug:!toOffice&&!toMeeting}
  // The room can rebuild mid-walk, and someone should carry on rather than start again from their desk.
  const walking=walksInProgress.get(p.id)
  if(walking?.key===key){
    a.g.position.copy(walking.position);a.g.rotation.y=walking.turn;a.route=walking.route;a.visit.brewAt=walking.brewAt;a.brewUntil=walking.brewUntil;a.holdsMug=walking.hasMug
    a.pose=walking.route?'walk':'stand'
    return
  }
  if(arrived.get(p.id)===key){a.g.position.set(target.x,target.y||0,target.z);a.g.rotation.y=target.face;a.pose=arrive;a.holdsMug=a.visit.mug;return}
  a.pose='walk'
  // Anyone on a break makes themselves a coffee before sitting down.
  if(a.visit.mug&&coffeeSpot){
    a.visit.brewAt=coffeeSpot
    a.route=[new THREE.Vector3(a.g.position.x,0,a.front),new THREE.Vector3(coffeeSpot.x,0,a.front),new THREE.Vector3(coffeeSpot.x,0,coffeeSpot.z)]
    return
  }
  a.route=[new THREE.Vector3(a.g.position.x,0,a.front),new THREE.Vector3(target.x,0,a.front),new THREE.Vector3(target.x,target.y||0,target.z)]
}
function giveMug(a){
  a.holdsMug=true
  const hand=a.life?.arms?.[1]?.hand
  if(!hand||a.mug)return
  const mug=new THREE.Mesh(new THREE.CylinderGeometry(4.2,3.6,9,12),mat(WHITE));mug.position.set(9,2,5);hand.add(mug);a.mug=mug
}
function walk(a,dt){
  const target=a.route[0],gap=target.clone().sub(a.g.position);gap.y=0
  const step=WALK_SPEED*dt
  if(gap.length()<=step){
    a.g.position.copy(target);a.route.shift()
    if(!a.route.length&&a.visit.brewAt){a.route=null;a.g.rotation.y=a.visit.brewAt.face;a.visit.brewAt=null;setPose(a,'stand');a.brewUntil=clock.getElapsedTime()+BREW_SECONDS;return}
    if(!a.route.length){a.route=null;arrived.set(a.p.id,a.visit.key);a.g.rotation.y=a.visit.target.face;setPose(a,a.visit.arrive);if(a.visit.mug)giveMug(a)}
    return
  }
  a.g.rotation.y=Math.atan2(gap.x,gap.z);a.g.position.add(gap.setLength(step))
}
const wantsToWalk=p=>Boolean(p.request&&!p.isOnScreen)||Boolean(p.meetingWith&&p.meetingWith.length)||Boolean(p.isOnBreak)
function seat(p,x,z,rotation,front,pose,y=0){
  const a=character(p);a.pose=pose;a.front=front;a.g.position.set(x,y,z);a.g.rotation.y=rotation;world.add(a.g);actors.push(a)
  if(wantsToWalk(p))a.walkPending=true
  return a
}
const glassMat=new THREE.MeshLambertMaterial({color:0xcfe9f5,transparent:true,opacity:.28,depthWrite:false})
function glassWall(x,z,length,alongX,height=2.5){
  const pane=new THREE.Mesh(new THREE.BoxGeometry(alongX?length:.05,height,alongX?.05:length),glassMat);pane.position.set(x,height/2,z);world.add(pane)
  box(world,alongX?length:.07,.07,alongX?.07:length,CHARCOAL,x,height,z)
  const count=Math.max(1,Math.round(length/2.4))
  for(let i=0;i<=count;i++){const t=-length/2+i*length/count;box(world,.06,height,.06,CHARCOAL,alongX?x+t:x,height/2,alongX?z:z+t)}
}
// The Agent Office app itself, running on a display at the end of the team's table.
let boards=[]
const UI={page:'#0b0e13',soft:'#141922',hover:'#2a303a',line:'#222833',text:'#ffffff',muted:'#a6afbb',faint:'#6f7884',accent:'#818cf8',working:'#7cb8ff',workingWash:'#1c3350',waiting:'#f2bb62',waitingWash:'#40301a',asks:'#ff8a80',asksWash:'#4a2124',meeting:'#c4a6f5',meetingWash:'#352a52',idleWash:'#262c35'}
function shortAge(iso){const then=Date.parse(iso||'');if(Number.isNaN(then))return'';const m=Math.max(0,Math.round((Date.now()-then)/6e4));return m<60?`${m}m`:m<1440?`${Math.round(m/60)}h`:`${Math.round(m/1440)}d`}
function statusOfRow(p){
  if(p.request)return{label:'Asking for you',fg:UI.asks,bg:UI.asksWash,rank:0}
  if(p.isCompacting)return{label:'Compacting',fg:UI.waiting,bg:UI.waitingWash,rank:1}
  if(p.meetingWith?.length)return{label:'In a meeting',fg:UI.meeting,bg:UI.meetingWash,rank:1}
  if(p.isWaiting)return{label:'Waiting on job',fg:UI.waiting,bg:UI.waitingWash,rank:2}
  if(p.isFinished)return{label:'Finished',fg:UI.waiting,bg:UI.waitingWash,rank:3}
  if(p.isRunning)return{label:'Working',fg:UI.working,bg:UI.workingWash,rank:1}
  return{label:'Idle',fg:UI.muted,bg:UI.idleWash,rank:4}
}
function roundRect(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
function drawBoard(board){
  const {g,team,faces,texture,live}=board,W=960,H=480,lead=team.lead
  const members=team.members.map(m=>people.find(x=>x.id===m.id)||m)
  const fit=(text,max)=>{let t=String(text||'');while(g.measureText(t).width>max&&t.length>1)t=t.slice(0,-2)+'…';return t}
  const back=g.createLinearGradient(0,0,0,H);back.addColorStop(0,'#10141b');back.addColorStop(1,'#0a0d12');g.fillStyle=back;g.fillRect(0,0,W,H)
  // The team's own header, with the time and task progress on the right.
  const isTeam=team.members.length>1
  g.textBaseline='middle';g.textAlign='left';g.fillStyle=UI.text;g.font='600 28px '+boardFont;g.fillText(fit(team.name,520),24,36)
  g.fillStyle=UI.muted;g.font='15px '+boardFont;g.fillText(fit(team.isIndependent?lead.title:`Led by ${lead.name} · ${lead.title}`,600),24,66)
  const updated=new Date()
  g.textAlign='right';g.fillStyle=UI.muted;g.font='13px '+boardFont;g.fillText(`Live ${updated.getHours()}:${String(updated.getMinutes()).padStart(2,'0')}`,W-24,32)
  g.fillStyle=UI.working;g.beginPath();g.arc(W-24-g.measureText(`Live ${updated.getHours()}:${String(updated.getMinutes()).padStart(2,'0')}`).width-11,32,4,0,7);g.fill()
  const progress=live(lead).progress
  if(progress&&progress[1]){
    const [done,total]=progress
    g.fillStyle=UI.muted;g.font='13px '+boardFont;g.fillText(`${done} of ${total} tasks`,W-158,62)
    g.fillStyle=UI.hover;roundRect(g,W-146,58,122,8,4);g.fill();if(done){g.fillStyle=UI.accent;roundRect(g,W-146,58,Math.max(8,122*done/total),8,4);g.fill()}
  }
  g.textAlign='left'
  // Section label.
  const margin=24,right=W-24,nameX=margin+50,pillX=268,workX=420,ageX=right-16
  g.fillStyle=UI.muted;g.font='500 13px '+boardFont;g.fillText('Name',nameX,106);g.fillText('Status',pillX,106);g.fillText('Working on',workX,106)
  g.fillStyle=UI.line;g.fillRect(margin,122,right-margin,1)
  const rows=[...members].sort((a,b)=>statusOfRow(a).rank-statusOfRow(b).rank||(b.lastActivityAt||'').localeCompare(a.lastActivityAt||'')).slice(0,6)
  rows.forEach((p,i)=>{
    const top=123+i*54,y=top+27,status=statusOfRow(p),isIdle=status.rank===4
    if(p.id===lead.id){g.fillStyle=UI.soft;g.fillRect(margin,top+1,right-margin,52)}
    const face=faces.get(p.id)
    g.save();g.beginPath();g.arc(margin+22,y,17,0,7);g.clip();g.fillStyle=UI.hover;g.fillRect(margin+5,y-17,34,34);if(face)g.drawImage(face,margin+5,y-17,34,34);g.restore()
    g.fillStyle=isIdle?UI.muted:UI.text;g.font='600 16px '+boardFont;g.fillText(fit(p.name,pillX-nameX-14),nameX,p.id===lead.id?y-8:y)
    if(p.id===lead.id){g.fillStyle=UI.faint;g.font='12px '+boardFont;g.fillText('Lead',nameX,y+11)}
    g.font='500 13px '+boardFont;const pillW=g.measureText(status.label).width+22
    g.fillStyle=status.bg;roundRect(g,pillX,y-12,pillW,24,12);g.fill();g.fillStyle=status.fg;g.fillText(status.label,pillX+11,y+.5)
    const doing=p.request?.message||p.jobs?.[0]||(p.isRunning?p.step||p.recent?.[p.recent.length-1]:'')||p.label||p.title
    const timing=p.isWaiting&&p.jobStartedAt?`${Math.max(1,Math.round((Date.now()/1000-p.jobStartedAt)/60))}m`:shortAge(p.lastActivityAt)
    g.fillStyle=isIdle?UI.muted:UI.text;g.font='14px '+boardFont;g.fillText(fit(doing,right-workX-76),workX,y)
    g.textAlign='right';g.fillStyle=UI.faint;g.font='13px '+boardFont;g.fillText(timing,ageX,y);g.textAlign='left'
    if(i<rows.length-1){g.fillStyle=UI.line;g.fillRect(margin,top+53,right-margin,1)}
  })
  if(members.length>6){g.fillStyle=UI.muted;g.font='13px '+boardFont;g.textAlign='right';g.fillText(`+${members.length-6} more`,right,H-10);g.textAlign='left'}
  // A faint sheen, since this is glass in a sunny room.
  const sheen=g.createLinearGradient(0,0,W,H);sheen.addColorStop(0,'rgba(255,255,255,0)');sheen.addColorStop(.42,'rgba(170,205,240,.025)');sheen.addColorStop(.5,'rgba(170,205,240,.055)');sheen.addColorStop(.58,'rgba(170,205,240,.015)');sheen.addColorStop(1,'rgba(255,255,255,0)')
  g.fillStyle=sheen;g.fillRect(0,0,W,H)
  texture.needsUpdate=true
}
function glassReflection(){
  const texture=paintTex(1024,512,(g,w,h)=>{
    g.fillStyle='#000';g.fillRect(0,0,w,h)
    // Bright panes of the far windows, slanted across the glass.
    g.save();g.filter='blur(26px)';g.transform(1,0,-.28,1,0,0)
    ;[[150,120],[340,60],[470,150],[760,90],[930,130]].forEach(([x,pane])=>{const light=g.createLinearGradient(0,0,0,h);light.addColorStop(0,'rgba(120,140,165,.13)');light.addColorStop(.6,'rgba(75,92,115,.05)');light.addColorStop(1,'rgba(40,50,65,0)');g.fillStyle=light;g.fillRect(x,0,pane,h)})
    g.restore()
    const top=g.createLinearGradient(0,0,0,h*.32);top.addColorStop(0,'rgba(165,180,200,.1)');top.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=top;g.fillRect(0,0,w,h*.32)
  })
  texture.wrapS=THREE.RepeatWrapping
  return texture
}
function projector(team,x0,cz){
  const width=5.6,height=2.8,y=2.75,x=x0+.42
  // A slim display on a rolling stand.
  const body=new THREE.Mesh(roundedPanel(width+.09,height+.09,.055,.045),new THREE.MeshPhongMaterial({color:0x08090b,specular:0x6a7078,shininess:90}));body.rotation.y=Math.PI/2;body.position.set(x,y,cz);body.castShadow=true;world.add(body)
  box(world,.09,y-.3,.16,0x3a3e46,x-.06,(y-.3)/2+.05,cz)
  box(world,.09,.05,2.2,0x3a3e46,x-.06,.11,cz)
  ;[-1,1].forEach(side=>{box(world,1,.05,.09,0x3a3e46,x-.06,.11,cz+side*1.05);[-.42,.42].forEach(dx=>{const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.04,10),mat(0x17181b));wheel.rotation.x=Math.PI/2;wheel.position.set(x-.06+dx,.05,cz+side*1.05);world.add(wheel)})})
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=960
  const texture=crispTexture(canvas)
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture}));panel.rotation.y=Math.PI/2;panel.position.set(x+.031,y,cz);world.add(panel)
  // Light from the screen, falling on the floor in front of it.
  const glowMap=paintTex(128,128,(g,w)=>{const r=g.createRadialGradient(w/2,w/2,2,w/2,w/2,w/2);r.addColorStop(0,'rgba(150,185,255,.28)');r.addColorStop(1,'rgba(150,185,255,0)');g.fillStyle=r;g.fillRect(0,0,w,w)})
  const spill=new THREE.Mesh(new THREE.PlaneGeometry(3,6.2),new THREE.MeshBasicMaterial({map:glowMap,transparent:true,depthWrite:false}));spill.rotation.x=-Math.PI/2;spill.position.set(x+1.2,.035,cz);world.add(spill)
  // A glass front that reflects the windows and shifts as the camera moves.
  const reflection=glassReflection();
  const glassFront=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:reflection,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));glassFront.rotation.y=Math.PI/2;glassFront.position.set(x+.036,y,cz);world.add(glassFront)
  const g=canvas.getContext('2d');g.scale(2,2)
  const board={g,reflection,team,faces:new Map(),texture,live:m=>people.find(x=>x.id===m.id)||m,nextDraw:0}
  boards.push(board)
  team.members.slice(0,12).forEach(m=>portrait(m).then(url=>{const image=new Image();image.onload=()=>{board.faces.set(m.id,image);drawBoard(board)};image.src=url},()=>{}))
  drawBoard(board)
}
// What an agent is on, from its task list or latest step. Never its private reasoning.
function drawThought(el,p,showWords,detailed){
  const plan=p.plan||[],line=p.step||p.recent?.[p.recent.length-1]||''
  const key=JSON.stringify([showWords,detailed,line,detailed?plan:0,detailed&&!plan.length?p.recent:0])
  if(el.dataset.key===key)return
  el.dataset.key=key
  el.textContent=''
  el.classList.toggle('open',showWords&&Boolean(line||plan.length))
  el.classList.toggle('detailed',detailed&&Boolean(plan.length||p.recent?.length))
  if(!showWords||(!line&&!plan.length)){const dots=document.createElement('span');dots.className='thought-dots';dots.textContent='•••';el.appendChild(dots);return}
  if(detailed&&plan.length){plan.forEach(item=>{const row=document.createElement('div');row.className=`thought-task ${item.status}`;const mark=document.createElement('i');row.appendChild(mark);row.appendChild(document.createTextNode(item.content));el.appendChild(row)});return}
  if(detailed&&p.recent?.length){p.recent.forEach((step,i)=>{const row=document.createElement('div');row.className='thought-step'+(i===p.recent.length-1?' now':'');row.textContent=step;el.appendChild(row)});return}
  el.textContent=line
}
function drawSpace(space,x0,z0){
  const {W,D,kind}=space,cx=x0+W/2,cz=z0+D/2,front=z0+D+AISLE_GAP/2,key=kind==='team'?space.team.lead.id:kind
  spots[key]={x:cx,z:cz,W,D}
  drawingKey=key
  const label=(name)=>addZoneTag(name,cx,z0-.2,key)
  if(kind==='team'){
    pendant(cx-W*.22,cz);pendant(cx+W*.22,cz,false)
    const {team}=space,uniform=new THREE.Color(uniformOf(team.lead.project)),isTeam=team.members.length>1
    floors.push(Object.assign(flat(W,D,WHITE,cx,.02,cz),{spaceKey:key}))
    box(world,W,1.3,.09,WHITE,cx,.65,z0);box(world,.09,1.3,D,WHITE,x0,.65,cz)
    box(world,W,.09,.13,uniform.getHex(),cx,1.33,z0)
    if(isTeam){projector(team,x0,cz);spots[key].hasBoard=true}
    label(team.isIndependent?team.name:`${team.name} · Led by ${team.lead.name}`)
    const columns=Math.ceil(team.members.length/2),isShared=team.members.length>1
    rubberMat(world,cx,cz,columns*2.5+1.1,isShared?4.1:3)
    tableTop(world,cx,cz,columns*2.5+.15,isShared?2.24:1.16)
    if(isShared)box(world,columns*2.5,.09,.03,0xd9d6cf,cx,1.1,cz)
    team.members.forEach((p,i)=>{
      const col=Math.floor(i/2),row=i%2===0?-1:1,sx=cx-(columns-1)*1.25+col*2.5,deskZ=isShared?cz+row*.58:cz,seatZ=isShared?cz+row*1.44:cz+row*.88
      deskTopic=topicOf(`${p.project} ${p.title||''}`)
      const screen=workstation(world,sx,deskZ,isShared?row:row,p.isRunning,p.id)
      if(REAL_FURNITURE)placeModel(OFFICE_CHAIR,sx,seatZ,row===-1?0:Math.PI);else chair(world,sx,seatZ,row)
      const a=seat(p,sx,seatZ,row===-1?0:Math.PI,front,p.isFinished?'wave':p.isWaiting?'sit':p.isRunning||p.helpers?.length||p.talkingTo?'work':'sit')
      attachScreen(a,screen);a.keyboard=new THREE.Vector3(sx,1.09,deskZ+row*KEYBOARD_OFFSET);addTag(a,isTeam&&p.id===team.lead.id);dress(a)
    })
  }
  if(kind==='lounge'){
    floors.push(Object.assign(flat(W,D,WHITE,cx,.02,cz),{spaceKey:key,rug:'crimson'}));label('Lounge')
    if(REAL_FURNITURE)realLounge(world,x0,cx,cz,W,D)
    else{rug(world,cx,cz+1.15,W-1.6,3.5,0x2d7f8c,0xe9dcc4);couch(world,cx,cz-.1,W-1.2);coffeeTable(world,cx,cz+1.9,Math.min(2.8,W*.36));armchair(world,x0+1.15,cz+2.15,1.15);if(W>9)armchair(world,x0+W-1.15,cz+2.15,-1.15);floorLamp(world,x0+.55,cz-.9)}
    const places=space.people.length+space.breaks,spotAt=i=>loungeSeat(x0,z0,cx,cz,W,i,places)
    space.people.forEach((p,i)=>{const spot=spotAt(i),a=seat(p,spot.x,spot.z,spot.face,front,spot.isStanding?'stand':'sit',spot.y??-.1);addTag(a,false);dress(a)})
    breakSeats=Array.from({length:space.breaks},(_,i)=>({y:-.1,...spotAt(space.people.length+i)}))
    pendant(cx-.14,cz+2.05);pendant(cx-2.6,cz+1.5,false)
    if(REAL_FURNITURE)kitchen(world,x0+W-1.5,z0)
    else{box(world,2.4,1.02,.75,WOOD,x0+W-1.5,.51,z0+.45);box(world,.42,.5,.38,CHARCOAL,x0+W-2.1,1.27,z0+.45);box(world,.26,.05,.2,SILVER,x0+W-2.1,1.08,z0+.58);coffee(world,x0+W-1.1,z0+.5,0);coffee(world,x0+W-.75,z0+.32,1)}
    if(!REAL_FURNITURE)plant(world,x0+W-.6,z0+D-.7,.9)
  }
  if(kind==='meeting'){
    pendant(cx,cz)
    floors.push(Object.assign(flat(W,D,WHITE,cx,.02,cz),{spaceKey:key}));label('Meeting room')
    glassWall(cx,z0,W,true);glassWall(x0,cz,D,false)
    const top=new THREE.Mesh(new THREE.CylinderGeometry(1,1,.1,40),mat(WOOD));top.scale.set(2.5,1,1.1);top.position.set(cx,1,cz);top.castShadow=top.receiveShadow=true;world.add(top)
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.16,.3,1,10),mat(CHARCOAL));stem.position.set(cx,.5,cz);world.add(stem)
    for(let i=0;i<8;i++){const side=i<4?-1:1,sx=cx-1.8+(i%4)*1.2,sz=cz+side*1.95;if(REAL_FURNITURE)placeModel(OFFICE_CHAIR,sx,sz,side===-1?0:Math.PI);else chair(world,sx,sz,side);meetingSeats.push({x:sx,z:sz,face:side===-1?0:Math.PI})}
    box(world,2.4,1.25,.05,WHITE,cx+1.2,1.75,z0+.08)
  }
  if(kind==='office'){
    pendant(cx-.2,cz+.3)
    deskTopic='general'
    floors.push(Object.assign(flat(W,D,WHITE,cx,.02,cz),{spaceKey:key}));label('Your office')
    glassWall(cx,z0,W,true);glassWall(x0,cz,D,false)
    rubberMat(world,cx,cz-.95,3.4,3.3)
    attachUsageScreen(desk(world,cx,cz-.5,1,true,'you'));if(REAL_FURNITURE)placeModel(OFFICE_CHAIR,cx,cz-1.7,0);else chair(world,cx,cz-1.7,-1)
    ;[.3,1.4,2.5].forEach(dx=>officeSpots.push({x:cx+dx,z:cz+2.6,face:Math.PI}))
    const assistant=people.find(p=>p.isAssistant)
    if(assistant){
      // Angled toward the office's usual view, with the monitor off to one side so it doesn't hide her.
      const hx=x0+1.7,hz=cz+1.05,turn=MIA_DESK_TURN,group=new THREE.Group();group.position.set(hx,0,hz);group.rotation.y=turn;world.add(group)
      const toWorld=(lx,lz)=>[hx+lx*Math.cos(turn)+lz*Math.sin(turn),hz-lx*Math.sin(turn)+lz*Math.cos(turn)]
      rubberMat(group,0,-.3,3,2.7)
      tableTop(group,0,0,2.1,1.1)
      const screen=workstation(group,-.68,0,-1,true,'front desk')
      const [sx,sz]=toWorld(.3,-.95)
      if(REAL_FURNITURE)placeModel(OFFICE_CHAIR,sx,sz,turn);else chair(group,.3,-.95,-1)
      const a=seat(assistant,sx,sz,turn,front,'sit')
      attachScreen(a,screen);addTag(a,false);dress(a)
    }
    plant(world,x0+W-.6,z0+.7,1.1)
    credenza(world,x0+1.5,z0+.3)
    bookcase(world,x0+.24,cz-1.3)
    directoryBoard(x0,cz-.9)
    floorLamp(world,x0+W-.55,z0+1.9)
    wallArt(world,cx+1.75,z0+.1)
  }
}
function addZoneTag(name,x,z,key){const el=document.createElement('div');el.className='zone-tag';el.textContent=name;el.onclick=()=>onSpace(key);tagsEl.appendChild(el);tags.push({el,a:{g:{position:new THREE.Vector3(x,-2.65,z)},p:{id:null}},key,isZone:true})}
function addTag(a,isLead){const el=document.createElement('div');el.className='tag'+(isLead?' lead':'');const name=document.createElement('span');name.textContent=a.p.name;if(a.p.label){const job=document.createElement('em');job.textContent=' · '+a.p.label;name.appendChild(job)}el.appendChild(name);const count=a.p.helpers?.length||0;if(count||a.p.talkingTo){const badge=document.createElement('b');badge.className='call-badge';badge.textContent=count?`${count} helper${count>1?'s':''}`:'On a call';el.appendChild(badge)}if(a.p.isWaiting){const badge=document.createElement('b');badge.className='call-badge waiting';el.appendChild(badge);el.waitBadge=badge}if(a.p.isActing&&!a.p.request&&!a.p.meetingWith?.length){const thought=document.createElement('div');thought.className='thought';el.prepend(thought);el.thought=thought}else if(busy(a.p)){const say=document.createElement('div');say.className='say'+(a.p.request?' asks':a.p.isFinished?' done':'');say.textContent=a.p.request?a.p.request.message:a.p.meetingWith&&a.p.meetingWith.length?'In a meeting':a.p.isFinished?'Finished: '+a.p.title:a.p.jobs?.length?`Job running: ${a.p.jobs[0]}`:a.p.title;el.prepend(say)}el.title=a.p.title;el.onclick=()=>onPick(a.p.id);tagsEl.appendChild(el);tags.push({el,a,key:drawingKey})}
let tab='chat',chatTimer=null

function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(Math.max(1,w),Math.max(1,h),false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();fitDirty=true}
const observer=new ResizeObserver(resize);observer.observe(stage);resize()
let drag=null,moved=false
canvas.addEventListener('pointerdown',e=>{isManual=true;drag={x:e.clientX,y:e.clientY,az:view.az,el:view.el};moved=false;canvas.setPointerCapture(e.pointerId)})
canvas.addEventListener('pointermove',e=>{if(!drag&&directory){const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},camera);const row=directoryRow(ray),over=row?row.id:null;if(over!==directory.hover){directory.hover=over;canvas.style.cursor=over?'pointer':'';drawDirectory()}}if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;view.az=Math.min(1.35,Math.max(.1,drag.az-dx*.005));view.el=Math.min(1.25,Math.max(.06,drag.el+dy*.004))})
canvas.addEventListener('pointerup',e=>{drag=null;if(moved)return;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},camera);const hit=ray.intersectObjects(actors.map(a=>a.g),true)[0];const row=directoryRow(ray);if(row&&(!hit||row.distance<hit.distance)){onPick(row.id);return};if(hit&&hit.object.userData.person)onPick(hit.object.userData.person.id);else{const ground=ray.intersectObjects(floors)[0];if(ground)onSpace(ground.object.spaceKey)}})
canvas.addEventListener('wheel',e=>{e.preventDefault();isManual=true;view.zoom=Math.min(40,Math.max(-view.dist+6,view.zoom+e.deltaY*.02))},{passive:false})
const marker=new THREE.Mesh(new THREE.ConeGeometry(.14,.26,4),glow(0xffc824));marker.rotation.x=Math.PI;scene.add(marker)
let lastTick=0;const v=new THREE.Vector3(),clock=new THREE.Clock()
let shadowTick=0
function loop(){const t=clock.getElapsedTime()
  if(fitDirty)fitCamera()
  if(t-lastDaylight>60){lastDaylight=t;applyTimeOfDay()}
  if(!isManual){
    const spot=focusKey&&spots[focusKey],ease=.09
    // From the end of the desks, low down, so both rows' faces clear the monitors.
    const goal=spot?{x:spot.x,y:1.55,z:spot.z,az:1.28,el:.17,d:Math.min(home.dist,Math.max(spot.D*.62,spot.W*.36/Math.max(camera.aspect,.55))+1.6)}:{x:home.center.x,y:home.center.y,z:home.center.z,az:home.az,el:home.el,d:home.dist}
    const talker=speaker&&actors.find(a=>a.p.id===speaker)
    // Whoever speaks may be anywhere, even with their back to the view, so go round to their front.
    // Someone can be away from their team's table, on a break or in a meeting, so go to them.
    const chosen=!talker&&spot&&selected&&selected!==focusKey&&actors.find(a=>a.p.id===selected)
    if(chosen&&Math.hypot(chosen.g.position.x-spot.x,chosen.g.position.z-spot.z)>Math.max(spot.W,spot.D)*.6){if(awayView?.id!==selected)awayView={id:selected,az:clearViewOf(chosen)};const offset=awayView.az-view.az;goal.x=chosen.g.position.x;goal.y=chosen.g.position.y+SPEAKER_HEIGHT;goal.z=chosen.g.position.z;goal.az=view.az+Math.atan2(Math.sin(offset),Math.cos(offset));goal.el=SPEAKER_RISE;goal.d=AWAY_DISTANCE}
    if(talker){if(speakerView===null)speakerView=clearViewOf(talker);const offset=speakerView-view.az;goal.x=talker.g.position.x;goal.y=talker.g.position.y+SPEAKER_HEIGHT;goal.z=talker.g.position.z;goal.az=view.az+Math.atan2(Math.sin(offset),Math.cos(offset));goal.el=SPEAKER_RISE;goal.d=SPEAKER_DISTANCE}
    view.center.x+=(goal.x-view.center.x)*ease;view.center.y+=(goal.y-view.center.y)*ease;view.center.z+=(goal.z-view.center.z)*ease
    view.az+=(goal.az-view.az)*ease;view.el+=(goal.el-view.el)*ease;view.dist+=(goal.d-view.dist)*ease
    view.zoom+=(0-view.zoom)*ease
  }
  const fit=view.dist+view.zoom
  camera.position.set(view.center.x+Math.sin(view.az)*Math.cos(view.el)*fit,view.center.y+Math.sin(view.el)*fit,view.center.z+Math.cos(view.az)*Math.cos(view.el)*fit);camera.lookAt(view.center)
  marker.visible=false
  const dt=Math.min(.1,t-lastTick);lastTick=t
  actors.forEach(a=>{
    if(a.life?.undo)a.life.undo()
    if(a.mixer)a.mixer.update(dt)
    if(a.mixer)liven(a,t,dt)
    if(a.screen)drawScreen(a,t)
    if(a.brewUntil&&t>a.brewUntil){
      a.brewUntil=0;giveMug(a);setPose(a,'walk')
      const seatAt=a.visit.target,near=new THREE.Vector3(seatAt.x+Math.sin(seatAt.face)*1.3,0,seatAt.z+Math.cos(seatAt.face)*1.3)
      a.route=[near,new THREE.Vector3(seatAt.x,seatAt.y||0,seatAt.z)]
    }
    if(a.route)walk(a,dt)
    if(a.p.id===selected&&!focusKey){marker.visible=true;marker.position.set(a.g.position.x,a.g.position.y+(a.pose==='wave'||a.pose==='walk'?2.95:2.4)+Math.sin(t*4)*.05,a.g.position.z);marker.rotation.y=t*2}
  })
  boards.forEach(board=>{if(t>board.nextDraw){board.nextDraw=t+4;drawBoard(board)};board.reflection.offset.x=view.az*.32+camera.position.z*.012})
  // People move slightly, so their shadows needn't redraw every frame; walkers keep them current.
  shadowTick=(shadowTick+1)%5
  sun.shadow.needsUpdate=shadowTick===0||actors.some(a=>a.route)
  const drawStart=PERF&&performance.now()
  renderer.render(scene,camera)
  if(PERF)notePerf(drawStart,t)
  const w=stage.clientWidth,h=stage.clientHeight
  let thoughtRoom=3
  tags.forEach(({el,a,key,isZone})=>{if(el.thought){const live=people.find(x=>x.id===a.p.id)||a.p,detailed=a.p.id===selected||el.matches(':hover'),shown=focusKey===key&&(detailed||thoughtRoom>0);if(focusKey===key&&!detailed&&shown)thoughtRoom--;drawThought(el.thought,live,shown,detailed)}el.classList.toggle('quiet',Boolean(focusKey&&key===focusKey&&spots[focusKey]?.hasBoard));if(el.waitBadge)el.waitBadge.textContent=`Waiting · ${Math.max(1,Math.round((Date.now()/1000-a.p.jobStartedAt)/60))}m`;el.style.display=!focusKey||(key===focusKey&&!isZone)||a.p.request?'':'none';v.set(a.g.position.x,a.g.position.y+(isZone?2.55:a.pose==='wave'||a.pose==='walk'?2.5:1.95),a.g.position.z).project(camera);el.style.left=((v.x+1)/2*w)+'px';el.style.top=((1-v.y)/2*h)+'px';el.classList.toggle('on',a.p.id===selected);if(!isZone){const near=Math.min(1.12,Math.max(.72,13/camera.position.distanceTo(a.g.position)));el.style.transform=`translate(-50%,-100%) scale(${near.toFixed(3)})`}})
}
const timer=setInterval(loop,33)
let signature=''
return {
  update(nextPeople,nextSelected,nextFocus,nextSpeaker=null,nextUsage=null){
    selected=nextSelected
    if(nextSpeaker!==speaker)speakerView=null
    if(nextSpeaker&&nextSpeaker!==speaker)isManual=false
    speaker=nextSpeaker
    if(nextFocus!==focusKey){focusKey=nextFocus;isManual=false}
    const sig=JSON.stringify(nextPeople.map(p=>[p.id,p.name,p.label,p.project,p.startedBy,p.title,p.isRunning,p.isFinished,p.avatar,p.startedBy,p.teamId,p.teamName,p.teamLeadId,p.meetingWith,p.talkingTo,p.helpers,p.jobs,p.isWaiting,p.isOnBreak,p.request&&p.request.id,p.isOnScreen,p.isAssistant]))
    people=nextPeople
    if(sig!==signature&&people.length){signature=sig;build()}
    usage=nextUsage;drawUsage();drawDirectory()
  },
  setBoardFont(family){
    boardFont=`"${family}",sans-serif`
    boards.forEach(drawBoard);drawDirectory();drawUsage();actors.forEach(a=>{if(a.screen)a.screen.drawn=''})
  },
  dispose(){clearInterval(timer);observer.disconnect();renderer.dispose()},
}
}
