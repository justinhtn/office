import * as THREE from 'three'

// The N64-style room. Everything else in the app is ordinary React.
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
const SHIRTS=[0xe0342c,0x2a5bd7,0x1fa24a,0xffc824,0x8a4bd7,0xf08a24,0x18a7a0]
const hash=s=>[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7)

function character(p,isLead){
  const h=hash(p.id), g=new THREE.Group(), skin=SKINS[h%5], hair=HAIRS[(h>>>3)%8], shirt=SHIRTS[(h>>>6)%7]
  box(g,.74,.82,.5,shirt,0,1.08,0)
  const head=new THREE.Group(); head.position.y=1.92; g.add(head)
  const skull=new THREE.Mesh(new THREE.IcosahedronGeometry(.47,1),mat(skin)); head.add(skull)
  const cap=new THREE.Mesh(new THREE.IcosahedronGeometry(.52,1),mat(hair)); cap.scale.set(1,.62,1); cap.position.set(0,.2,-.06); head.add(cap)
  const eyes=new THREE.Mesh(new THREE.PlaneGeometry(.62,.62),FACE); eyes.position.set(0,-.03,.46); head.add(eyes)
  if(isLead){box(head,.44,.14,.44,0xffc824,0,.56,0);[[-.17,-.17],[.17,-.17],[-.17,.17],[.17,.17]].forEach(([x,z])=>box(head,.1,.18,.1,0xffc824,x,.7,z))}
  const arm=(x)=>{const a=new THREE.Group();a.position.set(x,1.42,0);box(a,.2,.72,.22,shirt,0,-.34,0);box(a,.2,.18,.22,skin,0,-.76,0);g.add(a);return a}
  const armL=arm(-.48), armR=arm(.48)
  const leg=(x)=>{const a=new THREE.Group();a.position.set(x,.68,0);box(a,.26,.62,.3,0x34416e,0,-.28,0);box(a,.28,.14,.42,0x2b1d3a,0,-.6,.06);g.add(a);return a}
  const legL=leg(-.2), legR=leg(.2)
  g.traverse(o=>{if(o.isMesh)o.userData.person=p})
  return {g,head,armL,armR,legL,legR,p}
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


let people=[], room=null, selected=null, actors=[], tags=[], view={az:.72,el:.6,dist:30,center:new THREE.Vector3()}
function leadOf(p,byId){let l=p;const seen=new Set([p.id]);while(l.startedBy&&byId[l.startedBy]&&!seen.has(l.startedBy)){seen.add(l.startedBy);l=byId[l.startedBy]}return l}
function teamsIn(list){const byId=Object.fromEntries(people.map(p=>[p.id,p]));const m=new Map();list.forEach(p=>{const l=leadOf(p,byId);if(!m.has(l.id))m.set(l.id,{lead:l,members:[]});m.get(l.id).members.push(p)});return [...m.values()].map(t=>({...t,members:[t.lead,...t.members.filter(x=>x.id!==t.lead.id)]})).sort((a,b)=>(b.lead.lastActivityAt||'').localeCompare(a.lead.lastActivityAt||''))}
const busy=p=>p.isRunning||p.isFinished
function build(){
  scene.remove(world); world=new THREE.Group(); scene.add(world); actors=[]; tagsEl.innerHTML=''; tags=[]
  const list=people.filter(p=>p.project===room), teams=teamsIn(list)
  const pods=teams.filter(t=>t.members.length>1||busy(t.lead)), lounge=teams.filter(t=>!pods.includes(t)).map(t=>t.lead)
  const maxW=17; let cx=0,cz=0,rowD=0,totalW=0; const placed=[]
  pods.forEach(t=>{const cols=Math.ceil(t.members.length/2),w=cols*2.5+1.2,d=6.4;if(cx+w>maxW&&cx>0){cx=0;cz+=rowD+.8;rowD=0}placed.push({t,x:cx,z:cz,w,d,cols});cx+=w+.8;rowD=Math.max(rowD,d);totalW=Math.max(totalW,cx)})
  const podsD=placed.length?cz+rowD:0, lw=Math.max(8,lounge.length*2.3+1), ld=lounge.length?5.4:0
  const W=Math.max(13,totalW+1.5,lw+2), D=Math.max(9.5,podsD+ld+(placed.length&&ld?1:0)+2.6)
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,D),texMat(FLOOR_T(Math.ceil(Math.max(W,D)/2)))); floor.rotation.x=-Math.PI/2; world.add(floor)
  box(world,W+.6,.4,D+.6,0x6b3f1e,0,-.21,0)
  const H=6, back=-D/2, left=-W/2
  const wallB=box(world,W,H,.3,texMat(WALL_T(W/2,H/2)),0,H/2,back-.15)
  const wallL=box(world,.3,H,D,texMat(WALL_T(D/2,H/2)),left-.15,H/2,0)
  box(world,W,.8,.34,0x8e5a2c,0,.4,back-.13); box(world,.34,.8,D,0x8e5a2c,left-.13,.4,0)
  for(let i=0,n=Math.floor(W/6);i<n;i++){const x=left+(i+.5)*W/n;box(world,3.1,2.3,.12,0xfff6d8,x,3.5,back+.03);box(world,2.8,2,.06,texMat(WINDOW_T),x,3.5,back+.1)}
  for(let i=0,n=Math.max(1,Math.floor(D/5));i<n;i++){const z=back+(i+.5)*D/n;box(world,.08,2,1.6,texMat(POSTER_T[i%3]),left+.05,3.5,z)}
  plant(world,left+1,back+1); plant(world,-left-1,back+1)
  box(world,1.4,3,1,0xe8e8f0,left+2.8,1.5,back+.6); box(world,1.1,2,.05,glow(0x9fd6ff),left+2.8,1.8,back+1.12)

  const ox=-W/2+1, oz=back+2.2
  placed.forEach(({t,x,z,w,d,cols})=>{
    const px=ox+x+(W-2-Math.max(totalW-.8,0))/2+w/2, pz=oz+z+d/2-.6
    const rug=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(0x7d8fb5)); rug.rotation.x=-Math.PI/2; rug.position.set(px,.02,pz); world.add(rug)
    const inner=new THREE.Mesh(new THREE.PlaneGeometry(w-.4,d-.4),mat(0xa3b4d6)); inner.rotation.x=-Math.PI/2; inner.position.set(px,.03,pz); world.add(inner)
    t.members.forEach((p,i)=>{
      const col=Math.floor(i/2), row=i%2===0?-1:1
      const sx=px-w/2+.6+col*2.5+1.25, deskZ=pz+row*.56, seatZ=pz+row*1.72, dir=row
      desk(world,sx,deskZ,dir,p.isRunning); chair(world,sx,seatZ,dir)
      const a=character(p,p.id===t.lead.id); a.pose=p.isFinished?'done':p.isRunning?'work':'desk'; a.base={x:sx,z:seatZ}; a.g.position.set(sx,0,seatZ); a.g.rotation.y=row===-1?0:Math.PI
      if(row===-1)a.g.rotation.y=0
      a.dir=row; seated(a,a.pose!=='done'); world.add(a.g); actors.push(a); addTag(a,p.id===t.lead.id)
    })
  })
  if(lounge.length){
    const lz=D/2-3.1, lx=(lw-W)/2+1
    const carpet=new THREE.Mesh(new THREE.PlaneGeometry(lw,4.6),mat(0x7fb389)); carpet.rotation.x=-Math.PI/2; carpet.position.set(lx,.02,lz); world.add(carpet)
    couch(world,lx,lz-1.2,lw-1.4)
    box(world,lw*.4,.5,1,0xd8a45f,lx,.3,lz+.75)
    lounge.forEach((p,i)=>{const sx=lx-(lw-2)/2+(i+.5)*(lw-2)/lounge.length;const a=character(p,false);a.pose='lounge';a.g.position.set(sx,-.02,lz-1.02);a.dir=1;seated(a,true);world.add(a.g);actors.push(a);addTag(a,false)})
    plant(world,lx+lw/2-.6,lz+1.5)
  }
  view.center.set(0,1,0); view.dist=Math.max(W,D)*1.45+6
}
function seated(a,on){a.legL.rotation.x=a.legR.rotation.x=on?-1.45:0;a.g.children[0].position.y=1.08;a.g.position.y=on?-.12:0}
function addTag(a,isLead){const el=document.createElement('div');el.className='tag'+(isLead?' lead':'');el.textContent=a.p.name;el.onclick=()=>onPick(a.p.id);tagsEl.appendChild(el);tags.push({el,a})}
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
return {
  update(nextPeople,nextRoom,nextSelected){
    selected=nextSelected
    const sig=nextRoom+JSON.stringify(nextPeople.map(p=>[p.id,p.name,p.project,p.startedBy,p.isRunning,p.isFinished]))
    people=nextPeople;room=nextRoom
    if(sig!==signature&&room){signature=sig;build()}
  },
  dispose(){clearInterval(timer);observer.disconnect();renderer.dispose()},
}
}
