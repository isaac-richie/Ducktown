import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleMotion, solveLeg, ANKLE_REST, sampleGait, stanceSpeed, GAIT, REAL_GAIT } from './robot-motion.js';

// Original, photo-referenced presentation geometry; no Pollen CAD or meshes.
// Units are visual centimetres, NOT calibrated SDK dimensions or joint frames.
const PALETTES = {
  cream: {shell:'#f7e6cb', trim:'#ed722c', ring:'#edb52c', sole:'#f6cb37'},
  graphite: {shell:'#6c6a68', trim:'#f2ca4d', ring:'#ab8ec6', sole:'#7964a1'},
  lavender: {shell:'#bfa9cf', trim:'#f2ca4d', ring:'#a9dbe8', sole:'#7964a1'},
  sky: {shell:'#a9dbe8', trim:'#ed722c', ring:'#edb52c', sole:'#f6cb37'}
};
// Like the production photos, the neck leans forward and the head tips back to keep the face level.
const NECK_LEAN = .34, HEAD_LEVEL = -.26;
// Real-walk loop: an ellipse through the stage centre, heading away from the camera and back.
// Kept nearly round: tight ends would make the planted feet skid on the turns.
const PATH = {x:7, z:6};
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const MODES = {
  walk: {label:'Real walk', icon:'≋', title:'A shuffle modelled on how Microduck walks. Hand-animated, not the trained policy.'},
  battle: {label:'Battle', icon:'⚡', title:'Just for fun: a stylised mech run, not a real Microduck gait.'}
};
const active = new Set();
const templates = new Map();
const geometryCache = new Map();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let renderer, environment, renderFailure = false, frame = 0, lastTick = 0;

function material(color, roughness = .46, metalness = 0) {
  return new THREE.MeshStandardMaterial({color, roughness, metalness});
}
function geometry(key, create) {
  if (!geometryCache.has(key)) geometryCache.set(key, create());
  return geometryCache.get(key);
}
function mesh(parent, geom, mat, position = [0,0,0]) {
  const object = new THREE.Mesh(geom, mat);
  object.position.set(...position);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
function box(parent, size, position, mat, radius = .12) {
  return mesh(parent, geometry(`box-${size}-${radius}`, () => new RoundedBoxGeometry(...size, 3, radius)), mat, position);
}
function cylinder(parent, radius, length, position, mat, axis = 'x') {
  const m = mesh(parent, geometry(`cyl-${radius}-${length}`, () => new THREE.CylinderGeometry(radius, radius, length, 48)), mat, position);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  return m;
}
function link(parent, a, b, width, depth, mat) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const m = box(parent, [width, start.distanceTo(end), depth], start.clone().add(end).multiplyScalar(.5).toArray(), mat, .1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), end.sub(start).normalize());
  return m;
}
function cable(parent, points, mat, thickness = .065) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(parent, new THREE.TubeGeometry(curve, 18, thickness, 5, false), mat);
}
function domeGeometry(width, height, depth) {
  return geometry(`dome-${width}-${height}-${depth}`, () => {
    const s = new THREE.Shape(), w = width / 2;
    s.moveTo(-w,0); s.lineTo(w,0); s.lineTo(w,height*.32);
    s.bezierCurveTo(w,height*.78,w*.68,height,w*.18,height);
    s.lineTo(-w*.18,height);
    s.bezierCurveTo(-w*.68,height,-w,height*.78,-w,height*.32);
    s.closePath();
    const extrusion = new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:.09,bevelSize:.09,bevelSegments:5,steps:1,curveSegments:48});
    extrusion.deleteAttribute('normal');
    extrusion.deleteAttribute('uv');
    const smooth = mergeVertices(extrusion);
    smooth.computeVertexNormals();
    extrusion.dispose();
    return smooth;
  });
}
function screw(parent, x, y, z, mats, axis = 'x') {
  cylinder(parent,.15,.06,[x,y,z],mats.steel,axis);
  cylinder(parent,.06,.065,[x,y,z],mats.black,axis);
}
// Batch rigid pieces by material while retaining each articulated group's pivot.
// Cached template geometry is shared across views and colorway changes.
function batchRigidParts(group){
  for(const child of [...group.children])if(child.isGroup)batchRigidParts(child);
  const materials=new Map();
  for(const child of group.children){
    if(!child.isMesh)continue;
    if(!materials.has(child.material))materials.set(child.material,[]);
    materials.get(child.material).push(child);
  }
  for(const [mat,parts] of materials){
    if(parts.length<2)continue;
    const copies=parts.map(part=>{
      part.updateMatrix();
      const copy=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone();
      copy.deleteAttribute('uv');
      return copy.applyMatrix4(part.matrix);
    });
    const merged=mergeGeometries(copies);
    copies.forEach(copy=>copy.dispose());
    if(!merged)continue;
    parts.forEach(part=>group.remove(part));
    mesh(group,merged,mat);
  }
}
function buildRobot(variant) {
  if (templates.has(variant)) return templates.get(variant).clone(true);
  const p = PALETTES[variant] || PALETTES.cream;
  const m = {shell:new THREE.MeshPhysicalMaterial({color:p.shell,roughness:.3,clearcoat:.25,clearcoatRoughness:.38}),trim:material(p.trim,.34),ring:material(p.ring,.37),sole:material(p.sole,.78),
    black:material('#191c1e',.58,.13),gray:material('#60686a',.35,.55),steel:material('#bec4c3',.23,.8),face:material('#686e6b',.49,.08),
    rubber:material('#252c2b',.87),lens:material('#081017',.08,.25),jawInset:material('#bcaac8',.65)};
  const robot = new THREE.Group(); robot.name = 'microduck';
  const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 11.5; robot.add(torso);
  box(torso,[5.4,3.6,3.9],[0,.7,-.35],m.black,.4);
  box(torso,[5.9,3.05,1.55],[0,.8,1.35],m.shell,.65);
  box(torso,[5.4,3.65,1.65],[0,.25,-2.4],m.black,.22); // rear battery
  for(let i=0;i<5;i++) box(torso,[.12,2.7,.08],[-1.6+i*.8,.2,-3.25],m.gray,.02);
  for(const side of [-1,1]) {
    box(torso,[.6,2.95,3.6],[side*2.9,.8,-.25],m.shell,.24);
    screw(torso,side*3.22,1.4,.8,m);
    cylinder(torso,.91,1.25,[side*3.2,-.6,-.2],m.black);
    cylinder(torso,.63,1.35,[side*3.2,-.6,-.2],m.gray);
    screw(torso,side*3.91,-.6,-.2,m);
  }
  // Visible neck brackets, motor housings and a loose cable loop.
  const neck = new THREE.Group(); neck.name='neck'; neck.position.set(0,2.25,.3); torso.add(neck);
  box(neck,[2.1,2,1.7],[0,1,-.25],m.black,.18);
  cylinder(neck,.8,2.8,[0,.45,.05],m.gray);
  // The real neck is a long exposed servo stack: two brackets with a middle motor block.
  for(const side of [-1,1]) {
    link(neck,[side*1.05,.5,0],[side*1.05,6.65,1],.25,1.25,m.gray);
    cylinder(neck,.75,.3,[side*1.18,6.4,1],m.gray);
    for(const y of [1.15,2.05,3.0,4.1,5.2]) cylinder(neck,.17,.28,[side*1.06,y,(y-.5)*.165],m.black);
    screw(neck,side*1.37,.45,.05,m); screw(neck,side*1.37,6.4,1,m);
  }
  box(neck,[1.8,1.5,1.5],[0,3.1,.5],m.black,.14);
  cylinder(neck,.55,2.2,[0,3.1,.5],m.gray);
  box(neck,[1.8,1.65,1.65],[0,5.8,.9],m.black,.14);
  cable(neck,[[.9,.4,-.3],[1.55,2.6,-.65],[1.5,5.6,.25],[.8,7,1]],m.black);
  cable(neck,[[-.8,.5,-.4],[-1.45,2.2,-.65],[-1.3,5,.3],[-.8,6.2,1]],m.rubber,.05);
  const head = new THREE.Group(); head.name='head'; head.position.set(0,6.5,1); neck.add(head);
  // The production head is about as deep as it is wide; stretch the hood front-to-back.
  head.scale.z=1.4;
  cylinder(head,.75,2.1,[0,.2,0],m.black);
  // The long hood and inset gray face distinguish hardware from a cartoon eye.
  mesh(head,domeGeometry(10.3,5.75,6.05),m.shell,[0,.85,-3.55]);
  // A shadowed inset makes the face read as a real panel tucked beneath the hood.
  mesh(head,domeGeometry(9.82,5.25,.12),m.black,[0,.96,2.48]);
  mesh(head,domeGeometry(9.48,4.98,.1),m.face,[0,1.07,2.6]);
  // The orange rim follows the housing. The lower tray is a separate hinged jaw.
  box(head,[10.5,.42,6.35],[0,.75,-.35],m.trim,.18);
  // The production photographs show a single offset camera, not a cartoon pair.
  cylinder(head,1.47,.25,[-.65,3.45,2.83],m.black,'z');
  cylinder(head,1.29,.36,[-.65,3.45,2.91],m.trim,'z');
  cylinder(head,.96,.39,[-.65,3.45,3.0],m.black,'z');
  cylinder(head,.7,.42,[-.65,3.45,3.04],m.lens,'z');
  const ring = mesh(head,new THREE.TorusGeometry(.82,.048,8,32),m.gray,[-.65,3.45,3.25]);
  ring.name='lens-ring';
  const glass = mesh(head,new THREE.SphereGeometry(.55,32,20),new THREE.MeshPhysicalMaterial({color:'#101c25',roughness:.06,metalness:.22,clearcoat:1,clearcoatRoughness:.04}),[-.65,3.45,3.2]);
  glass.scale.z=.22;
  box(head,[.92,.4,.1],[1.75,3.4,2.86],m.black,.18);
  // Dark indicator lens: this illustration does not imply an active camera.
  cylinder(head,.095,.09,[2.45,3.4,2.9],material('#813b2a',.3),'z');
  // Side seam and hinge are visible in profile; the camera remains a single
  // offset unit on the wraparound face, not a second eye on each side.
  for(const side of [-1,1]) {
    box(head,[.1,.16,5.4],[side*5.31,.98,-.08],m.trim,.04);
    cylinder(head,.25,.08,[side*5.36,1.12,1.25],m.black);
    cylinder(head,.13,.1,[side*5.42,1.12,1.25],m.steel);
  }
  for(const x of [-3.8,3.8]) screw(head,x,1.38,2.88,m,'z');
  const jaw = new THREE.Group(); jaw.name='jaw'; jaw.position.set(0,1.65,-2.6); head.add(jaw);
  jaw.rotation.x=0;
  box(jaw,[10.2,.34,6.15],[0,-1.35,2.6],m.trim,.17);
  box(jaw,[9.6,.08,5.55],[0,-1.14,2.6],m.black,.08);
  box(jaw,[9.25,.1,5.2],[0,-1.07,2.6],m.jawInset,.1);
  box(jaw,[10.1,.24,.26],[0,-1.12,5.57],m.trim,.09);
  for(const side of [-1,1]) {
    link(jaw,[side*5.04,0,0],[side*5.04,-1.2,1.1],.32,.55,m.trim);
    box(jaw,[.3,.24,5.7],[side*4.95,-1.12,2.6],m.trim,.09);
    cylinder(jaw,.5,.3,[side*5.1,0,0],m.trim);
    screw(jaw,side*5.28,0,0,m);
  }
  // Two articulated legs. Side covers belong to thighs, never to arms/wings.
  for (const side of [-1,1]) {
    const leg = new THREE.Group(); leg.name=side<0?'leg-left':'leg-right';
    leg.position.set(side*3.65,10.8,-.25); robot.add(leg);
    box(leg,[1.8,2.2,1.9],[0,-.35,0],m.black,.16);
    link(leg,[0,-.2,0],[0,-3.7,-1.4],1.6,1.2,m.gray);
    const plate = new THREE.Shape();
    plate.moveTo(-1.35,0);plate.quadraticCurveTo(-1.6,.3,-1.2,.65);plate.lineTo(1.4,1.05);
    plate.quadraticCurveTo(1.8,1,1.65,.45);plate.lineTo(.65,-2.5);plate.quadraticCurveTo(.3,-2.9,-.2,-2.5);plate.closePath();
    const cover = mesh(leg,geometry('thigh-cover',()=>new THREE.ExtrudeGeometry(plate,{depth:.3,bevelEnabled:true,bevelThickness:.14,bevelSize:.14,bevelSegments:3,curveSegments:10})),m.shell,[side*1.08,-1.35,-.2]);
    cover.rotation.y=side*Math.PI/2;
    screw(leg,side*1.38,-.75,.7,m); screw(leg,side*1.38,-3.5,-.55,m);
    cylinder(leg,.73,2.4,[0,-3.65,-1.4],m.black);
    cylinder(leg,.52,2.55,[0,-3.65,-1.4],m.gray);
    screw(leg,side*1.32,-3.65,-1.4,m);
    const shin = new THREE.Group();shin.name=side<0?'shin-left':'shin-right'; shin.position.set(0,-3.65,-1.4);leg.add(shin);
    link(shin,[0,0,0],[0,-4.5,1.4],1.1,1.0,m.gray);
    box(shin,[1.65,2.15,1.6],[0,-3.6,1.12],m.black,.13);
    for(const x of [-.75,.75])link(shin,[x,-.5,.1],[x,-4,1.25],.16,.8,m.gray);
    cylinder(shin,.61,2.3,[0,-4.5,1.4],m.gray);
    screw(shin,side*1.2,-4.5,1.4,m);
    cable(shin,[[.7,-.4,-.3],[1,-1.8,.05],[.8,-3.4,.7]],m.black,.05);
    const foot = new THREE.Group();foot.name=side<0?'foot-left':'foot-right';foot.position.set(0,-4.5,1.4);shin.add(foot);
    // Chunky two-tone clog: thick rounded upper over a soft sole, with vent dots on the toe.
    box(foot,[3.4,.55,5.1],[0,-2.285,.9],m.sole,.26);
    box(foot,[3.3,1.05,4.9],[0,-1.53,.85],m.trim,.48);
    for(const dx of [-.7,0,.7])for(const dz of [2.3,2.8])cylinder(foot,.13,.06,[dx,-.99,dz],m.black,'y');
    for (const s of [-1,1]) {
      link(foot,[s*1.1,-1.5,-.9],[s*1.1,0,0],.23,1.3,m.trim);
      cylinder(foot,.63,.29,[s*1.1,0,0],m.trim);
      screw(foot,s*1.28,0,0,m);
    }
  }
  batchRigidParts(robot);
  templates.set(variant,robot);
  return robot.clone(true);
}

function initRenderer() {
  if(renderer || renderFailure) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000,0);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=.91;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
    const target=pmrem.fromScene(room,.04);
    environment=target.texture;
    room.dispose();pmrem.dispose();
    renderer.domElement.addEventListener('webglcontextlost',event=>{
      event.preventDefault();renderFailure=true;
      for(const item of active){item.dataset.renderer='fallback';item.updateStatus();}
    });
  } catch(error) {
    renderFailure=true;
    console.warn('Ducktown: 3D unavailable; showing the reference illustration.',error);
  }
  return renderer;
}

const visibility=new IntersectionObserver(entries=>{
  for(const entry of entries){entry.target.visible=entry.isIntersecting;entry.target.dirty=true;}
  wake();
},{rootMargin:'80px'});
const resize=new ResizeObserver(entries=>{
  for(const entry of entries)entry.target.dirty=true;
  wake();
});

class MicroduckView extends HTMLElement {
  connectedCallback() {
    if(this.scene)return;
    this.visible=false;this.dirty=true;this.time=0;this.yaw=.48;this.targetYaw=.48;
    this.isHero=!!this.closest('.featured-stage');
    this.card=this.closest('.behavior-card');
    this.jawAngle=0;this.targetJawAngle=0;this.pointerOver=false;this.life=0;this.gaze={yaw:0,pitch:0};this.targetGaze={yaw:0,pitch:0};this.chirpAt=2+Math.random()*4;this.mode='idle';this.battleBlend=0;this.walkBlend=0;this.gaitPhase=0;this.walkPhase=0;this.pathAngle=0;this.heading=0;this.stompT=Infinity;this.shake=0;this.keyboardFocused=false;this.touchPressed=false;
    this.variant=this.dataset.variant||'cream';
    this.scene=new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#fff7e8','#526961',.85));
    const key=new THREE.DirectionalLight('#fff7ea',2.4);key.position.set(-15,30,22);
    key.castShadow=true;key.shadow.mapSize.set(this.isHero?1024:512,this.isHero?1024:512);
    Object.assign(key.shadow.camera,{left:-18,right:18,top:32,bottom:-10,near:1,far:90});
    key.shadow.normalBias=.06;key.shadow.bias=-.0001;this.scene.add(key);
    const fill=new THREE.DirectionalLight('#d4ecff',.7);fill.position.set(18,16,-15);this.scene.add(fill);
    const rim=new THREE.DirectionalLight('#f4e2bf',1.4);rim.position.set(6,24,-18);this.scene.add(rim);
    this.robot=buildRobot(this.variant);this.scene.add(this.robot);
    this.head=this.robot.getObjectByName('head');this.neck=this.robot.getObjectByName('neck');this.jaw=this.robot.getObjectByName('jaw');
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(70,70),new THREE.ShadowMaterial({opacity:.1}));
    this.floor.rotation.x=-Math.PI/2;this.floor.receiveShadow=true;this.floor.position.y=-.24;this.scene.add(this.floor);
    this.camera=new THREE.PerspectiveCamera(32,1,.1,180);
    this.camera.position.set(28,22,45);this.camera.lookAt(0,12.5,0);
    this.scene.environmentIntensity=.65;
    this.canvas=document.createElement('canvas');this.canvas.setAttribute('aria-hidden','true');this.append(this.canvas);
    this.context=this.canvas.getContext('2d',{alpha:true});
    this.stage=this.closest('.motion-scene');
    const behavior=this.closest('[class*="behavior-motion--"]');
    this.behavior=behavior?[...behavior.classList].find(c=>c.startsWith('behavior-motion--')).slice(17):this.isHero?'ball-follow':'idle';
    this.rig={};
    for(const side of ['left','right'])for(const part of ['leg','shin','foot'])this.rig[`${part}-${side}`]=this.robot.getObjectByName(`${part}-${side}`);
    if(this.card){
      this.cardWake=()=>{this.dirty=true;wake();};
      for(const event of ['pointerenter','pointerleave','focusin','focusout'])this.card.addEventListener(event,this.cardWake);
    }
    const updateJaw=()=>{
      this.targetJawAngle=(this.pointerOver || this.keyboardFocused || this.touchPressed) ? .34 : 0;
      this.dirty=true;wake();
    };
    this.addEventListener('pointerenter',event=>{this.pointerOver=event.pointerType!=='touch';updateJaw();});
    this.addEventListener('pointerleave',()=>{this.pointerOver=false;this.touchPressed=false;updateJaw();});
    this.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'){this.touchPressed=true;updateJaw();}});
    this.addEventListener('pointerup',()=>{this.touchPressed=false;updateJaw();});
    this.addEventListener('pointercancel',()=>{this.pointerOver=false;this.touchPressed=false;updateJaw();});
    this.addEventListener('focus',()=>{this.keyboardFocused=this.matches(':focus-visible');updateJaw();});
    this.addEventListener('blur',()=>{this.keyboardFocused=false;updateJaw();});
    if(this.isHero){
      // Curious gaze: the hero duck glances toward the pointer anywhere on the page.
      this.onGaze=event=>{
        if(this.dragX!==undefined || event.pointerType==='touch')return;
        const b=this.getBoundingClientRect();if(b.width<1)return;
        const nx=(event.clientX-(b.left+b.width/2))/Math.max(320,innerWidth/2),ny=(event.clientY-(b.top+b.height*.35))/Math.max(320,innerHeight/2);
        this.targetGaze.yaw=Math.max(-.42,Math.min(.42,nx*.5));this.targetGaze.pitch=Math.max(-.16,Math.min(.2,ny*.22));wake();
      };
      window.addEventListener('pointermove',this.onGaze,{passive:true});
      this.tabIndex=0;
      this.title='Hover or focus to open the mouth. Drag to rotate. On touch screens, press and hold.';
      this.ball=new THREE.Mesh(new THREE.SphereGeometry(1.35,24,16),material('#d96248',.55));
      this.ball.castShadow=true;this.scene.add(this.ball);
      // Battle mode floor: painted stripes that scroll at foot speed so planted feet read as running.
      const stripes=document.createElement('canvas');stripes.width=stripes.height=64;
      const sc=stripes.getContext('2d');sc.fillStyle='rgba(216,240,115,.55)';sc.fillRect(0,0,64,7);sc.fillStyle='rgba(216,240,115,.18)';sc.fillRect(0,32,64,3);
      const texture=new THREE.CanvasTexture(stripes);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(1,70/16);
      this.track=new THREE.Mesh(new THREE.PlaneGeometry(16,70),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:0,depthWrite:false}));
      this.track.rotation.x=-Math.PI/2;this.track.position.y=-.2;this.scene.add(this.track);
      this.addEventListener('keydown',event=>{
        if(this.mode!=='idle' && (event.key==='Enter'||event.key===' ')){event.preventDefault();this.stomp();}
      });
      this.makeControls();
      this.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        this.dragX=event.clientX;this.dragYaw=this.targetYaw;this.pressX=event.clientX;this.pressY=event.clientY;
        this.setPointerCapture(event.pointerId);
      });
      this.addEventListener('pointermove',event=>{
        if(this.dragX===undefined)return;
        this.targetYaw=Math.max(-1.45,Math.min(1.45,this.dragYaw+(event.clientX-this.dragX)*.009));
        this.dirty=true;wake();
        for(const button of this.controls.children)button.setAttribute('aria-pressed','false');
      });
      this.addEventListener('pointerup',event=>{
        // A press without a drag is a tap: the duck stomps in battle mode, or hops hello on a walk.
        if(this.mode!=='idle' && this.pressX!==undefined && Math.hypot(event.clientX-this.pressX,event.clientY-this.pressY)<6)this.stomp();
        this.dragX=undefined;this.pressX=undefined;
      });
      this.addEventListener('pointercancel',()=>{this.dragX=undefined;});
    }
    active.add(this);visibility.observe(this);resize.observe(this);wake();
  }
  disconnectedCallback() {
    active.delete(this);visibility.unobserve(this);if(this.onGaze)window.removeEventListener('pointermove',this.onGaze);resize.unobserve(this);
    if(this.card)for(const event of ['pointerenter','pointerleave','focusin','focusout'])this.card.removeEventListener(event,this.cardWake);
    this.controls?.remove();this.variantControls?.remove();this.modeControls?.remove();this.track?.geometry.dispose();this.track?.material.map.dispose();this.track?.material.dispose();this.status?.remove();
    // Shared robot geometry/materials are retained by the four template rigs.
    this.ball?.geometry.dispose();this.ball?.material.dispose();
    this.floor?.geometry.dispose();this.floor?.material.dispose();
    this.scene?.traverse(object=>object.shadow?.dispose());
    this.canvas?.remove();this.scene=null;
    if(!active.size){cancelAnimationFrame(frame);frame=0;}
  }
  makeControls() {
    const group=document.createElement('div');group.className='robot-angle-controls';
    group.setAttribute('role','group');group.setAttribute('aria-label','Robot viewing angle');
    for(const [label,yaw] of [['Front',0],['¾',.48],['Side',1.4]]){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.setAttribute('aria-label',`${label==='¾'?'Three-quarter':label} robot view`);
      button.setAttribute('aria-pressed',String(yaw===.48));
      button.addEventListener('click',()=>{
        this.targetYaw=yaw;this.dirty=true;
        if(!motionEnabled())this.yaw=yaw;
        for(const b of group.children)b.setAttribute('aria-pressed',String(b===button));wake();
      });group.append(button);
    }
    this.controls=group;this.parentElement.append(group);
    const modes=document.createElement('div');modes.className='robot-mode-controls';
    modes.setAttribute('role','group');modes.setAttribute('aria-label','Robot motion mode');
    for(const [mode,info] of Object.entries(MODES)){
      const button=document.createElement('button');button.type='button';button.dataset.mode=mode;
      button.innerHTML=`<span aria-hidden="true">${info.icon}</span> ${info.label}`;
      button.title=info.title;button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>this.setMode(this.mode===mode?'idle':mode));
      modes.append(button);
    }
    this.modeControls=modes;this.parentElement.append(modes);
    const shellControls=document.createElement('div');
    shellControls.className='robot-shell-controls';
    shellControls.setAttribute('role','group');
    shellControls.setAttribute('aria-label','Microduck shell color');
    const shellLabel=document.createElement('span');shellLabel.textContent='SHELL';shellControls.append(shellLabel);
    for(const [name,palette] of Object.entries(PALETTES)){
      const button=document.createElement('button');button.type='button';
      button.style.setProperty('--shell-color',palette.shell);
      button.setAttribute('aria-label',`${name[0].toUpperCase()+name.slice(1)} shell`);
      button.setAttribute('title',`${name[0].toUpperCase()+name.slice(1)} shell`);
      button.setAttribute('aria-pressed',String(this.variant===name));
      button.addEventListener('click',()=>this.setVariant(name));
      shellControls.append(button);
    }
    this.variantControls=shellControls;this.parentElement.append(shellControls);
    const status=document.createElement('span');status.className='robot-render-label';
    this.status=status;this.parentElement.append(status);this.updateStatus();
  }
  setVariant(variant){
    if(this.variant===variant || !PALETTES[variant])return;
    this.scene.remove(this.robot);
    this.robot=buildRobot(variant);this.scene.add(this.robot);
    this.head=this.robot.getObjectByName('head');this.neck=this.robot.getObjectByName('neck');this.jaw=this.robot.getObjectByName('jaw');
    for(const side of ['left','right'])for(const part of ['leg','shin','foot'])this.rig[`${part}-${side}`]=this.robot.getObjectByName(`${part}-${side}`);
    this.variant=variant;this.dataset.variant=variant;
    this.setAttribute('aria-label',`Three-dimensional visual study of a ${variant} Microduck robot`);
    for(const button of this.variantControls.querySelectorAll('button')){
      button.setAttribute('aria-pressed',String(button.getAttribute('aria-label').toLowerCase().startsWith(variant)));
    }
    this.dirty=true;wake();
  }
  updateStatus(){
    const webgl=this.dataset.renderer==='webgl';
    const touch=matchMedia('(pointer:coarse)').matches;
    const tap=touch?'TAP':'CLICK';
    const label=!webgl?'ROBOT ILLUSTRATION':
      this.mode==='battle'?`BATTLE · JUST FOR FUN, NOT A REAL GAIT · ${tap} TO STOMP`:
      this.mode==='walk'?`REAL WALK · HAND-ANIMATED SHUFFLE · ${tap} TO SAY HI`:
      (touch?'HOLD TO OPEN · DRAG TO ROTATE':'HOVER TO OPEN · DRAG TO ROTATE');
    if(this.modeControls){
      this.modeControls.hidden=!webgl;
      for(const button of this.modeControls.children)button.disabled=!motionEnabled();
    }
    if(this.status && this.status.textContent!==label)this.status.textContent=label;
    if(this.controls && this.controls.hidden===webgl)this.controls.hidden=!webgl;
    if(this.variantControls && this.variantControls.hidden===webgl)this.variantControls.hidden=!webgl;
  }
  setMode(mode){
    if(mode!=='idle' && !motionEnabled())return;
    // Leaving a walk, the duck finishes its lap and stops at home instead of sliding back.
    this.returning=mode!=='walk' && this.walkBlend>0 && motionEnabled();
    this.mode=mode;
    for(const button of this.modeControls?.children||[])button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    this.closest('.featured-stage')?.classList.toggle('is-battle',mode==='battle');
    this.closest('.featured-stage')?.classList.toggle('is-walk',mode==='walk');
    this.updateStatus();this.dirty=true;wake();
  }
  stomp(){
    if(!motionEnabled())return;
    this.stompT=0;this.stompScale=this.mode==='walk'?.45:1;this.dirty=true;wake();
  }
  isPlaying(){
    return motionEnabled() && this.stage?.classList.contains('is-playing') && !this.stage.classList.contains('is-paused') &&
      (!this.card || this.card.matches(':hover,:focus-within') || this.touchPressed) &&
      !(document.body.classList.contains('has-modal') && this.closest('#view'));
  }
  isAlive(){
    // Ambient life (breathing, weight shift, gaze) keeps the hero feeling present; cards wake on hover.
    return motionEnabled() && this.visible && (this.isHero || this.isPlaying() || this.battleBlend>0 || this.walkBlend>0) && !this.stage?.classList.contains('is-paused');
  }
  pose(){
    const t=this.time, l=this.life, motion=sampleMotion(this.behavior,t);
    for(const [k,phase,params,turn] of [[this.walkBlend,this.walkPhase,REAL_GAIT,this.turn||0],[this.battleBlend,this.gaitPhase,GAIT,0]]){
      if(k<=0)continue;
      const gait=sampleGait(phase,params,turn);
      for(const key in motion)motion[key]+=(gait[key]-motion[key])*k;
    }
    if(this.stompT<.7){
      // Stomp: quick wind-up, heavy drop, roar, recover.
      const x=this.stompT/.7,hit=Math.sin(Math.PI*Math.min(1,x*1.4))*(this.stompScale??1);
      motion.crouch+=1.4*hit;motion.jaw=Math.max(motion.jaw,.34*hit);motion.pitch-=.18*hit;motion.lean+=.08*hit;
    }
    const breathe=Math.sin(l*1.9), sway=Math.sin(l*.73)*.6+Math.sin(l*1.31)*.4;
    // Expressive overlay is tiny so authored clips still read clearly; feet stay planted.
    this.robot.rotation.z=sway*.012+motion.hipRoll;
    // Ready stance: knees always a little bent, with a soft bounce, like the real ducks.
    const crouch=.85+(motionEnabled()?breathe*.12:0)+motion.crouch;
    // Tipping rotates about the feet; lift by the shell's half-depth so the back rests on the floor.
    // While lying, crouch tucks the legs toward the body instead of sinking it.
    this.robot.rotation.x=-motion.tip;
    const path=this.pathPoint(),w=this.walkBlend;
    // Rocking over a foot sinks that foot's outer edge; lift by the same amount so it rests on the floor.
    const rock=Math.sin(Math.abs(motion.hipRoll))*5.35;
    this.robot.position.set(path[0]*w,Math.sin(motion.tip)*3.4-crouch*Math.cos(motion.tip)+rock,path[1]*w);
    const torso=this.robot.getObjectByName('torso');
    if(torso){torso.userData.baseY??=torso.position.y;torso.position.y=torso.userData.baseY+breathe*.04;torso.rotation.set(motion.lean,0,motion.roll*.4);}
    for(const side of ['left','right']){
      const right=side==='right',lift=right?motion.lift:motion.liftL,reach=right?motion.reach:motion.reachL;
      const leg=solveLeg(ANKLE_REST+crouch+lift,reach);
      this.rig[`leg-${side}`].rotation.x=leg.hip;
      this.rig[`shin-${side}`].rotation.x=leg.knee;
      this.rig[`foot-${side}`].rotation.x=leg.foot-reach*.05;
    }
    this.head.rotation.set(HEAD_LEVEL+motion.pitch-motion.lean*.6+this.gaze.pitch+breathe*.012,motion.yaw+this.gaze.yaw+Math.sin(l*.41)*.035,motion.roll+sway*.02-motion.hipRoll);
    this.neck.rotation.x=NECK_LEAN+motion.neck;
    if(motion.tip>.001)this.restOnFloor();
    else if(this.groundLevel===undefined && !motion.lift && !motion.liftL)this.groundLevel=this.lowestPoint();
    this.jaw.rotation.x=Math.max(this.jawAngle,this.chirp||0,motion.jaw);
    this.robot.rotation.y=wrapAngle(this.heading)*this.walkBlend;
    if(this.ball){
      this.ball.position.set(motion.ball,1.13,3);
      this.ball.rotation.z=-this.ball.position.x/1.35;
    }
    // Feet remain planted. Gait/physics will come from the SDK, not decorative bobbing.
    this.dataset.poseTime=t.toFixed(3);
  }
  pathPoint(){
    // Ellipse through the origin: x sways across the stage, z heads away from the camera and back.
    return [PATH.x*Math.sin(this.pathAngle),-PATH.z*(1-Math.cos(this.pathAngle))];
  }
  lowestPoint(){
    // World-space bottom of the rig, from cached per-mesh bounding boxes.
    let min=Infinity;const e=new THREE.Vector3();
    this.robot.updateMatrixWorld(true);
    this.robot.traverse(m=>{
      if(!m.isMesh)return;
      const bb=m.geometry.boundingBox||(m.geometry.computeBoundingBox(),m.geometry.boundingBox);
      for(const x of [bb.min.x,bb.max.x])for(const y of [bb.min.y,bb.max.y])for(const z of [bb.min.z,bb.max.z]){
        e.set(x,y,z).applyMatrix4(m.matrixWorld);if(e.y<min)min=e.y;
      }
    });
    return min;
  }
  restOnFloor(){
    // While tumbling, keep the shell resting on the floor instead of sinking or floating.
    if(this.groundLevel!==undefined)this.robot.position.y+=this.groundLevel-this.lowestPoint();
  }
  draw(dt){
    if(!this.context || !initRenderer() || renderFailure)return;
    if(this.isPlaying())this.time+=dt;
    if(this.isAlive()){
      this.life+=dt;
      // Occasional happy chirp: a quick jaw flick, like a duck saying hi.
      const since=this.life-this.chirpAt;
      this.chirp=since>0&&since<.5?Math.sin(since/.5*Math.PI*2)**2*.22:0;
      if(since>=.5)this.chirpAt=this.life+3+Math.random()*5;
    }else this.chirp=0;
    if(!motionEnabled() && this.mode!=='idle')this.setMode('idle');
    const ramp=motionEnabled()?1-Math.exp(-dt*3):1,blend=(value,target)=>Math.abs(target-value)<.002?target:value+(target-value)*ramp;
    if(this.returning && Math.cos(this.pathAngle)>=.995 && Math.sin(this.pathAngle)>=0)this.returning=false;
    this.walkBlend=blend(this.walkBlend,this.mode==='walk'||this.returning?1:0);
    this.battleBlend=blend(this.battleBlend,this.mode==='battle'&&this.walkBlend===0?1:0);
    if(this.walkBlend>0){
      this.walkPhase=(this.walkPhase+dt*REAL_GAIT.cadence*this.walkBlend)%1;
      // Advance along the loop at stance speed so the planted foot stays put on the floor.
      const tangent=Math.hypot(PATH.x*Math.cos(this.pathAngle),PATH.z*Math.sin(this.pathAngle));
      this.pathAngle+=dt*stanceSpeed(REAL_GAIT)*this.walkBlend/Math.max(.5,tangent);
      const θ=this.pathAngle,dx=PATH.x*Math.cos(θ),dz=-PATH.z*Math.sin(θ),ddx=-PATH.x*Math.sin(θ),ddz=-PATH.z*Math.cos(θ);
      this.heading+=wrapAngle(Math.atan2(dx,dz)-this.heading);
      // Signed curvature (heading change per cm) × the feet's 3.65 cm offset from the centre line.
      this.turn=Math.max(-.85,Math.min(.85,(dz*ddx-dx*ddz)/Math.hypot(dx,dz)**3*3.65));
    }else{this.pathAngle=0;this.heading=0;}
    const speedUp=this.battleBlend;
    this.gaitPhase=(this.gaitPhase+dt*GAIT.cadence*speedUp)%1;
    if(this.stompT<.7)this.stompT+=dt;
    if(this.track){
      this.track.material.opacity=.9*this.battleBlend;
      // The plane's v axis points backward (world -z); lowering the offset carries stripes backward with the planted foot.
      this.track.material.map.offset.y=(this.track.material.map.offset.y-dt*speedUp*stanceSpeed()/16+1)%1;
    }
    if(this.ball)this.ball.visible=this.battleBlend<.5&&this.walkBlend<.5;
    // Footfall impact: a small camera kick each time a foot plants, plus a big one for a stomp.
    const footfall=Math.max(0,Math.cos(this.gaitPhase*Math.PI*4))**12*this.battleBlend;
    const stompKick=this.stompT<.7?Math.max(0,Math.sin(Math.PI*Math.min(1,this.stompT/.7*1.4)))**6:0;
    this.shake=motionEnabled()?footfall*.18+stompKick*.6:0;
    const g=motionEnabled()?1-Math.exp(-dt*(this.mode==='battle'?9:5)):1;
    this.gaze.yaw+=(this.targetGaze.yaw-this.gaze.yaw)*g;this.gaze.pitch+=(this.targetGaze.pitch-this.gaze.pitch)*g;
    if(motionEnabled())this.yaw+=(this.targetYaw-this.yaw)*Math.min(1,dt*10);
    else this.yaw=this.targetYaw;
    if(motionEnabled())this.jawAngle+=(this.targetJawAngle-this.jawAngle)*(1-Math.exp(-dt*14));
    else this.jawAngle=this.targetJawAngle;
    if(Math.abs(this.targetJawAngle-this.jawAngle)<.001)this.jawAngle=this.targetJawAngle;
    this.pose();
    const jitter=this.shake*Math.sin(this.life*90);
    this.camera.position.set(Math.sin(this.yaw)*58+jitter,23+this.shake*Math.cos(this.life*70),Math.cos(this.yaw)*58+1.6);
    // Frame the taller, forward-leaning silhouette (head rides ahead of the hips).
    this.camera.lookAt(0,this.isHero?12.6:13,1.6);
    const bounds=this.getBoundingClientRect();
    if(bounds.width<1 || bounds.height<1)return;
    const dpr=Math.min(devicePixelRatio||1,this.isHero?2:1.5),limit=this.isHero?1200:700,w=Math.min(limit,Math.round(bounds.width*dpr)),h=Math.min(limit,Math.round(bounds.height*dpr));
    if(this.canvas.width!==w || this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    this.camera.aspect=w/h;
    // Fit the full robot even in narrow containers; cards keep a roomy studio crop.
    this.camera.fov=this.isHero?32:34;
    if(this.camera.aspect<.85)this.camera.fov=39;
    this.camera.updateProjectionMatrix();this.scene.environment=environment;
    renderer.setSize(w,h,false);renderer.render(this.scene,this.camera);
    this.context.clearRect(0,0,w,h);this.context.drawImage(renderer.domElement,0,0);
    this.dataset.renderer='webgl';this.updateStatus();this.dirty=false;
  }
}
customElements.define('microduck-view',MicroduckView);

function motionEnabled(){return !reduced.matches && !document.documentElement.classList.contains('motion-disabled');}
function wake(){if(!frame && !document.hidden && !renderFailure)frame=requestAnimationFrame(tick);}
function tick(now){
  frame=0;
  if(document.hidden || renderFailure)return;
  const dt=Math.min((now-lastTick)/1000,.06);
  if(now-lastTick<1000/60-2){wake();return;}
  lastTick=now;
  let continuous=false;
  for(const item of active){
    if(!item.visible)continue;
    const changingAngle=Math.abs(item.targetYaw-item.yaw)>.001;
    const changingJaw=Math.abs(item.targetJawAngle-item.jawAngle)>.001;
    const changingGaze=Math.abs(item.targetGaze.yaw-item.gaze.yaw)+Math.abs(item.targetGaze.pitch-item.gaze.pitch)>.001;
    const moving=item.isPlaying() || item.isAlive() || item.stompT<.7 || (item.battleBlend>0 && item.battleBlend<1) || item.walkBlend>0 || changingAngle || changingJaw || changingGaze;
    if(item.dirty || moving){
      try{item.draw(dt);}catch(error){item.dataset.renderer='fallback';item.updateStatus();console.warn('Ducktown model render failed',error);}
    }
    continuous ||= moving;
  }
  if(continuous)wake();
}
new MutationObserver(()=>{
  for(const item of active)item.dirty=true;
  wake();
}).observe(document.documentElement,{attributes:true,attributeFilter:['class'],subtree:true});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{lastTick=performance.now();wake();}
});
reduced.addEventListener('change',()=>{for(const item of active)item.dirty=true;wake();});
