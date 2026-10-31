import * as THREE from 'three'

// The N64-style room. Everything else in the app is ordinary React.
export const sceneApi = { portrait: null }

export function createScene(stage, canvas, tagsEl, onPick) {
const PIXEL_SCALE = 3
const renderer = new THREE.WebGLRenderer({canvas, antialias:false})
renderer.setPixelRatio(1)
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
const EYE_T = pixelTex(16,g=>{g.clearRect(0,0,16,16);g.fillStyle='#fff';g.fillRect(2,2,5,9);g.fillRect(9,2,5,9);g.fillStyle='#17122a';g.fillRect(4,4,3,6);g.fillRect(9,4,3,6)})
const FACE = new THREE.MeshBasicMaterial({map:EYE_T,transparent:true,alphaTest:.5})

const SKINS=[0xffc99a,0xe8a678,0xb97748,0x7d4c2b,0xffdcc0]
const HAIRS=[0x2b1d3a,0xe0342c,0x7a3b12,0xffc824,0x1f7ad1,0x1fa24a,0xd23ba8,0xf08a24]

const UNIFORMS=[0xe0342c,0x2a5bd7,0x1fa24a,0xf08a24,0x8a4bd7,0x18a7a0,0xd23ba8,0x8b6b3d]
const hash=s=>[...String(s)].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7)
const uniformOf=project=>UNIFORMS[hash(project)%UNIFORMS.length]
// Each look number maps to a different mix of traits, so no two agents match.
function traitsOf(look){
  const n=((look||0)*1601+7)%4320
  return {style:n%6,hair:HAIRS[Math.floor(n/6)%8],extra:Math.floor(n/48)%6,build:Math.floor(n/288)%3,skin:SKINS[Math.floor(n/864)%5]}
}
function character(p,isLead){
  const g=new THREE.Group(), {style,hair,extra,build,skin}=traitsOf(p.look), shirt=uniformOf(p.project)
  const width=[1,1.18,.88][build], height=[1,.92,1.1][build]
  const torso=box(g,.74*width,.82*height,.5,shirt,0,.68+.41*height,0)
  const head=new THREE.Group(); head.position.y=.68+.82*height+.42; g.add(head)
  head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.47,1),mat(skin)))
  const eyes=new THREE.Mesh(new THREE.PlaneGeometry(.62,.62),FACE); eyes.position.set(0,-.03,.46); head.add(eyes)
  const blob=(r,sx,sy,sz,x,y,z,c=hair)=>{const m=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),mat(c));m.scale.set(sx,sy,sz);m.position.set(x,y,z);head.add(m);return m}
  if(style===0)blob(.52,1,.62,1,0,.2,-.06)
  if(style===1){blob(.72,1,.9,1,0,.28,-.14)}
  if(style===2)[[-.26,.1],[0,.1],[.26,.1],[-.14,-.18],[.14,-.18]].forEach(([x,z])=>{const c=new THREE.Mesh(new THREE.ConeGeometry(.15,.5,4),mat(hair));c.position.set(x,.5,z);head.add(c)})
  if(style===3){blob(.52,1,.55,1,0,.22,-.06);box(head,.82,.95,.2,hair,0,-.25,-.42)}
  if(style===4){blob(.52,1,.55,1,0,.22,-.06);blob(.24,1,1,1,0,.66,-.08)}
  if(style===5){box(head,.14,.34,.62,hair,0,.54,0)}
  if(extra===1){box(head,.72,.1,.04,0x17122a,0,0,.5);box(head,.26,.2,.03,0xbfe6ff,-.18,0,.5);box(head,.26,.2,.03,0xbfe6ff,.18,0,.5)}
  if(extra===2){const band=new THREE.Mesh(new THREE.TorusGeometry(.5,.05,5,10,Math.PI),mat(0x25253a));band.rotation.y=Math.PI/2;band.position.y=.08;head.add(band);box(head,.14,.34,.3,0xe0342c,-.5,.02,0);box(head,.14,.34,.3,0xe0342c,.5,.02,0)}
  if(extra===3)blob(.3,1.15,.65,.7,0,-.34,.24)
  if(extra===4&&!isLead){blob(.52,1,.52,1,0,.26,-.02,shirt);box(head,.56,.08,.42,shirt,0,.28,.44)}
  if(extra===5){const a=new THREE.Mesh(new THREE.ConeGeometry(.13,.26,4),mat(0xffc824));a.rotation.z=Math.PI/2;a.position.set(-.13,-.46,.3);head.add(a);const c=a.clone();c.rotation.z=-Math.PI/2;c.position.x=.13;head.add(c)}
  if(isLead){box(head,.44,.14,.44,0xffc824,0,.62,0);[[-.17,-.17],[.17,-.17],[-.17,.17],[.17,.17]].forEach(([x,z])=>box(head,.1,.18,.1,0xffc824,x,.76,z))}
  const shoulder=.68+.72*height
  const arm=(x)=>{const a=new THREE.Group();a.position.set(x,shoulder,0);box(a,.2,.72*height,.22,shirt,0,-.34,0);box(a,.2,.18,.22,skin,0,-.76*height,0);g.add(a);return a}
  const armL=arm(-.48*width), armR=arm(.48*width)
  const leg=(x)=>{const a=new THREE.Group();a.position.set(x,.68,0);box(a,.26,.62,.3,0x34416e,0,-.28,0);box(a,.28,.14,.42,0x2b1d3a,0,-.6,.06);g.add(a);return a}
  const legL=leg(-.2), legR=leg(.2)
  g.traverse(o=>{if(o.isMesh)o.userData.person=p})
  return {g,head,armL,armR,legL,legR,p,torso}
}
const PORTRAIT_SIZE=48
const portraitRenderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,alpha:true})
portraitRenderer.setPixelRatio(1);portraitRenderer.setSize(PORTRAIT_SIZE,PORTRAIT_SIZE,false)
const portraitCache=new Map()
function portrait(p){
  const key=`${p.look}|${uniformOf(p.project)}|${p.isLead?1:0}`
  if(portraitCache.has(key))return portraitCache.get(key)
  const stage=new THREE.Scene();stage.background=new THREE.Color(0xdcecf7)
  stage.add(new THREE.AmbientLight(0xfff2d8,.8));const light=new THREE.DirectionalLight(0xffffff,.6);light.position.set(3,6,8);stage.add(light)
  const {g,head}=character(p,p.isLead);stage.add(g)
  const lens=new THREE.PerspectiveCamera(30,1,.1,30);lens.position.set(.45,head.position.y+.2,3.9);lens.lookAt(0,head.position.y-.15,0)
  portraitRenderer.render(stage,lens)
  const url=portraitRenderer.domElement.toDataURL()
  portraitCache.set(key,url)
  return url
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


let people=[], selected=null, actors=[], tags=[], view={az:.72,el:.6,dist:30,center:new THREE.Vector3()}
function leadOf(p,byId){let l=p;const seen=new Set([p.id]);while(l.startedBy&&byId[l.startedBy]&&!seen.has(l.startedBy)){seen.add(l.startedBy);l=byId[l.startedBy]}return l}
function teamsIn(list){const byId=Object.fromEntries(people.map(p=>[p.id,p]));const m=new Map();list.forEach(p=>{const l=leadOf(p,byId);if(!m.has(l.id))m.set(l.id,{lead:l,members:[]});m.get(l.id).members.push(p)});return [...m.values()].map(t=>({...t,members:[t.lead,...t.members.filter(x=>x.id!==t.lead.id)]})).sort((a,b)=>(b.lead.lastActivityAt||'').localeCompare(a.lead.lastActivityAt||''))}
const busy=p=>p.isRunning||p.isFinished||Boolean(p.request)
const ZONE_WIDTH=15, AISLE=3
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
  const W=Math.max(14,...rows.map(rowW))+2, D=Math.max(10,rows.reduce((n,r)=>n+rowD(r),0)+(rows.length-1)*AISLE)+3
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,D),texMat(FLOOR_T(Math.ceil(Math.max(W,D)/2)))); floor.rotation.x=-Math.PI/2; world.add(floor)
  box(world,W+.6,.4,D+.6,0x6b3f1e,0,-.21,0)
  const H=6, back=-D/2, left=-W/2
  box(world,W,H,.3,texMat(WALL_T(W/2,H/2)),0,H/2,back-.15)
  box(world,.3,H,D,texMat(WALL_T(D/2,H/2)),left-.15,H/2,0)
  box(world,W,.8,.34,0x8e5a2c,0,.4,back-.13); box(world,.34,.8,D,0x8e5a2c,left-.13,.4,0)
  for(let i=0,n=Math.max(1,Math.floor(W/6));i<n;i++){const x=left+(i+.5)*W/n;box(world,3.1,2.3,.12,0xfff6d8,x,3.5,back+.03);box(world,2.8,2,.06,texMat(WINDOW_T),x,3.5,back+.1)}
  for(let i=0,n=Math.max(1,Math.floor(D/5));i<n;i++){const z=back+(i+.5)*D/n;box(world,.08,2,1.6,texMat(POSTER_T[i%3]),left+.05,3.5,z)}
  plant(world,left+.8,back+.8); plant(world,-left-.8,back+.8)
  let z0=back+2.2
  rows.forEach(row=>{
    let x0=left+1
    row.forEach(zone=>{drawZone(zone,x0,z0,zones.indexOf(zone));x0+=zone.W+AISLE})
    z0+=rowD(row)+AISLE
  })
  view.center.set(0,1,0); view.dist=Math.max(W,D)*1.3+7
}
function flat(w,d,c,x,y,z){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(c));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);world.add(m)}
function drawZone(zone,x0,z0,index){
  const uniform=new THREE.Color(uniformOf(zone.name)),edge=uniform.clone().lerp(new THREE.Color(0xffffff),.35).getHex(),fill=uniform.clone().lerp(new THREE.Color(0xffffff),.62).getHex()
  addZoneTag(zone.name,x0+zone.W/2,z0-.3)
  zone.placed.forEach(({t,x,z,w,d})=>{
    const px=x0+.5+x+w/2,pz=z0+z+d/2+.2
    flat(w,d,edge,px,.02,pz);flat(w-.4,d-.4,fill,px,.03,pz)
    t.members.forEach((p,i)=>{
      const col=Math.floor(i/2),row=i%2===0?-1:1,sx=px-w/2+.6+col*2.5+1.25,deskZ=pz+row*.56,seatZ=pz+row*1.72
      desk(world,sx,deskZ,row,p.isRunning);chair(world,sx,seatZ,row)
      const a=character(p,p.id===t.lead.id&&t.members.length>1);a.pose=p.request||p.isFinished?'done':p.isRunning?'work':'desk';a.g.position.set(sx,0,seatZ);a.g.rotation.y=row===-1?0:Math.PI;a.dir=row;seated(a,a.pose!=='done');world.add(a.g);actors.push(a);addTag(a,p.id===t.lead.id&&t.members.length>1)
    })
  })
  if(zone.lounge.length){
    const lz=z0+zone.podsD+(zone.placed.length?.8:0)+2.4,lx=x0+.5+zone.lw/2
    flat(zone.lw,4.2,0x7fb389,lx,.02,lz)
    couch(world,lx,lz-1,zone.lw-1.2)
    zone.lounge.forEach((p,i)=>{const sx=lx-(zone.lw-2)/2+(i+.5)*(zone.lw-2)/zone.lounge.length,a=character(p,false);a.pose='lounge';a.g.position.set(sx,-.02,lz-.82);a.dir=1;seated(a,true);world.add(a.g);actors.push(a);addTag(a,false)})
  }
}
function addZoneTag(name,x,z){const el=document.createElement('div');el.className='zone-tag';el.textContent=name;tagsEl.appendChild(el);tags.push({el,a:{g:{position:new THREE.Vector3(x,-2.9,z)},p:{id:null}}})}
function seated(a,on){a.legL.rotation.x=a.legR.rotation.x=on?-1.45:0;a.g.children[0].position.y=1.08;a.g.position.y=on?-.12:0}
function addTag(a,isLead){const el=document.createElement('div');el.className='tag'+(isLead?' lead':'');const name=document.createElement('span');name.textContent=a.p.name;if(a.p.label){const job=document.createElement('em');job.textContent=' · '+a.p.label;name.appendChild(job)}el.appendChild(name);if(busy(a.p)){const say=document.createElement('div');say.className='say'+(a.p.request?' asks':a.p.isFinished?' done':'');say.textContent=a.p.request?a.p.request.message:a.p.isFinished?'Finished: '+a.p.title:a.p.title;el.prepend(say)}el.title=a.p.title;el.onclick=()=>onPick(a.p.id);tagsEl.appendChild(el);tags.push({el,a})}
let tab='chat',chatTimer=null

function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(Math.max(1,Math.floor(w/PIXEL_SCALE)),Math.max(1,Math.floor(h/PIXEL_SCALE)),false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix()}
const observer=new ResizeObserver(resize);observer.observe(stage);resize()
let drag=null,moved=false
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,az:view.az,el:view.el};moved=false;canvas.setPointerCapture(e.pointerId)})
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;view.az=Math.min(1.35,Math.max(.1,drag.az-dx*.005));view.el=Math.min(1.25,Math.max(.35,drag.el+dy*.004))})
canvas.addEventListener('pointerup',e=>{drag=null;if(moved)return;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},camera);const hit=ray.intersectObjects(actors.map(a=>a.g),true)[0];if(hit&&hit.object.userData.person)onPick(hit.object.userData.person.id)})
canvas.addEventListener('wheel',e=>{e.preventDefault();view.dist=Math.min(70,Math.max(10,view.dist+e.deltaY*.02))},{passive:false})
const marker=new THREE.Mesh(new THREE.ConeGeometry(.32,.6,4),glow(0xffc824));marker.rotation.x=Math.PI;scene.add(marker)
const bang=[];const v=new THREE.Vector3(),clock=new THREE.Clock()
function loop(){const t=clock.getElapsedTime()
  const fit=view.dist*Math.max(1,1.2/camera.aspect)
  scene.fog.near=fit+14;scene.fog.far=fit+50
  camera.position.set(view.center.x+Math.sin(view.az)*Math.cos(view.el)*fit,view.center.y+Math.sin(view.el)*fit,view.center.z+Math.cos(view.az)*Math.cos(view.el)*fit);camera.lookAt(view.center)
  marker.visible=false
  actors.forEach((a,i)=>{const ph=t*7+i
    if(a.pose==='work'){a.armL.rotation.x=-1.25+Math.sin(ph*1.6)*.16;a.armR.rotation.x=-1.25-Math.sin(ph*1.6)*.16;a.head.rotation.x=.12+Math.sin(t*2+i)*.04}
    else if(a.pose==='done'){a.armR.rotation.x=Math.PI;a.armR.rotation.z=Math.sin(ph)*.25;a.armL.rotation.x=0;a.g.position.y=Math.abs(Math.sin(t*5+i))*.28}
    else if(a.pose==='lounge'){a.armL.rotation.x=-.5;a.armR.rotation.x=-.5;a.head.rotation.y=Math.sin(t*.5+i)*.5}
    else{a.armL.rotation.x=-1;a.armR.rotation.x=-1;a.head.rotation.y=Math.sin(t*.45+i*2)*.45}
    if(a.p.id===selected){marker.visible=true;marker.position.set(a.g.position.x,a.g.position.y+3.5+Math.sin(t*4)*.12,a.g.position.z);marker.rotation.y=t*2}
  })
  renderer.render(scene,camera)
  const w=stage.clientWidth,h=stage.clientHeight
  tags.forEach(({el,a})=>{v.set(a.g.position.x,a.g.position.y+3,a.g.position.z).project(camera);el.style.left=((v.x+1)/2*w)+'px';el.style.top=((1-v.y)/2*h)+'px';el.classList.toggle('on',a.p.id===selected)})
}
const timer=setInterval(loop,33)
let signature=''
sceneApi.portrait=portrait
return {
  update(nextPeople,nextSelected){
    selected=nextSelected
    const sig=JSON.stringify(nextPeople.map(p=>[p.id,p.name,p.label,p.look,p.project,p.startedBy,p.title,p.isRunning,p.isFinished,p.request&&p.request.id]))
    people=nextPeople
    if(sig!==signature&&people.length){signature=sig;build()}
  },
  portrait,
  dispose(){clearInterval(timer);observer.disconnect();renderer.dispose()},
}
}
