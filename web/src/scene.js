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
const JAW_OPEN = .22
const SPEAKER_ANGLES = [.7, -.7, .35, -.35, 1.05, -1.05, 0]
const SPEAKER_DISTANCE = 4.6
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
const home={center:new THREE.Vector3(0,1.1,0),dist:30,az:.72,el:.38}
let speaker=null,usage=null,usageScreen=null,speakerView=null,awayView=null,focusKey=null,spots={},floors=[],isManual=false,drawingKey=null
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
// The monitor on the person's own desk shows what's running and what it costs.
function attachUsageScreen(mesh){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=324
  const texture=new THREE.CanvasTexture(canvas);texture.anisotropy=8
  mesh.material=new THREE.MeshBasicMaterial({map:texture})
  usageScreen={canvas,texture};drawUsage()
}
function drawUsage(){
  if(!usageScreen)return
  const {canvas,texture}=usageScreen,g=canvas.getContext('2d'),W=canvas.width,H=canvas.height
  g.fillStyle='#17181c';g.fillRect(0,0,W,H)
  g.fillStyle='#f4f4f5';g.font='600 26px Inter,sans-serif';g.textAlign='left';g.fillText('Usage',28,44)
  const meter=(label,detail,part,y)=>{
    g.fillStyle='#d4d4d8';g.font='20px Inter,sans-serif';g.textAlign='left';g.fillText(label,28,y)
    g.fillStyle='#a1a1aa';g.textAlign='right';g.fillText(detail,W-28,y)
    g.fillStyle='#2e2f36';g.fillRect(28,y+10,W-56,9)
    if(part!==null){g.fillStyle=part>=.8?'#ef4444':'#818cf8';g.fillRect(28,y+10,(W-56)*Math.min(1,part),9)}
  }
  const week=usage?.claude?.windows?.[0],speech=usage?.speech
  meter('Claude this week',week?`${week.percentUsed}%`:'Not available',week?week.percentUsed/100:null,92)
  meter('Voices today',speech?.isOn?`${speech.today.toLocaleString()} of ${speech.cap.toLocaleString()}`:'Off',speech?.isOn?speech.today/speech.cap:null,156)
  const working=people.filter(p=>p.isActing).length,jobs=people.reduce((n,p)=>n+(p.jobs?.length||0),0),modal=usage?.modal
  g.fillStyle='#d4d4d8';g.font='20px Inter,sans-serif';g.textAlign='left'
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
  if(p.request){g.fillStyle='#b4281f';g.fillRect(0,0,SCREEN_W,SCREEN_H);g.fillStyle='#fff';g.font='600 22px Inter,sans-serif';g.textAlign='center';g.fillText('Calling you…',SCREEN_W/2,SCREEN_H/2+8)}
  else if(other){drawFace(g,other,0,0,SCREEN_W,SCREEN_H);g.fillStyle='rgba(0,0,0,.6)';g.fillRect(0,SCREEN_H-26,SCREEN_W,26);g.fillStyle='#fff';g.font='15px Inter,sans-serif';g.textAlign='left';g.fillText(other.name,8,SCREEN_H-8)}
  else if(helpers.length){
    const shown=helpers.slice(0,4),cols=shown.length>2?2:shown.length,rows=shown.length>2?2:1,w=SCREEN_W/cols,h=SCREEN_H/rows
    shown.forEach((label,i)=>drawFace(g,{avatar:CAST[helperCast(label,i)],project:p.project,name:label},(i%cols)*w,Math.floor(i/cols)*h,w-1,h-1))
    if(helpers.length>4){g.fillStyle='rgba(0,0,0,.65)';g.fillRect(SCREEN_W-44,SCREEN_H-24,44,24);g.fillStyle='#fff';g.font='14px Inter,sans-serif';g.textAlign='left';g.fillText(`+${helpers.length-4}`,SCREEN_W-38,SCREEN_H-7)}
  }
  else if(waiting){
    g.fillStyle='#14202c';g.fillRect(0,0,SCREEN_W,SCREEN_H)
    g.strokeStyle='#2c4258';g.lineWidth=8;g.beginPath();g.arc(SCREEN_W/2,56,24,0,7);g.stroke()
    g.strokeStyle='#59c7ff';g.beginPath();const turn=Math.floor(t*6)/6*Math.PI*2;g.arc(SCREEN_W/2,56,24,turn,turn+1.7);g.stroke()
    g.fillStyle='#d6dde5';g.font='13px Inter,sans-serif';g.textAlign='center';g.fillText((p.jobs?.[0]||'Job running').slice(0,34),SCREEN_W/2,112)
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
function plant(parent,x,z,size=1){
  const pot=new THREE.Mesh(new THREE.CylinderGeometry(.42*size,.32*size,.8*size,12),mat(WHITE));pot.position.set(x,.4*size,z);pot.castShadow=true;parent.add(pot)
  for(let i=0;i<9;i++){const a=i*2.4,r=i===0?0:.34*size,l=new THREE.Mesh(new THREE.IcosahedronGeometry((.44-.012*i)*size,0),mat(i%3?LEAF:0x3fa867));l.scale.set(1,1.25,.8);l.position.set(x+Math.cos(a)*r,(1.05+i*.16)*size,z+Math.sin(a)*r);l.rotation.y=a;l.castShadow=true;parent.add(l)}
}
const WOOD_TOP=()=>new THREE.MeshLambertMaterial({map:paintTex(512,256,(g,w,h)=>{g.fillStyle='#b98450';g.fillRect(0,0,w,h);for(let i=0;i<90;i++){const y=(i*53)%h;g.strokeStyle=i%3?'rgba(112,70,34,.2)':'rgba(226,179,126,.26)';g.lineWidth=1+(i%3);g.beginPath();g.moveTo(0,y);g.bezierCurveTo(w*.3,y+(i%9)-4,w*.7,y-(i%7)+3,w,y+(i%5)-2);g.stroke()}})})
let woodTop=null
const SILVER=0xc9ccd1
function tableTop(parent,x,z,length,depth){
  woodTop=woodTop||WOOD_TOP()
  box(parent,length,.07,depth,woodTop,x,1.02,z)
  const legRows=Math.max(1,Math.round(length/2.6))
  for(let i=0;i<=legRows;i++){const lx=x-length/2+.08+i*(length-.16)/legRows;[-1,1].forEach(side=>box(parent,.05,1,.05,0x30343b,lx,.5,z+side*(depth/2-.1)))}
}
function deskPlant(parent,x,z){
  const pot=new THREE.Mesh(new THREE.CylinderGeometry(.09,.07,.14,10),mat(WHITE));pot.position.set(x,1.125,z);pot.castShadow=true;parent.add(pot)
  for(let i=0;i<6;i++){const a=i*1.05,leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(.075,0),mat(i%2?LEAF:0x3fa867));leaf.scale.set(.7,1.7,.7);leaf.position.set(x+Math.cos(a)*.07,1.27+(i%3)*.05,z+Math.sin(a)*.07);leaf.rotation.set(Math.sin(a)*.5,a,Math.cos(a)*.5);leaf.castShadow=true;parent.add(leaf)}
}
const BOOK_COLORS=[0xa33d2e,0x274f7d,0xc08a2b,0x2f6b52,0x5a3f7a,0x2b2f36]
let pageMaterial=null
function book(parent,x,y,z,width,depth,thick,color,turn){
  pageMaterial=pageMaterial||new THREE.MeshLambertMaterial({map:paintTex(32,32,(g,w,h)=>{g.fillStyle='#f3eee2';g.fillRect(0,0,w,h);g.fillStyle='#d9d2c1';for(let i=2;i<h;i+=3)g.fillRect(0,i,w,1)})})
  const volume=new THREE.Group();volume.position.set(x,y,z);volume.rotation.y=turn;parent.add(volume)
  const cover=.007
  box(volume,width,cover,depth,color,0,-thick/2+cover/2,0);box(volume,width,cover,depth,color,0,thick/2-cover/2,0)
  box(volume,.009,thick,depth,color,-width/2+.0045,0,0)
  box(volume,width-.022,thick-cover*2,depth-.012,pageMaterial,.004,0,0)
  box(volume,width*.42,.001,depth*.09,0xe9dfc8,0,thick/2+.0006,-depth*.22)
}
function folders(parent,x,z,seed){
  let y=1.056
  for(let i=0,n=2+seed%3;i<n;i++){const thick=.028+((seed>>>i)%3)*.012;book(parent,x+(i%2?.012:-.008),y+thick/2,z+(i%2?-.01:.006),.26-(i%2)*.02,.34-(i%3)*.012,thick,BOOK_COLORS[(seed+i*2)%6],(i%2?1:-1)*.06+(seed%5)*.02);y+=thick}
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
  const onBreak=people.filter(p=>p.isOnBreak).length
  if(idle.length||onBreak)spaces.push({kind:'lounge',people:idle,W:Math.max(9,(idle.length+onBreak)*2.3+3.6),D:7.8,breaks:onBreak})
  spaces.push({kind:'office',W:7.4,D:7})
  return spaces
}
function build(){
  scene.remove(world); world=new THREE.Group(); scene.add(world); actors=[]; tagsEl.innerHTML=''; tags=[]; spots={}; floors=[]; boards=[]
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
  meetingSeats=[];officeSpots=[];breakSeats=[];breakers=0
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
  const {W,D}=floorSize,ceilingRoom=(WALL_HEIGHT-1.2-home.center.y)/Math.sin(home.el)
  home.dist=Math.min(Math.max(14,Math.max(W,D)*.62),ceilingRoom)
  if(first){view.dist=home.dist;view.center.copy(home.center)}
}
function flat(w,d,c,x,y,z){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(c));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);m.receiveShadow=true;world.add(m);return m}
const WALK_SPEED=2.4, arrived=new Map()
let meetingSeats=[],officeSpots=[],breakSeats=[],visitors=0,breakers=0
const faceToward=(a,x,z)=>{a.g.rotation.y=Math.atan2(x-a.g.position.x,z-a.g.position.z)}
function startWalk(a){
  a.walkPending=false
  const p=a.p,toOffice=Boolean(p.request),toMeeting=!toOffice&&Boolean(p.meetingWith&&p.meetingWith.length)
  const target=toOffice?officeSpots[visitors++%Math.max(1,officeSpots.length)]:toMeeting?meetingSeats[visitors++%Math.max(1,meetingSeats.length)]:breakSeats[breakers++]
  if(!target)return
  const key=toOffice?`office:${p.request.id}`:toMeeting?`meeting:${[p.id,...p.meetingWith].sort().join()}`:`break:${p.jobs?.[0]}`
  const arrive=toOffice?'wave':'sit'
  a.visit={target,key,arrive,mug:!toOffice&&!toMeeting}
  if(arrived.get(p.id)===key){a.g.position.set(target.x,target.y||0,target.z);a.g.rotation.y=target.face;a.pose=arrive;a.holdsMug=a.visit.mug;return}
  a.pose='walk'
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
    if(!a.route.length){a.route=null;arrived.set(a.p.id,a.visit.key);a.g.rotation.y=a.visit.target.face;setPose(a,a.visit.arrive);if(a.visit.mug)giveMug(a)}
    return
  }
  a.g.rotation.y=Math.atan2(gap.x,gap.z);a.g.position.add(gap.setLength(step))
}
const wantsToWalk=p=>Boolean(p.request)||Boolean(p.meetingWith&&p.meetingWith.length)||Boolean(p.isOnBreak)
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
  g.fillStyle=UI.page;g.fillRect(0,0,W,H)
  // The team's own header, with the time and task progress on the right.
  const isTeam=team.members.length>1
  g.textBaseline='middle';g.textAlign='left';g.fillStyle=UI.text;g.font='600 28px Inter,sans-serif';g.fillText(fit(isTeam?`${lead.name}'s team`:lead.name,520),24,36)
  g.fillStyle=UI.muted;g.font='15px Inter,sans-serif';g.fillText(fit(`${lead.project} · ${lead.title}`,600),24,66)
  const updated=new Date()
  g.textAlign='right';g.fillStyle=UI.muted;g.font='13px Inter,sans-serif';g.fillText(`Live ${updated.getHours()}:${String(updated.getMinutes()).padStart(2,'0')}`,W-24,32)
  g.fillStyle=UI.working;g.beginPath();g.arc(W-24-g.measureText(`Live ${updated.getHours()}:${String(updated.getMinutes()).padStart(2,'0')}`).width-11,32,4,0,7);g.fill()
  const progress=live(lead).progress
  if(progress&&progress[1]){
    const [done,total]=progress
    g.fillStyle=UI.muted;g.font='13px Inter,sans-serif';g.fillText(`${done} of ${total} tasks`,W-158,62)
    g.fillStyle=UI.hover;roundRect(g,W-146,58,122,8,4);g.fill();if(done){g.fillStyle=UI.accent;roundRect(g,W-146,58,Math.max(8,122*done/total),8,4);g.fill()}
  }
  g.textAlign='left'
  // Section label.
  const margin=24,right=W-24,nameX=margin+50,pillX=268,workX=420,ageX=right-16
  g.fillStyle=UI.muted;g.font='500 13px Inter,sans-serif';g.fillText('Name',nameX,106);g.fillText('Status',pillX,106);g.fillText('Working on',workX,106)
  g.fillStyle=UI.line;g.fillRect(margin,122,right-margin,1)
  const rows=[...members].sort((a,b)=>statusOfRow(a).rank-statusOfRow(b).rank||(b.lastActivityAt||'').localeCompare(a.lastActivityAt||'')).slice(0,6)
  rows.forEach((p,i)=>{
    const top=123+i*54,y=top+27,status=statusOfRow(p),isIdle=status.rank===4
    if(p.id===lead.id){g.fillStyle=UI.soft;g.fillRect(margin,top+1,right-margin,52)}
    const face=faces.get(p.id)
    g.save();g.beginPath();g.arc(margin+22,y,17,0,7);g.clip();g.fillStyle=UI.hover;g.fillRect(margin+5,y-17,34,34);if(face)g.drawImage(face,margin+5,y-17,34,34);g.restore()
    g.fillStyle=isIdle?UI.muted:UI.text;g.font='600 16px Inter,sans-serif';g.fillText(fit(p.name,pillX-nameX-14),nameX,p.id===lead.id?y-8:y)
    if(p.id===lead.id){g.fillStyle=UI.faint;g.font='12px Inter,sans-serif';g.fillText('Lead',nameX,y+11)}
    g.font='500 13px Inter,sans-serif';const pillW=g.measureText(status.label).width+22
    g.fillStyle=status.bg;roundRect(g,pillX,y-12,pillW,24,12);g.fill();g.fillStyle=status.fg;g.fillText(status.label,pillX+11,y+.5)
    const doing=p.request?.message||p.jobs?.[0]||(p.isRunning?p.step||p.recent?.[p.recent.length-1]:'')||p.label||p.title
    const timing=p.isWaiting&&p.jobStartedAt?`${Math.max(1,Math.round((Date.now()/1000-p.jobStartedAt)/60))}m`:shortAge(p.lastActivityAt)
    g.fillStyle=isIdle?UI.muted:UI.text;g.font='14px Inter,sans-serif';g.fillText(fit(doing,right-workX-76),workX,y)
    g.textAlign='right';g.fillStyle=UI.faint;g.font='13px Inter,sans-serif';g.fillText(timing,ageX,y);g.textAlign='left'
    if(i<rows.length-1){g.fillStyle=UI.line;g.fillRect(margin,top+53,right-margin,1)}
  })
  if(members.length>6){g.fillStyle=UI.muted;g.font='13px Inter,sans-serif';g.textAlign='right';g.fillText(`+${members.length-6} more`,right,H-10);g.textAlign='left'}
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
  const texture=new THREE.CanvasTexture(canvas);texture.anisotropy=8
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
    const {team}=space,uniform=new THREE.Color(uniformOf(team.lead.project)),isTeam=team.members.length>1
    floors.push(Object.assign(flat(W,D,uniform.clone().lerp(new THREE.Color(0xffffff),.82).getHex(),cx,.02,cz),{spaceKey:key}))
    box(world,W,1.3,.09,WHITE,cx,.65,z0);box(world,.09,1.3,D,WHITE,x0,.65,cz)
    box(world,W,.09,.13,uniform.getHex(),cx,1.33,z0)
    if(isTeam){projector(team,x0,cz);spots[key].hasBoard=true}
    label(isTeam?`${team.lead.name}'s team · ${team.lead.project}`:`${team.lead.name} · ${team.lead.project}`)
    const columns=Math.ceil(team.members.length/2),isShared=team.members.length>1
    tableTop(world,cx,cz,columns*2.5+.15,isShared?2.24:1.16)
    if(isShared)box(world,columns*2.5,.09,.03,0xd9d6cf,cx,1.1,cz)
    team.members.forEach((p,i)=>{
      const col=Math.floor(i/2),row=i%2===0?-1:1,sx=cx-(columns-1)*1.25+col*2.5,deskZ=isShared?cz+row*.58:cz,seatZ=isShared?cz+row*1.44:cz+row*.88
      const screen=workstation(world,sx,deskZ,isShared?row:row,p.isRunning,p.id);chair(world,sx,seatZ,row)
      const a=seat(p,sx,seatZ,row===-1?0:Math.PI,front,p.isFinished?'wave':p.isWaiting?'sit':p.isRunning||p.helpers?.length||p.talkingTo?'work':'sit')
      attachScreen(a,screen);a.keyboard=new THREE.Vector3(sx,1.09,deskZ+row*KEYBOARD_OFFSET);addTag(a,isTeam&&p.id===team.lead.id);dress(a)
    })
  }
  if(kind==='lounge'){
    floors.push(Object.assign(flat(W,D,0xe6d8c4,cx,.02,cz),{spaceKey:key}));label('Lounge')
    couch(world,cx,cz-.1,W-1.2);box(world,W*.4,.3,1,WOOD,cx,.3,cz+2)
    const places=space.people.length+space.breaks,spotAt=i=>cx-(W-2.4)/2+(i+.5)*(W-2.4)/Math.max(1,places)
    space.people.forEach((p,i)=>{const a=seat(p,spotAt(i),cz+.08,0,front,'sit',-.1);addTag(a,false);dress(a)})
    breakSeats=Array.from({length:space.breaks},(_,i)=>({x:spotAt(space.people.length+i),z:cz+.08,face:0,y:-.1}))
    box(world,2.4,1.02,.75,WOOD,x0+W-1.5,.51,z0+.45);box(world,.42,.5,.38,CHARCOAL,x0+W-2.1,1.27,z0+.45);box(world,.26,.05,.2,SILVER,x0+W-2.1,1.08,z0+.58);coffee(world,x0+W-1.1,z0+.5,0);coffee(world,x0+W-.75,z0+.32,1)
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
    attachUsageScreen(desk(world,cx,cz-.5,1,true,'you'));chair(world,cx,cz-1.7,-1)
    ;[-1.2,0,1.2].forEach(dx=>officeSpots.push({x:cx+dx,z:cz+1.6,face:Math.PI}))
    plant(world,x0+W-.6,z0+.7,1.1)
    box(world,1.8,.8,.35,WOOD,x0+1.2,.4,z0+.28)
  }
}
function addZoneTag(name,x,z,key){const el=document.createElement('div');el.className='zone-tag';el.textContent=name;el.onclick=()=>onSpace(key);tagsEl.appendChild(el);tags.push({el,a:{g:{position:new THREE.Vector3(x,-2.65,z)},p:{id:null}},key,isZone:true})}
function addTag(a,isLead){const el=document.createElement('div');el.className='tag'+(isLead?' lead':'');const name=document.createElement('span');name.textContent=a.p.name;if(a.p.label){const job=document.createElement('em');job.textContent=' · '+a.p.label;name.appendChild(job)}el.appendChild(name);const count=a.p.helpers?.length||0;if(count||a.p.talkingTo){const badge=document.createElement('b');badge.className='call-badge';badge.textContent=count?`${count} helper${count>1?'s':''}`:'On a call';el.appendChild(badge)}if(a.p.isWaiting){const badge=document.createElement('b');badge.className='call-badge waiting';el.appendChild(badge);el.waitBadge=badge}if(a.p.isActing&&!a.p.request&&!a.p.meetingWith?.length){const thought=document.createElement('div');thought.className='thought';el.prepend(thought);el.thought=thought}else if(busy(a.p)){const say=document.createElement('div');say.className='say'+(a.p.request?' asks':a.p.isFinished?' done':'');say.textContent=a.p.request?a.p.request.message:a.p.meetingWith&&a.p.meetingWith.length?'In a meeting':a.p.isFinished?'Finished: '+a.p.title:a.p.jobs?.length?`Job running: ${a.p.jobs[0]}`:a.p.title;el.prepend(say)}el.title=a.p.title;el.onclick=()=>onPick(a.p.id);tagsEl.appendChild(el);tags.push({el,a,key:drawingKey})}
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
    if(a.route)walk(a,dt)
    if(a.p.id===selected&&!focusKey){marker.visible=true;marker.position.set(a.g.position.x,a.g.position.y+(a.pose==='wave'||a.pose==='walk'?2.95:2.4)+Math.sin(t*4)*.05,a.g.position.z);marker.rotation.y=t*2}
  })
  boards.forEach(board=>{if(t>board.nextDraw){board.nextDraw=t+4;drawBoard(board)};board.reflection.offset.x=view.az*.32+camera.position.z*.012})
  renderer.render(scene,camera)
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
    const sig=JSON.stringify(nextPeople.map(p=>[p.id,p.name,p.label,p.project,p.startedBy,p.title,p.isRunning,p.isFinished,p.avatar,p.startedBy,p.meetingWith,p.talkingTo,p.helpers,p.jobs,p.isWaiting,p.isOnBreak,p.request&&p.request.id]))
    people=nextPeople
    if(sig!==signature&&people.length){signature=sig;build()}
    usage=nextUsage;drawUsage()
  },
  dispose(){clearInterval(timer);observer.disconnect();renderer.dispose()},
}
}
