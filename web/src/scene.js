import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js'

const cloneSkinned = model => SkeletonUtils.clone(model)

const AVATARS = '/assets/avatars'
export const CAST = ['Female_Adult_01','Female_Adult_03','Female_Adult_04','Female_Adult_07','Female_Adult_08','Female_Adult_12','Female_Adult_13','Female_Adult_17','Female_Party_02','Business_Female_01','Male_Adult_01','Male_Adult_02','Male_Adult_04','Male_Adult_06','Male_Adult_08','Male_Adult_09','Male_Adult_10','Male_Adult_12','Male_Adult_16','Male_Adult_17']
const UNIFORMS = [0xe0342c,0x2a5bd7,0x1fa24a,0xf08a24,0x8a4bd7,0x18a7a0,0xd23ba8,0x8b6b3d]
const nameHash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const uniformOf = project => UNIFORMS[nameHash(project) % UNIFORMS.length]
export const helperCast=(label,index)=>(nameHash(label)+index*5)%CAST.length
const MODEL_SCALE = .0122
const CLIPS = { sit: 'sit_chair_idle_neutral_01', work: 'work_table', stand: 'idle_neutral_01', wave: 'wave_01', walk: 'walk_neutral' }
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
const home={center:new THREE.Vector3(0,1.1,0),dist:30}
let focusKey=null,spots={},floors=[],isManual=false,drawingKey=null
const renderer = new THREE.WebGLRenderer({canvas, antialias:true})
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xdbe8ef)
const camera = new THREE.PerspectiveCamera(46, 1, .1, 300)
scene.add(new THREE.HemisphereLight(0xfffaf0, 0xc9b8a2, .62))
const sun = new THREE.DirectionalLight(0xfff0dc, .62); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0006; sun.shadow.radius = 3; scene.add(sun)
let world = new THREE.Group(); scene.add(world)

const mats = {}
const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({color:c, flatShading:true}))
const glow = c => mats['g'+c] || (mats['g'+c] = new THREE.MeshBasicMaterial({color:c, fog:false}))
function box(parent,w,h,d,c,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),typeof c==='number'?mat(c):c);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m}
function pixelTex(size,draw,rx=1,ry=1){const k=document.createElement('canvas');k.width=k.height=size;draw(k.getContext('2d'),size);const t=new THREE.CanvasTexture(k);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);return t}
const texMat = t => new THREE.MeshLambertMaterial({map:t})
function paintTex(w,h,draw,rx=1,ry=1){const k=document.createElement('canvas');k.width=w;k.height=h;draw(k.getContext('2d'),w,h);const t=new THREE.CanvasTexture(k);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=4;return t}
const FLOOR_T=rx=>paintTex(256,256,(g,w)=>{g.fillStyle='#f2e6d6';g.fillRect(0,0,w,w);g.fillStyle='#ece0ce';g.fillRect(0,0,w/2,w/2);g.fillRect(w/2,w/2,w/2,w/2);g.fillStyle='#e0d2bd';g.fillRect(0,0,w,2);g.fillRect(0,0,2,w);g.fillRect(0,w/2,w,1);g.fillRect(w/2,0,1,w)},rx,rx)
function skyline(seed,rx=1){return paintTex(1536,512,(g,w,h)=>{
  const sky=g.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#2f9fe0');sky.addColorStop(.65,'#8fd2f2');sky.addColorStop(1,'#d9f0f7');g.fillStyle=sky;g.fillRect(0,0,w,h)
  let r=seed;const rand=()=>(r=(r*9301+49297)%233280)/233280
  g.fillStyle='rgba(255,255,255,.92)'
  for(let i=0;i<9;i++){const x=rand()*w,y=40+rand()*170;for(let j=0;j<6;j++){g.beginPath();g.ellipse(x+j*34-90,y+Math.sin(j*1.4)*11,44-Math.abs(j-2.5)*7,18+rand()*14,0,0,7);g.fill()}}
  const row=(top,tones,minW,maxW,lit)=>{let x=-10;while(x<w){const b=minW+rand()*(maxW-minW),t=top+rand()*(h-top)*.55;g.fillStyle=tones[Math.floor(rand()*tones.length)];g.fillRect(x,t,b,h-t);if(lit){g.fillStyle='rgba(255,255,255,.28)';for(let wy=t+12;wy<h-8;wy+=16)for(let wx=x+7;wx<x+b-7;wx+=13)if(rand()>.35)g.fillRect(wx,wy,6,8)}x+=b+rand()*7}}
  row(180,['#a9cfe6','#b7d8ea','#9cc5df'],36,90,false)
  row(250,['#6fa3cc','#5f94c0','#82b1d3','#e9f0f3'],44,110,true)
  row(350,['#3e74a4','#4c82ae','#2f6494','#c9dbe6'],60,150,true)
  g.fillStyle='rgba(255,255,255,.18)';g.fillRect(0,0,w,h)
},rx,1)}
const WHITE=0xf6f4ef,ORANGE=0xe0682f,WOOD=0xc98f55,CHARCOAL=0x2f3540,LEAF=0x2f8f54
const SCREEN_W=256,SCREEN_H=144,faces=new Map()
function faceImage(person){
  const key=`${castOf(person)}|${person.project}`
  if(!faces.has(key)){const entry={image:null};faces.set(key,entry);portrait(person).then(url=>{const image=new Image();image.onload=()=>{entry.image=image;actors.forEach(a=>{if(a.screen)a.screen.drawn=''})};image.src=url},()=>{})}
  return faces.get(key).image
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
  const helpers=p.helpers||[],live=!p.request&&!other&&!helpers.length&&p.isRunning
  const key=p.request?'request':other?`call:${other.id}`:helpers.length?`helpers:${helpers.join()}`:live?`code:${Math.floor(t*2)}`:'idle'
  if(a.screen.drawn===key)return
  a.screen.drawn=key
  if(p.request){g.fillStyle='#b4281f';g.fillRect(0,0,SCREEN_W,SCREEN_H);g.fillStyle='#fff';g.font='600 22px Inter,sans-serif';g.textAlign='center';g.fillText('Calling you…',SCREEN_W/2,SCREEN_H/2+8)}
  else if(other){drawFace(g,other,0,0,SCREEN_W,SCREEN_H);g.fillStyle='rgba(0,0,0,.6)';g.fillRect(0,SCREEN_H-26,SCREEN_W,26);g.fillStyle='#fff';g.font='15px Inter,sans-serif';g.textAlign='left';g.fillText(other.name,8,SCREEN_H-8)}
  else if(helpers.length){
    const shown=helpers.slice(0,4),cols=shown.length>2?2:shown.length,rows=shown.length>2?2:1,w=SCREEN_W/cols,h=SCREEN_H/rows
    shown.forEach((label,i)=>drawFace(g,{avatar:CAST[helperCast(label,i)],project:p.project,name:label},(i%cols)*w,Math.floor(i/cols)*h,w-1,h-1))
    if(helpers.length>4){g.fillStyle='rgba(0,0,0,.65)';g.fillRect(SCREEN_W-44,SCREEN_H-24,44,24);g.fillStyle='#fff';g.font='14px Inter,sans-serif';g.textAlign='left';g.fillText(`+${helpers.length-4}`,SCREEN_W-38,SCREEN_H-7)}
  }
  else if(live){
    g.fillStyle='#14202c';g.fillRect(0,0,SCREEN_W,SCREEN_H)
    const shift=Math.floor(t*2),colors=['#6fd3ff','#9ee493','#f7c76b','#d6dde5']
    for(let i=0;i<9;i++){const r=(nameHash(p.id)+(i+shift)*37)%97;g.fillStyle=colors[r%4];g.fillRect(12+(r%4)*14,8+i*15,40+r%150,7)}
  }
  else{g.fillStyle='#2b3440';g.fillRect(0,0,SCREEN_W,SCREEN_H)}
  texture.needsUpdate=true
}
const WORLD_UP=new THREE.Vector3(0,1,0),tempAxis=new THREE.Vector3(),tempTurn=new THREE.Quaternion(),tempWorld=new THREE.Quaternion()
// Added on top of the animation each frame, using world directions so the bone's own axes don't matter.
function liven(a,t,dt){
  const life=a.life
  if(!life||!life.head)return
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
  a.life={head:model.getObjectByName('Bip01_Head'),lids:['LEyeBlinkTop','REyeBlinkTop'].map(n=>model.getObjectByName(n)).filter(Boolean),lower:['LEyeBlinkBottom','REyeBlinkBottom'].map(n=>model.getObjectByName(n)).filter(Boolean),yaw:0,goal:0,nextGlance:1+Math.random()*4,nextBlink:1+Math.random()*4,blink:0}
  setPose(a,a.pose)
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
function plant(parent,x,z,size=1){
  const pot=new THREE.Mesh(new THREE.CylinderGeometry(.42*size,.32*size,.8*size,12),mat(WHITE));pot.position.set(x,.4*size,z);pot.castShadow=true;parent.add(pot)
  for(let i=0;i<9;i++){const a=i*2.4,r=i===0?0:.34*size,l=new THREE.Mesh(new THREE.IcosahedronGeometry((.44-.012*i)*size,0),mat(i%3?LEAF:0x3fa867));l.scale.set(1,1.25,.8);l.position.set(x+Math.cos(a)*r,(1.05+i*.16)*size,z+Math.sin(a)*r);l.rotation.y=a;l.castShadow=true;parent.add(l)}
}
const WOOD_TOP=()=>new THREE.MeshLambertMaterial({map:paintTex(512,256,(g,w,h)=>{g.fillStyle='#b98450';g.fillRect(0,0,w,h);for(let i=0;i<90;i++){const y=(i*53)%h;g.strokeStyle=i%3?'rgba(112,70,34,.2)':'rgba(226,179,126,.26)';g.lineWidth=1+(i%3);g.beginPath();g.moveTo(0,y);g.bezierCurveTo(w*.3,y+(i%9)-4,w*.7,y-(i%7)+3,w,y+(i%5)-2);g.stroke()}})})
let woodTop=null
const SILVER=0xc9ccd1
function desk(parent,x,z,dir,isOn){
  woodTop=woodTop||WOOD_TOP()
  box(parent,2.1,.07,1.1,woodTop,x,1.02,z)
  ;[[-.96,-.46],[.96,-.46],[-.96,.46],[.96,.46]].forEach(([a,b])=>{const leg=box(parent,.05,1,.05,0x30343b,x+a,.5,z+b);leg.rotation.z=(a>0?-1:1)*.04})
  const back=z-dir*.28
  // A slim all-in-one display: foot, stand, aluminium body with a chin, and the screen.
  box(parent,.34,.018,.24,SILVER,x,1.066,back)
  const stand=box(parent,.22,.36,.022,SILVER,x,1.24,back-dir*.02);stand.rotation.x=-dir*.1
  box(parent,1.08,.68,.026,SILVER,x,1.67,back)
  const screen=box(parent,1.02,.54,.006,isOn?glow(0x59c7ff):mat(0x262a31),x,1.72,back+dir*.016)
  box(parent,.5,.016,.15,0xeceef0,x,1.066,z+dir*.16)
  box(parent,.075,.018,.12,0xeceef0,x+.38,1.066,z+dir*.16)
  const cup=new THREE.Mesh(new THREE.CylinderGeometry(.05,.04,.11,12),mat(WHITE));cup.position.set(x+.78,1.11,z);parent.add(cup)
  return screen
}
function chair(parent,x,z,dir){
  box(parent,.74,.11,.72,CHARCOAL,x,.66,z)
  box(parent,.68,.8,.08,0x48505e,x,1.14,z+dir*.38)
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.52,8),mat(0x8d939c));stem.position.set(x,.35,z);parent.add(stem)
  for(let i=0;i<5;i++){const a=i*1.257,leg=box(parent,.42,.035,.05,0x8d939c,x+Math.cos(a)*.2,.08,z+Math.sin(a)*.2);leg.rotation.y=-a}
}
function couch(parent,x,z,w){
  box(parent,w,.3,1.05,ORANGE,x,.47,z)
  box(parent,w,.72,.26,0xcc5a26,x,.82,z-.46)
  box(parent,.26,.56,1.05,0xcc5a26,x-w/2,.53,z);box(parent,.26,.56,1.05,0xcc5a26,x+w/2,.53,z)
  box(parent,w-.1,.12,.5,0xc25324,x,.1,z)
}
let people=[], selected=null, actors=[], tags=[], view={az:.72,el:.38,dist:30,zoom:0,center:new THREE.Vector3()}
function leadOf(p,byId){let l=p;const seen=new Set([p.id]);while(l.startedBy&&byId[l.startedBy]&&!seen.has(l.startedBy)){seen.add(l.startedBy);l=byId[l.startedBy]}return l}
function teamsIn(list){const byId=Object.fromEntries(people.map(p=>[p.id,p]));const m=new Map();list.forEach(p=>{const l=leadOf(p,byId);if(!m.has(l.id))m.set(l.id,{lead:l,members:[]});m.get(l.id).members.push(p)});return [...m.values()].map(t=>({...t,members:[t.lead,...t.members.filter(x=>x.id!==t.lead.id)]})).sort((a,b)=>(b.lead.lastActivityAt||'').localeCompare(a.lead.lastActivityAt||''))}
const busy=p=>p.isRunning||p.isFinished||Boolean(p.request)||Boolean(p.meetingWith&&p.meetingWith.length)
const WALL_HEIGHT=10
const AISLE_GAP=3.2
// Every team gets its own space, so teams read apart without closing up the floor.
function planSpaces(){
  const teams=teamsIn(people),groups=teams.filter(t=>t.members.length>1||busy(t.lead)),idle=teams.filter(t=>!groups.includes(t)).map(t=>t.lead)
  const spaces=groups.sort((a,b)=>a.lead.project.localeCompare(b.lead.project)).map(t=>({kind:'team',team:t,W:Math.max(6.4,Math.ceil(t.members.length/2)*2.5+1.6),D:7.4}))
  spaces.push({kind:'meeting',W:8.4,D:7})
  if(idle.length)spaces.push({kind:'lounge',people:idle,W:Math.max(7,idle.length*2.3+1.6),D:6.4})
  spaces.push({kind:'office',W:7.4,D:7})
  return spaces
}
function build(){
  scene.remove(world); world=new THREE.Group(); scene.add(world); actors=[]; tagsEl.innerHTML=''; tags=[]; spots={}; floors=[]
  const spaces=planSpaces(),perRow=Math.max(2,Math.ceil(Math.sqrt(spaces.length)))
  const rows=[];spaces.forEach((z,i)=>{const r=Math.floor(i/perRow);(rows[r]=rows[r]||[]).push(z)})
  const rowW=row=>row.reduce((n,z)=>n+z.W,0)+(row.length-1)*AISLE_GAP, rowD=row=>Math.max(...row.map(z=>z.D))
  const W=Math.max(16,...rows.map(rowW))+3, D=Math.max(12,rows.reduce((n,r)=>n+rowD(r),0)+(rows.length-1)*AISLE_GAP)+3.2
  visitors=0
  // The room runs on past the camera, so there's no edge to see from inside it.
  const REACH=70,H=WALL_HEIGHT,back=-D/2,left=-W/2,longX=W+REACH,longZ=D+REACH,midX=REACH/2,midZ=REACH/2
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(longX,longZ),new THREE.MeshLambertMaterial({map:FLOOR_T(Math.ceil(Math.max(longX,longZ)/3))})); floor.rotation.x=-Math.PI/2; floor.position.set(midX,0,midZ); floor.receiveShadow=true; world.add(floor)
  floorSize={W,D}
  const glass=(width,skyTex,place)=>{const pane=new THREE.Mesh(new THREE.PlaneGeometry(width,H),new THREE.MeshBasicMaterial({map:skyTex}));place(pane);world.add(pane)}
  glass(longX,skyline(137,longX/27),m=>m.position.set(midX,H/2,back-.08))
  glass(longZ,skyline(911,longZ/27),m=>{m.rotation.y=Math.PI/2;m.position.set(left-.08,H/2,midZ)})
  box(world,longX,.32,.12,0xe8e5de,midX,.16,back);box(world,.12,.32,longZ,0xe8e5de,left,.16,midZ)
  for(let x=left,i=0;x<=left+longX;x+=3.6,i++){const thick=i%3===0;box(world,thick?.42:.07,H,thick?.42:.07,thick?WHITE:CHARCOAL,x,H/2,back)}
  for(let z=back,i=0;z<=back+longZ;z+=3.6,i++){const thick=i%3===0;box(world,thick?.42:.07,H,thick?.42:.07,thick?WHITE:CHARCOAL,left,H/2,z)}
  ;[.36,.72].forEach(f=>{box(world,longX,.05,.05,CHARCOAL,midX,H*f,back);box(world,.05,.05,longZ,CHARCOAL,left,H*f,midZ)})
  // Faces down only, so it disappears when the camera is pulled up through it.
  const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(longX,longZ),new THREE.MeshBasicMaterial({map:paintTex(128,128,(g,w)=>{g.fillStyle='#f4f2ec';g.fillRect(0,0,w,w);g.fillStyle='#dcd9d1';g.fillRect(0,0,w,2);g.fillRect(0,0,2,w)},longX/2.4,longZ/2.4)}))
  ceiling.rotation.x=Math.PI/2;ceiling.position.set(midX,H,midZ);world.add(ceiling)
  const lamp=new THREE.MeshBasicMaterial({color:0xfffdf2})
  for(let x=left+3;x<left+longX;x+=7.2)for(let z=back+3;z<back+longZ;z+=7.2){const light=new THREE.Mesh(new THREE.PlaneGeometry(2.4,.9),lamp);light.rotation.x=Math.PI/2;light.position.set(x,H-.02,z);world.add(light)}
  // Sun falling through the back windows.
  const sunMat=new THREE.MeshBasicMaterial({color:0xffb45e,transparent:true,opacity:.2,depthWrite:false})
  for(let i=0,n=Math.max(3,Math.round(W/5));i<n;i++){const patch=new THREE.Mesh(new THREE.PlaneGeometry(W/n*.62,D*.82),sunMat);patch.rotation.x=-Math.PI/2;patch.position.set(left+(i+.5)*W/n+1,.012,back+D*.43);world.add(patch)}
  plant(world,left+.8,back+.8,1.25);plant(world,-left-.9,back+.8,1.05);plant(world,left+.8,-back-.9,1)
  sun.position.set(-W*.25,H*3.2,-D*.1+D*.6)
  const reach=Math.max(W,D)*.85
  Object.assign(sun.shadow.camera,{left:-reach,right:reach,top:reach,bottom:-reach,near:.5,far:Math.max(W,D)*3});sun.shadow.camera.updateProjectionMatrix()
  let z0=back+2
  meetingSeats=[];officeSpots=[]
  rows.forEach(row=>{
    let x0=left+1.5
    row.forEach(space=>{drawSpace(space,x0,z0);x0+=space.W+AISLE_GAP})
    z0+=rowD(row)+AISLE_GAP
  })
  actors.filter(a=>a.walkPending).forEach(startWalk)
  fitDirty=true
}
let fitDirty=true,floorSize={W:20,D:20}
// The closest camera distance that still shows the whole floor and back walls.
function fitCamera(){
  const first=!view.fitted
  fitDirty=false;view.fitted=true
  const {W,D}=floorSize,ceilingRoom=(WALL_HEIGHT-1.2-home.center.y)/Math.sin(view.el)
  home.dist=Math.min(Math.max(14,Math.max(W,D)*.62),ceilingRoom)
  if(first){view.dist=home.dist;view.center.copy(home.center)}
}
function flat(w,d,c,x,y,z){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(c));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);m.receiveShadow=true;world.add(m);return m}
const WALK_SPEED=2.4, arrived=new Map()
let meetingSeats=[],officeSpots=[],visitors=0
const faceToward=(a,x,z)=>{a.g.rotation.y=Math.atan2(x-a.g.position.x,z-a.g.position.z)}
function startWalk(a){
  a.walkPending=false
  const toOffice=Boolean(a.p.request)
  const target=toOffice?officeSpots[visitors++%Math.max(1,officeSpots.length)]:meetingSeats[visitors++%Math.max(1,meetingSeats.length)]
  if(!target)return
  const key=toOffice?`office:${a.p.request.id}`:`meeting:${[a.p.id,...a.p.meetingWith].sort().join()}`
  a.visit={target,key,toOffice}
  if(arrived.get(a.p.id)===key){a.g.position.set(target.x,0,target.z);a.g.rotation.y=target.face;a.pose=toOffice?'wave':'sit';return}
  a.pose='walk'
  a.route=[new THREE.Vector3(a.g.position.x,0,a.front),new THREE.Vector3(target.x,0,a.front),new THREE.Vector3(target.x,0,target.z)]
}
function walk(a,dt){
  const target=a.route[0],gap=target.clone().sub(a.g.position);gap.y=0
  const step=WALK_SPEED*dt
  if(gap.length()<=step){
    a.g.position.copy(target);a.route.shift()
    if(!a.route.length){a.route=null;arrived.set(a.p.id,a.visit.key);a.g.rotation.y=a.visit.target.face;setPose(a,a.visit.toOffice?'wave':'sit')}
    return
  }
  a.g.rotation.y=Math.atan2(gap.x,gap.z);a.g.position.add(gap.setLength(step))
}
const wantsToWalk=p=>Boolean(p.request)||Boolean(p.meetingWith&&p.meetingWith.length)
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
function drawSpace(space,x0,z0){
  const {W,D,kind}=space,cx=x0+W/2,cz=z0+D/2,front=z0+D+AISLE_GAP/2,key=kind==='team'?space.team.lead.id:kind
  spots[key]={x:cx,z:cz,W,D}
  drawingKey=key
  const label=(name)=>addZoneTag(name,cx,z0-.2,key)
  if(kind==='team'){
    const {team}=space,uniform=new THREE.Color(uniformOf(team.lead.project)),isTeam=team.members.length>1
    floors.push(Object.assign(flat(W,D,uniform.clone().lerp(new THREE.Color(0xffffff),.82).getHex(),cx,.02,cz),{spaceKey:key}))
    box(world,W,1.3,.09,WHITE,cx,.65,z0);box(world,.09,1.3,D,WHITE,x0,.65,cz)
    box(world,W,.09,.13,uniform.getHex(),cx,1.33,z0)
    label(isTeam?`${team.lead.name}'s team · ${team.lead.project}`:`${team.lead.name} · ${team.lead.project}`)
    team.members.forEach((p,i)=>{
      const col=Math.floor(i/2),row=i%2===0?-1:1,sx=cx-(Math.ceil(team.members.length/2)-1)*1.25+col*2.5,deskZ=cz+row*.58,seatZ=cz+row*1.74
      const screen=desk(world,sx,deskZ,row,p.isRunning);chair(world,sx,seatZ,row)
      const a=seat(p,sx,seatZ,row===-1?0:Math.PI,front,p.isFinished?'wave':p.isRunning||p.helpers?.length||p.talkingTo?'work':'sit')
      attachScreen(a,screen);addTag(a,isTeam&&p.id===team.lead.id);dress(a)
    })
  }
  if(kind==='lounge'){
    floors.push(Object.assign(flat(W,D,0xe6d8c4,cx,.02,cz),{spaceKey:key}));label('Lounge')
    couch(world,cx,cz-1,W-1.2);box(world,W*.4,.3,1,WOOD,cx,.3,cz+1)
    space.people.forEach((p,i)=>{const sx=cx-(W-2.4)/2+(i+.5)*(W-2.4)/space.people.length,a=seat(p,sx,cz-.82,0,front,'sit',-.1);addTag(a,false);dress(a)})
    plant(world,x0+W-.6,z0+D-.7,.9)
  }
  if(kind==='meeting'){
    floors.push(Object.assign(flat(W,D,0xd8c6ae,cx,.02,cz),{spaceKey:key}));label('Meeting room')
    glassWall(cx,z0,W,true);glassWall(x0,cz,D,false)
    const top=new THREE.Mesh(new THREE.CylinderGeometry(1,1,.1,40),mat(WOOD));top.scale.set(2.5,1,1.1);top.position.set(cx,1,cz);top.castShadow=top.receiveShadow=true;world.add(top)
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.16,.3,1,10),mat(CHARCOAL));stem.position.set(cx,.5,cz);world.add(stem)
    for(let i=0;i<8;i++){const side=i<4?-1:1,sx=cx-1.8+(i%4)*1.2,sz=cz+side*1.95;chair(world,sx,sz,side);meetingSeats.push({x:sx,z:sz,face:side===-1?0:Math.PI})}
    box(world,2.4,1.25,.05,WHITE,cx+1.2,1.75,z0+.08)
  }
  if(kind==='office'){
    floors.push(Object.assign(flat(W,D,0xcfdde6,cx,.02,cz),{spaceKey:key}));label('Your office')
    glassWall(cx,z0,W,true);glassWall(x0,cz,D,false)
    desk(world,cx,cz-.5,1,true);chair(world,cx,cz-1.7,-1)
    ;[-1.2,0,1.2].forEach(dx=>officeSpots.push({x:cx+dx,z:cz+1.6,face:Math.PI}))
    plant(world,x0+W-.6,z0+.7,1.1)
    box(world,1.8,.8,.35,WOOD,x0+1.2,.4,z0+.28)
  }
}
function addZoneTag(name,x,z,key){const el=document.createElement('div');el.className='zone-tag';el.textContent=name;el.onclick=()=>onSpace(key);tagsEl.appendChild(el);tags.push({el,a:{g:{position:new THREE.Vector3(x,-2.65,z)},p:{id:null}},key,isZone:true})}
function addTag(a,isLead){const el=document.createElement('div');el.className='tag'+(isLead?' lead':'');const name=document.createElement('span');name.textContent=a.p.name;if(a.p.label){const job=document.createElement('em');job.textContent=' · '+a.p.label;name.appendChild(job)}el.appendChild(name);const count=a.p.helpers?.length||0;if(count||a.p.talkingTo){const badge=document.createElement('b');badge.className='call-badge';badge.textContent=count?`${count} helper${count>1?'s':''}`:'On a call';el.appendChild(badge)}if(busy(a.p)){const say=document.createElement('div');say.className='say'+(a.p.request?' asks':a.p.isFinished?' done':'');say.textContent=a.p.request?a.p.request.message:a.p.meetingWith&&a.p.meetingWith.length?'In a meeting':a.p.isFinished?'Finished: '+a.p.title:a.p.title;el.prepend(say)}el.title=a.p.title;el.onclick=()=>onPick(a.p.id);tagsEl.appendChild(el);tags.push({el,a,key:drawingKey})}
let tab='chat',chatTimer=null

function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(Math.max(1,w),Math.max(1,h),false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();fitDirty=true}
const observer=new ResizeObserver(resize);observer.observe(stage);resize()
let drag=null,moved=false
canvas.addEventListener('pointerdown',e=>{isManual=true;drag={x:e.clientX,y:e.clientY,az:view.az,el:view.el};moved=false;canvas.setPointerCapture(e.pointerId)})
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;view.az=Math.min(1.35,Math.max(.1,drag.az-dx*.005));view.el=Math.min(1.25,Math.max(.14,drag.el+dy*.004))})
canvas.addEventListener('pointerup',e=>{drag=null;if(moved)return;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},camera);const hit=ray.intersectObjects(actors.map(a=>a.g),true)[0];if(hit&&hit.object.userData.person)onPick(hit.object.userData.person.id);else{const ground=ray.intersectObjects(floors)[0];if(ground)onSpace(ground.object.spaceKey)}})
canvas.addEventListener('wheel',e=>{e.preventDefault();isManual=true;view.zoom=Math.min(40,Math.max(-view.dist+6,view.zoom+e.deltaY*.02))},{passive:false})
const marker=new THREE.Mesh(new THREE.ConeGeometry(.14,.26,4),glow(0xffc824));marker.rotation.x=Math.PI;scene.add(marker)
let lastTick=0;const v=new THREE.Vector3(),clock=new THREE.Clock()
function loop(){const t=clock.getElapsedTime()
  if(fitDirty)fitCamera()
  if(!isManual){
    const spot=focusKey&&spots[focusKey],goal=spot?{x:spot.x,z:spot.z,d:Math.min(home.dist,Math.max(spot.W/Math.max(camera.aspect,.55)*.68,spot.D*.68)+2.2)}:{x:home.center.x,z:home.center.z,d:home.dist},ease=Math.min(1,.09)
    view.center.x+=(goal.x-view.center.x)*ease;view.center.z+=(goal.z-view.center.z)*ease;view.dist+=(goal.d-view.dist)*ease
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
    if(a.route)walk(a,dt)
    if(a.p.id===selected){marker.visible=true;marker.position.set(a.g.position.x,a.g.position.y+2.72+Math.sin(t*4)*.05,a.g.position.z);marker.rotation.y=t*2}
  })
  renderer.render(scene,camera)
  const w=stage.clientWidth,h=stage.clientHeight
  tags.forEach(({el,a,key,isZone})=>{el.style.display=!focusKey||(key===focusKey&&!isZone)||a.p.request?'':'none';v.set(a.g.position.x,a.g.position.y+(isZone?2.55:2.2),a.g.position.z).project(camera);el.style.left=((v.x+1)/2*w)+'px';el.style.top=((1-v.y)/2*h)+'px';el.classList.toggle('on',a.p.id===selected)})
}
const timer=setInterval(loop,33)
let signature=''
return {
  update(nextPeople,nextSelected,nextFocus){
    selected=nextSelected
    if(nextFocus!==focusKey){focusKey=nextFocus;isManual=false}
    const sig=JSON.stringify(nextPeople.map(p=>[p.id,p.name,p.label,p.project,p.startedBy,p.title,p.isRunning,p.isFinished,p.avatar,p.startedBy,p.meetingWith,p.talkingTo,p.helpers,p.request&&p.request.id]))
    people=nextPeople
    if(sig!==signature&&people.length){signature=sig;build()}
  },
  dispose(){clearInterval(timer);observer.disconnect();renderer.dispose()},
}
}
