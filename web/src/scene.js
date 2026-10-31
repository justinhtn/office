import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js'

const cloneSkinned = model => SkeletonUtils.clone(model)

const AVATARS = '/assets/avatars'
export const CAST = [...['01','02','03','04','05','06','07','08'].map(n => `Female_Adult_${n}`), ...['01','02','03','04','05','06','07','08'].map(n => `Male_Adult_${n}`)]
const UNIFORMS = [0xe0342c,0x2a5bd7,0x1fa24a,0xf08a24,0x8a4bd7,0x18a7a0,0xd23ba8,0x8b6b3d]
const nameHash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const uniformOf = project => UNIFORMS[nameHash(project) % UNIFORMS.length]
const MODEL_SCALE = .0122
const CLIPS = { sit: 'sit_chair_idle_neutral_01', work: 'work_table', stand: 'idle_neutral_01', wave: 'wave_01', walk: 'walk_neutral' }
const castOf = p => CAST[p.cast ?? ((p.look || 0) % CAST.length)]
const sexOf = id => (id.startsWith('Female') ? 'f' : 'm')
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
        const list = Array.isArray(o.material) ? o.material : [o.material]
        const made = list.map(old => {
          const see = /_opacity$/.test(old.name)
          const map = textures.load(`${AVATARS}/${id}/${old.name}_color.${see ? 'png' : 'jpg'}`)
          map.anisotropy = 4
          return new THREE.MeshLambertMaterial({ map, skinning: true, side: see ? THREE.DoubleSide : THREE.FrontSide, alphaTest: see ? .4 : 0 })
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
export function createScene(stage, canvas, tagsEl, onPick) {
const renderer = new THREE.WebGLRenderer({canvas, antialias:true})
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x7ec8f0)
scene.fog = new THREE.Fog(0x7ec8f0, 30, 75)
const camera = new THREE.PerspectiveCamera(32, 1, .1, 200)
scene.add(new THREE.AmbientLight(0xfff2d8, .72))
const sun = new THREE.DirectionalLight(0xffffff, .62); sun.position.set(8, 16, 10); scene.add(sun)
let world = new THREE.Group(); scene.add(world)

const mats = {}
const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({color:c, flatShading:true}))
const glow = c => mats['g'+c] || (mats['g'+c] = new THREE.MeshBasicMaterial({color:c, fog:false}))
function box(parent,w,h,d,c,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),typeof c==='number'?mat(c):c);m.position.set(x,y,z);parent.add(m);return m}
function pixelTex(size,draw,rx=1,ry=1){const k=document.createElement('canvas');k.width=k.height=size;draw(k.getContext('2d'),size);const t=new THREE.CanvasTexture(k);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);return t}
const texMat = t => new THREE.MeshLambertMaterial({map:t})
const FLOOR_T = rx => pixelTex(16,(g,s)=>{g.fillStyle='#b5763c';g.fillRect(0,0,s,s);g.fillStyle='#c98a4b';g.fillRect(0,0,8,8);g.fillRect(8,8,8,8);g.fillStyle='#9c6230';g.fillRect(0,7,16,1);g.fillRect(7,0,1,16);g.fillRect(0,15,16,1);g.fillRect(15,0,1,16)},rx,rx)
const WALL_T = (rx,ry) => pixelTex(16,(g,s)=>{g.fillStyle='#f4dfae';g.fillRect(0,0,s,s);g.fillStyle='#ecd09a';for(let i=0;i<16;i+=4)g.fillRect(i,0,1,16)},rx,ry)
const WINDOW_T = pixelTex(32,(g)=>{g.fillStyle='#7ed0ff';g.fillRect(0,0,32,32);g.fillStyle='#fff';g.fillRect(4,5,9,3);g.fillRect(20,9,7,2);g.fillStyle='#5aa058';g.beginPath();g.moveTo(0,26);g.lineTo(9,13);g.lineTo(18,26);g.moveTo(10,26);g.lineTo(22,10);g.lineTo(32,26);g.fill();g.fillStyle='#3c82c8';g.fillRect(0,26,32,6);g.fillStyle='#e0542c';g.fillRect(0,22,32,1);for(let i=2;i<32;i+=6)g.fillRect(i,18,1,8)})
const POSTER_T = [['#e0342c','#ffc824'],['#2a5bd7','#fff6d8'],['#1fa24a','#ffc824']].map(([a,b])=>pixelTex(16,g=>{g.fillStyle=a;g.fillRect(0,0,16,16);g.fillStyle=b;g.beginPath();g.arc(8,7,5,0,7);g.fill();g.fillStyle='#2b1d3a';g.fillRect(3,13,10,1)}))


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
function plant(parent,x,z){box(parent,.7,.6,.7,0xc65a2c,x,.3,z);for(let i=0;i<5;i++){const a=i*1.26,l=new THREE.Mesh(new THREE.IcosahedronGeometry(.42,0),mat(0x2e9e4a));l.position.set(x+Math.cos(a)*.3,1+i*.17,z+Math.sin(a)*.3);parent.add(l)}}
function desk(parent,x,z,dir,isOn){
  box(parent,1.9,.14,1.05,0xd8a45f,x,1.02,z)
  ;[[-.8,-.42],[.8,-.42],[-.8,.42],[.8,.42]].forEach(([a,b])=>box(parent,.1,1,.1,0x2b1d3a,x+a,.5,z+b))
  box(parent,.74,.06,.5,0xc4c9d6,x,1.12,z+dir*.03)
  const scr=box(parent,.74,.5,.05,isOn?glow(0x5de2ff):mat(0x41465e),x,1.38,z-dir*.24)
  box(parent,.8,.56,.03,0xc4c9d6,x,1.38,z-dir*.27)
  box(parent,.18,.22,.18,0xe0342c,x+.7,1.2,z-dir*.25)
}
function chair(parent,x,z,dir){box(parent,.78,.12,.78,0x3f8f73,x,.66,z);box(parent,.78,.82,.12,0x3f8f73,x,1.08,z+dir*.39);box(parent,.12,.62,.12,0x2b1d3a,x,.32,z)}
function couch(parent,x,z,w){box(parent,w,.46,1,0x3f8f73,x,.42,z);box(parent,w,.8,.28,0x35795f,x,.82,z-.42);box(parent,.26,.62,1,0x35795f,x-w/2,.5,z);box(parent,.26,.62,1,0x35795f,x+w/2,.5,z)}


let people=[], selected=null, actors=[], tags=[], view={az:.72,el:.6,dist:30,zoom:0,center:new THREE.Vector3()}
function leadOf(p,byId){let l=p;const seen=new Set([p.id]);while(l.startedBy&&byId[l.startedBy]&&!seen.has(l.startedBy)){seen.add(l.startedBy);l=byId[l.startedBy]}return l}
function teamsIn(list){const byId=Object.fromEntries(people.map(p=>[p.id,p]));const m=new Map();list.forEach(p=>{const l=leadOf(p,byId);if(!m.has(l.id))m.set(l.id,{lead:l,members:[]});m.get(l.id).members.push(p)});return [...m.values()].map(t=>({...t,members:[t.lead,...t.members.filter(x=>x.id!==t.lead.id)]})).sort((a,b)=>(b.lead.lastActivityAt||'').localeCompare(a.lead.lastActivityAt||''))}
const busy=p=>p.isRunning||p.isFinished||Boolean(p.request)
const ZONE_WIDTH=15, AISLE=1.6, WALL_HEIGHT=4.6
function layoutZone(list){
  const teams=teamsIn(list), pods=teams.filter(t=>t.members.length>1||busy(t.lead)), lounge=teams.filter(t=>!pods.includes(t)).map(t=>t.lead)
  let cx=0,cz=0,rowD=0,width=0; const placed=[]
  pods.forEach(t=>{const cols=Math.ceil(t.members.length/2),w=cols*2.5+1.2,d=6.4;if(cx+w>ZONE_WIDTH&&cx>0){cx=0;cz+=rowD+.8;rowD=0}placed.push({t,x:cx,z:cz,w,d});cx+=w+.8;rowD=Math.max(rowD,d);width=Math.max(width,cx-.8)})
  const podsD=placed.length?cz+rowD:0, lw=lounge.length?Math.max(5,lounge.length*2.3+1):0, ld=lounge.length?5:0
  return {placed,lounge,lw,ld,podsD,W:Math.max(9,width+1,lw+1),D:podsD+ld+(placed.length&&ld?.8:0)+1.6}
}
function build(){
  scene.remove(world); world=new THREE.Group(); scene.add(world); actors=[]; tagsEl.innerHTML=''; tags=[]
  const names=[...new Set(people.map(p=>p.project))]
  const zones=names.map(name=>({name,...layoutZone(people.filter(p=>p.project===name))}))
  const perRow=Math.max(1,Math.round(Math.sqrt(zones.length)))
  const rows=[];zones.forEach((z,i)=>{const r=Math.floor(i/perRow);(rows[r]=rows[r]||[]).push(z)})
  const rowW=row=>row.reduce((n,z)=>n+z.W,0)+(row.length-1)*AISLE, rowD=row=>Math.max(...row.map(z=>z.D))
  const W=Math.max(14,...rows.map(rowW))+1.4, D=Math.max(10,rows.reduce((n,r)=>n+rowD(r),0)+(rows.length-1)*AISLE)+3+YOUR_BAND
  visitors=0
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,D),texMat(FLOOR_T(Math.ceil(Math.max(W,D)/2)))); floor.rotation.x=-Math.PI/2; world.add(floor)
  box(world,W+.6,.4,D+.6,0x6b3f1e,0,-.21,0)
  const H=WALL_HEIGHT, back=-D/2, left=-W/2
  floorSize={W,D}
  box(world,W,H,.3,texMat(WALL_T(W/2,H/2)),0,H/2,back-.15)
  box(world,.3,H,D,texMat(WALL_T(D/2,H/2)),left-.15,H/2,0)
  box(world,W,.8,.34,0x8e5a2c,0,.4,back-.13); box(world,.34,.8,D,0x8e5a2c,left-.13,.4,0)
  for(let i=0,n=Math.max(1,Math.floor(W/6));i<n;i++){const x=left+(i+.5)*W/n;box(world,3.1,2.3,.12,0xfff6d8,x,2.8,back+.03);box(world,2.8,2,.06,texMat(WINDOW_T),x,2.8,back+.1)}
  for(let i=0,n=Math.max(1,Math.floor(D/5));i<n;i++){const z=back+(i+.5)*D/n;box(world,.08,2,1.6,texMat(POSTER_T[i%3]),left+.05,2.8,z)}
  plant(world,left+.8,back+.8); plant(world,-left-.8,back+.8)
  let z0=back+1.5
  rows.forEach(row=>{
    let x0=left+1
    row.forEach(zone=>{drawZone(zone,x0,z0,zones.indexOf(zone));x0+=zone.W+AISLE})
    z0+=rowD(row)+AISLE
  })
  yourDesk.set(W/2-3.2,0,D/2-2.4)
  flat(5.4,4,0xe9dcc3,yourDesk.x,.025,yourDesk.z)
  desk(world,yourDesk.x,yourDesk.z-.1,1,true);chair(world,yourDesk.x,yourDesk.z+1,1)
  addZoneTag('Your desk',yourDesk.x,yourDesk.z+2.2)
  actors.filter(a=>a.walkPending).forEach(startWalk)
  view.center.set(0,.6,0); fitDirty=true
}
let fitDirty=true,floorSize={W:20,D:20}
// The closest camera distance that still shows the whole floor and back walls.
function fitCamera(){
  fitDirty=false
  const {W,D}=floorSize,corners=[]
  ;[-W/2,W/2].forEach(x=>[-D/2,D/2].forEach(z=>[0,z<0||x<0?WALL_HEIGHT:0].forEach(y=>corners.push(new THREE.Vector3(x,y,z)))))
  const point=new THREE.Vector3()
  for(let d=8;d<140;d+=.5){
    camera.position.set(view.center.x+Math.sin(view.az)*Math.cos(view.el)*d,view.center.y+Math.sin(view.el)*d,view.center.z+Math.cos(view.az)*Math.cos(view.el)*d)
    camera.lookAt(view.center);camera.updateMatrixWorld()
    if(corners.every(c=>{point.copy(c).project(camera);return Math.abs(point.x)<=.97&&Math.abs(point.y)<=.95})){view.dist=d;return}
  }
}
function flat(w,d,c,x,y,z){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(c));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);world.add(m)}
const YOUR_BAND=3.2, WALK_SPEED=2.2, yourDesk=new THREE.Vector3(), arrived=new Map()
let visitors=0
function comeToDesk(a){a.walkPending=true}
function startWalk(a){
  a.walkPending=false
  const spot=new THREE.Vector3(yourDesk.x-2+visitors*1.1,0,yourDesk.z-1.4);visitors++
  if(arrived.get(a.p.id)===a.p.request.id){a.g.position.copy(spot);a.g.rotation.y=Math.atan2(yourDesk.x-spot.x,yourDesk.z-spot.z);a.pose='wave';return}
  a.pose='walk';a.route=[new THREE.Vector3(spot.x,0,a.g.position.z),spot]
}
function walk(a,dt){
  const target=a.route[0],gap=target.clone().sub(a.g.position);gap.y=0
  const step=WALK_SPEED*dt
  if(gap.length()<=step){a.g.position.copy(target);a.route.shift();if(!a.route.length){a.route=null;arrived.set(a.p.id,a.p.request.id);a.g.rotation.y=Math.atan2(yourDesk.x-a.g.position.x,yourDesk.z-a.g.position.z);setPose(a,'wave')}return}
  a.g.rotation.y=Math.atan2(gap.x,gap.z);a.g.position.add(gap.setLength(step))
}
function drawZone(zone,x0,z0,index){
  const uniform=new THREE.Color(uniformOf(zone.name)),edge=uniform.clone().lerp(new THREE.Color(0xffffff),.35).getHex(),fill=uniform.clone().lerp(new THREE.Color(0xffffff),.62).getHex()
  addZoneTag(zone.name,x0+zone.W/2,z0-.3)
  zone.placed.forEach(({t,x,z,w,d})=>{
    const px=x0+.5+x+w/2,pz=z0+z+d/2+.2
    flat(w,d,edge,px,.02,pz);flat(w-.4,d-.4,fill,px,.03,pz)
    t.members.forEach((p,i)=>{
      const col=Math.floor(i/2),row=i%2===0?-1:1,sx=px-w/2+.6+col*2.5+1.25,deskZ=pz+row*.56,seatZ=pz+row*1.72
      desk(world,sx,deskZ,row,p.isRunning);chair(world,sx,seatZ,row)
      const a=character(p);a.pose=p.isFinished?'wave':p.isRunning?'work':'sit';a.seat={x:sx,z:seatZ,rotation:row===-1?0:Math.PI};a.g.position.set(sx,0,seatZ);a.g.rotation.y=a.seat.rotation;world.add(a.g);actors.push(a);addTag(a,p.id===t.lead.id&&t.members.length>1);dress(a);if(p.request)comeToDesk(a)
    })
  })
  if(zone.lounge.length){
    const lz=z0+zone.podsD+(zone.placed.length?.8:0)+2.4,lx=x0+.5+zone.lw/2
    flat(zone.lw,4.2,0x7fb389,lx,.02,lz)
    couch(world,lx,lz-1,zone.lw-1.2)
    zone.lounge.forEach((p,i)=>{const sx=lx-(zone.lw-2)/2+(i+.5)*(zone.lw-2)/zone.lounge.length,a=character(p);a.pose='sit';a.seat={x:sx,z:lz-.82,rotation:0};a.g.position.set(sx,-.1,lz-.82);world.add(a.g);actors.push(a);addTag(a,false);dress(a);if(p.request)comeToDesk(a)})
  }
}
function addZoneTag(name,x,z){const el=document.createElement('div');el.className='zone-tag';el.textContent=name;tagsEl.appendChild(el);tags.push({el,a:{g:{position:new THREE.Vector3(x,-2.65,z)},p:{id:null}}})}
function addTag(a,isLead){const el=document.createElement('div');el.className='tag'+(isLead?' lead':'');const name=document.createElement('span');name.textContent=a.p.name;if(a.p.label){const job=document.createElement('em');job.textContent=' · '+a.p.label;name.appendChild(job)}el.appendChild(name);if(busy(a.p)){const say=document.createElement('div');say.className='say'+(a.p.request?' asks':a.p.isFinished?' done':'');say.textContent=a.p.request?a.p.request.message:a.p.isFinished?'Finished: '+a.p.title:a.p.title;el.prepend(say)}el.title=a.p.title;el.onclick=()=>onPick(a.p.id);tagsEl.appendChild(el);tags.push({el,a})}
let tab='chat',chatTimer=null

function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(Math.max(1,w),Math.max(1,h),false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();fitDirty=true}
const observer=new ResizeObserver(resize);observer.observe(stage);resize()
let drag=null,moved=false
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,az:view.az,el:view.el};moved=false;canvas.setPointerCapture(e.pointerId)})
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;view.az=Math.min(1.35,Math.max(.1,drag.az-dx*.005));view.el=Math.min(1.25,Math.max(.35,drag.el+dy*.004))})
canvas.addEventListener('pointerup',e=>{drag=null;if(moved)return;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},camera);const hit=ray.intersectObjects(actors.map(a=>a.g),true)[0];if(hit&&hit.object.userData.person)onPick(hit.object.userData.person.id)})
canvas.addEventListener('wheel',e=>{e.preventDefault();view.zoom=Math.min(40,Math.max(-view.dist+6,view.zoom+e.deltaY*.02))},{passive:false})
const marker=new THREE.Mesh(new THREE.ConeGeometry(.32,.6,4),glow(0xffc824));marker.rotation.x=Math.PI;scene.add(marker)
let lastTick=0;const v=new THREE.Vector3(),clock=new THREE.Clock()
function loop(){const t=clock.getElapsedTime()
  if(fitDirty)fitCamera()
  const fit=view.dist+view.zoom
  scene.fog.near=fit+14;scene.fog.far=fit+50
  camera.position.set(view.center.x+Math.sin(view.az)*Math.cos(view.el)*fit,view.center.y+Math.sin(view.el)*fit,view.center.z+Math.cos(view.az)*Math.cos(view.el)*fit);camera.lookAt(view.center)
  marker.visible=false
  const dt=Math.min(.1,t-lastTick);lastTick=t
  actors.forEach(a=>{
    if(a.mixer)a.mixer.update(dt)
    if(a.route)walk(a,dt)
    if(a.p.id===selected){marker.visible=true;marker.position.set(a.g.position.x,a.g.position.y+3.2+Math.sin(t*4)*.12,a.g.position.z);marker.rotation.y=t*2}
  })
  renderer.render(scene,camera)
  const w=stage.clientWidth,h=stage.clientHeight
  tags.forEach(({el,a})=>{v.set(a.g.position.x,a.g.position.y+2.75,a.g.position.z).project(camera);el.style.left=((v.x+1)/2*w)+'px';el.style.top=((1-v.y)/2*h)+'px';el.classList.toggle('on',a.p.id===selected)})
}
const timer=setInterval(loop,33)
let signature=''
return {
  update(nextPeople,nextSelected){
    selected=nextSelected
    const sig=JSON.stringify(nextPeople.map(p=>[p.id,p.name,p.label,p.look,p.project,p.startedBy,p.title,p.isRunning,p.isFinished,p.cast,p.request&&p.request.id]))
    people=nextPeople
    if(sig!==signature&&people.length){signature=sig;build()}
  },
  dispose(){clearInterval(timer);observer.disconnect();renderer.dispose()},
}
}
