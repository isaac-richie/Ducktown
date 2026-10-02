import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCity } from './ducktown-city.js';
import { sampleMotion, solveLeg3D, ANKLE_REST, sampleGait, stanceSpeed, GAIT, REAL_GAIT } from './robot-motion.js';

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
// Laps left until the walk loop is back at its start (0 when home).
const toHome = a => ((Math.PI*2 - a % (Math.PI*2)) % (Math.PI*2));
const mixGait = (a, b, t) => Object.fromEntries(Object.keys(a).map(key => [key, a[key] + (b[key] - a[key]) * t]));
const MODES = {
  walk: {label:'Real walk', icon:'≋', title:'A shuffle modelled on how Microduck walks. Hand-animated, not the trained policy.'},
  battle: {label:'Battle', icon:'⚡', title:'Just for fun: a stylised mech run, not a real Microduck gait.'},
  policy: {label:'Real policies', icon:'◆', title:"Pollen's official trained policies on Pollen's exact robot, replayed from a MuJoCo simulation."},
  disco: {label:'Disco', icon:'♪', title:"Dances to music using only the real Microduck's body-pose and head commands, within Pollen's trained ranges."}
};
// Orbit camera: free 360° yaw; pitch from underneath to straight above, stopping short of the
// poles so the view never flips. 0.177 rad matches the original eye-level framing.
const FOLLOW = .65;
// The hero sits further back and a little higher, so the duck reads as a small robot in a big city.
const PITCH = {min:-1.35, max:1.42, rest:.06};
const HERO_RADIUS = 96, HERO_RADIUS_NARROW = 74, CARD_RADIUS = 58.9, CARD_PITCH = .177;
// Phones and small screens get a lighter city photo. The robot is always full detail: the
// simplified build faceted its curved shells and looked broken on phones.
const LITE = matchMedia('(pointer:coarse),(max-width:760px)').matches;
const VIEWS = [['Front',0,PITCH.rest,'Front'],['¾',.48,PITCH.rest,'Three-quarter'],['Side',1.4,PITCH.rest,'Side'],['Top',.48,1.35,'Top-down'],['Under',.48,-1.2,'Underneath']];
// Servo model: commands refresh at the real controller's 50 Hz and each channel follows like a
// position-controlled motor (slightly underdamped: a tiny lag, overshoot and settle).
const SERVO = {hz: 50, omega: 34, zeta: .62};
const SERVO_CHANNELS = ['crouch','shift','lift','reach','liftL','reachL','lean','roll','pitch','yaw','neck','tip'];
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
    const leg = new THREE.Group(); leg.name=side<0?'leg-left':'leg-right'; leg.rotation.order='ZXY'; // roll, then pitch
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
    const foot = new THREE.Group();foot.name=side<0?'foot-left':'foot-right';foot.rotation.order='XZY';foot.position.set(0,-4.5,1.4);shin.add(foot);
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
    this.visible=false;this.dirty=true;this.time=0;this.yaw=.48;this.targetYaw=.48;this.pitch=PITCH.rest;this.targetPitch=PITCH.rest;this.focus={x:0,z:0};
    this.isHero=!!this.closest('.featured-stage');
    if(!this.isHero)this.pitch=this.targetPitch=CARD_PITCH;
    this.card=this.closest('.behavior-card');
    this.jawAngle=0;this.targetJawAngle=0;this.pointerOver=false;this.life=0;this.gaze={yaw:0,pitch:0};this.targetGaze={yaw:0,pitch:0};this.chirpAt=2+Math.random()*4;this.mode='idle';this.battleBlend=0;this.walkBlend=0;this.gaitPhase=0;this.pathAngle=0;this.heading=0;this.faceBlend=0;this.gaitTotal=0;this.gaitParams=REAL_GAIT;this.gaitTurn=0;this.stompT=Infinity;this.shake=0;this.keyboardFocused=false;this.touchPressed=false;
    this.variant=this.dataset.variant||'cream';
    this.scene=new THREE.Scene();
    this.hemi=new THREE.HemisphereLight('#fff7e8','#526961',.85);this.scene.add(this.hemi);
    const key=new THREE.DirectionalLight('#fff7ea',2.4);this.keyLight=key;key.position.set(-15,30,22);
    key.castShadow=true;key.shadow.mapSize.set(this.isHero?1024:512,this.isHero?1024:512);
    Object.assign(key.shadow.camera,{left:-18,right:18,top:32,bottom:-10,near:1,far:90});
    key.shadow.normalBias=.06;key.shadow.bias=-.0001;this.scene.add(key);
    const fill=new THREE.DirectionalLight('#d4ecff',.7);fill.position.set(18,16,-15);this.scene.add(fill);this.fillLight=fill;
    const rim=new THREE.DirectionalLight('#f4e2bf',1.4);rim.position.set(6,24,-18);this.scene.add(rim);this.rimLight=rim;
    this.robot=buildRobot(this.variant);this.scene.add(this.robot);
    // In the hero, Pollen's exact robot is the star: don't flash the illustrated placeholder while it loads.
    if(this.isHero)this.robot.visible=false;
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
      this.title='Hover or focus to open the mouth. Drag to orbit all the way around, above and below; arrow keys work too. On touch screens, press and hold.';
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
        this.dragX=event.clientX;this.dragY=event.clientY;this.dragYaw=this.targetYaw;this.dragPitch=this.targetPitch;this.pressX=event.clientX;this.pressY=event.clientY;
        this.setPointerCapture(event.pointerId);
      });
      this.addEventListener('pointermove',event=>{
        if(this.dragX===undefined)return;
        // Full 360° spin. Mouse/pen can also tilt: drag down to look from above, up to look from underneath.
        // Touch keeps vertical swipes for page scrolling (Top/Under buttons cover those views).
        this.targetYaw=this.dragYaw+(event.clientX-this.dragX)*.009;
        if(event.pointerType!=='touch')this.targetPitch=Math.max(PITCH.min,Math.min(PITCH.max,this.dragPitch+(event.clientY-this.dragY)*.008));
        this.dirty=true;wake();
        for(const button of this.controls.children)button.setAttribute('aria-pressed','false');
      });
      this.addEventListener('pointerup',event=>{
        // A press without a drag is a tap: the duck stomps in battle mode, or hops hello on a walk.
        const tap=this.pressX!==undefined && Math.hypot(event.clientX-this.pressX,event.clientY-this.pressY)<6;
        if(tap && this.mode==='idle')this.tapBall(event);
        else if(tap && this.mode!=='idle')this.stomp();
        this.dragX=undefined;this.pressX=undefined;
      });
      this.addEventListener('pointercancel',()=>{this.dragX=undefined;});
      this.addEventListener('keydown',event=>{
        const step={ArrowLeft:[.2,0],ArrowRight:[-.2,0],ArrowUp:[0,.15],ArrowDown:[0,-.15]}[event.key];
        if(!step)return;
        event.preventDefault();
        this.orbitTo(this.targetYaw+step[0],this.targetPitch+step[1]);
        for(const button of this.controls.children)button.setAttribute('aria-pressed','false');
      });
    }
    // Hero: start downloading Pollen's robot right away, in parallel with the 3D engine and city.
    if(this.isHero)this.loadExactDuck();
    active.add(this);visibility.observe(this);resize.observe(this);wake();
  }
  disconnectedCallback() {
    this.discoAudio?.stop();
    active.delete(this);visibility.unobserve(this);if(this.onGaze)window.removeEventListener('pointermove',this.onGaze);resize.unobserve(this);
    if(this.card)for(const event of ['pointerenter','pointerleave','focusin','focusout'])this.card.removeEventListener(event,this.cardWake);
    this.dock?.remove();this.controls?.remove();this.variantControls?.remove();this.modeControls?.remove();this.clipControls?.remove();this.policyRobot?.dispose();this.track?.geometry.dispose();this.track?.material.map.dispose();this.track?.material.dispose();this.status?.remove();
    // Shared robot geometry/materials are retained by the four template rigs.
    this.ball?.geometry.dispose();this.ball?.material.dispose();
    this.floor?.geometry.dispose();this.floor?.material.dispose();this.city?.dispose();
    this.scene?.traverse(object=>object.shadow?.dispose());
    this.canvas?.remove();this.scene=null;
    if(!active.size){cancelAnimationFrame(frame);frame=0;}
  }
  makeControls() {
    // One frosted dock holds every control: modes (+ policy clips), shell colours and a camera menu.
    const dock=document.createElement('div');dock.className='robot-dock';
    dock.setAttribute('role','toolbar');dock.setAttribute('aria-label','Robot controls');
    this.dock=dock;this.parentElement.append(dock);
    const group=document.createElement('div');group.className='robot-angle-controls';
    group.setAttribute('role','group');group.setAttribute('aria-label','Robot viewing angle');
    for(const [label,yaw,pitch,name] of VIEWS){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.setAttribute('aria-label',`${name} robot view`);
      button.setAttribute('aria-pressed',String(label==='¾'));
      button.addEventListener('click',()=>{
        // Take the short way round, however many times the view has been spun.
        this.orbitTo(this.targetYaw+wrapAngle(yaw-this.targetYaw),pitch);
        for(const b of group.children)b.setAttribute('aria-pressed',String(b===button));
        // Close the camera menu after a choice.
        group.hidden=true;this.cameraControl?.querySelector('.robot-camera-toggle')?.setAttribute('aria-expanded','false');
      });group.append(button);
    }
    this.controls=group;
    // Camera views live in a small popover; the dock stays uncluttered.
    const camera=document.createElement('div');camera.className='robot-camera';
    const cameraButton=document.createElement('button');cameraButton.type='button';cameraButton.className='robot-camera-toggle';
    cameraButton.setAttribute('aria-label','Camera views');cameraButton.setAttribute('aria-expanded','false');
    cameraButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
    cameraButton.addEventListener('click',()=>{const open=group.hidden;group.hidden=!open;cameraButton.setAttribute('aria-expanded',String(open));});
    group.hidden=true;camera.append(cameraButton,group);
    const modes=document.createElement('div');modes.className='robot-mode-controls';
    modes.setAttribute('role','group');modes.setAttribute('aria-label','Robot motion mode');
    for(const [mode,info] of Object.entries(MODES)){
      const button=document.createElement('button');button.type='button';button.dataset.mode=mode;
      button.innerHTML=`<span aria-hidden="true">${info.icon}</span> ${info.label}`;
      button.title=info.title;button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>this.setMode(this.mode===mode?'idle':mode));
      modes.append(button);
    }
    this.modeControls=modes;dock.append(modes);
    // Clip picker for the real-policy replays (shown only in that mode).
    const clips=document.createElement('div');clips.className='robot-clip-controls';clips.hidden=true;
    clips.setAttribute('role','group');clips.setAttribute('aria-label','Pollen policy replay');
    import('./policy-replay.js').then(({POLICY_CLIPS})=>{
      for(const clip of POLICY_CLIPS){
        const button=document.createElement('button');button.type='button';button.dataset.clip=clip.id;
        button.textContent=clip.label;button.title=clip.note;button.setAttribute('aria-pressed',String(clip.id===this.clipName));
        button.addEventListener('click',()=>this.playClip(clip.id));
        clips.append(button);
      }
    });
    this.clipControls=clips;dock.append(clips);
    // Duck Disco: a built-in royalty-free beat, your own song, and the dance as a real-robot score.
    const disco=document.createElement('div');disco.className='robot-clip-controls robot-disco-controls';disco.hidden=true;
    disco.setAttribute('role','group');disco.setAttribute('aria-label','Duck Disco music');
    const discoButton=(label,title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.addEventListener('click',fn);disco.append(b);return b;};
    this.discoDemo=discoButton('Beat','Royalty-free beat made in your browser',()=>this.startDisco());
    const file=document.createElement('input');file.type='file';file.accept='audio/*';file.hidden=true;
    file.addEventListener('change',()=>{if(file.files[0])this.startDisco(file.files[0]);file.value='';});
    this.discoSong=discoButton('Your song','Play a song from your device; the duck finds the beat',()=>file.click());
    discoButton('Robot score','Download this dance as timed robot.pose / robot.head / robot.mouth commands',()=>this.downloadScore());
    disco.append(file);this.discoControls=disco;dock.append(disco);
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
    this.variantControls=shellControls;dock.append(shellControls,camera);this.cameraControl=camera;
    const status=document.createElement('span');status.className='robot-render-label';
    this.status=status;this.parentElement.append(status);this.updateStatus();
  }
  setVariant(variant){
    if(this.variant===variant || !PALETTES[variant])return;
    this.scene.remove(this.robot);
    this.robot=buildRobot(variant);this.scene.add(this.robot);
    // The rebuilt illustrated duck stays hidden while Pollen's exact robot is on stage.
    this.robot.visible=this.isHero?!!this.exactFailed:!this.policyRobot?.root.visible;
    this.head=this.robot.getObjectByName('head');this.neck=this.robot.getObjectByName('neck');this.jaw=this.robot.getObjectByName('jaw');
    for(const side of ['left','right'])for(const part of ['leg','shin','foot'])this.rig[`${part}-${side}`]=this.robot.getObjectByName(`${part}-${side}`);
    this.variant=variant;this.dataset.variant=variant;this.policyRobot?.setColorway(PALETTES[variant]);
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
      this.mode==='disco'?`DUCK DISCO · ${this.discoTrack||'STARTING…'} · SIMULATED WITH REAL ROBOT CONTROLS`:
      this.mode==='policy'?(this.clip?`SIMULATED · POLLEN'S OFFICIAL POLICY · ${this.clipNote.toUpperCase()} · ${tap} TO REPLAY`:'LOADING POLLEN\'S ROBOT…'):
      this.exact?(touch?'TAP THE BALL FOR A REAL KICK':'CLICK THE BALL FOR A REAL KICK · DRAG TO ORBIT'):
      (touch?'HOLD TO OPEN · SWIPE SIDEWAYS TO SPIN':'HOVER TO OPEN · DRAG TO ORBIT 360°');
    if(this.dock)this.dock.hidden=!webgl;
    if(this.modeControls){
      this.modeControls.hidden=!webgl;
      for(const button of this.modeControls.children)button.disabled=!motionEnabled();
    }
    if(this.status && this.status.textContent!==label)this.status.textContent=label;
    if(this.variantControls && this.variantControls.hidden===webgl)this.variantControls.hidden=!webgl;
  }
  orbitTo(yaw,pitch){
    this.targetYaw=yaw;this.targetPitch=Math.max(PITCH.min,Math.min(PITCH.max,pitch));
    if(!motionEnabled()){this.yaw=this.targetYaw;this.pitch=this.targetPitch;}
    this.dirty=true;wake();
  }
  setMode(mode){
    if(mode!=='idle' && !motionEnabled())return;
    if(mode!=='policy')this.autoReturn=false;
    // Switching off away from home, the duck walks the rest of its lap back instead of sliding.
    this.returning=mode==='idle' && toHome(this.pathAngle)>.02 && motionEnabled();
    this.mode=mode;
    for(const button of this.modeControls?.children||[])button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    this.closest('.featured-stage')?.classList.toggle('is-battle',mode==='battle');
    this.closest('.featured-stage')?.classList.toggle('is-walk',mode==='walk'||mode==='policy');
    if(this.clipControls)this.clipControls.hidden=mode!=='policy';
    if(this.discoControls)this.discoControls.hidden=mode!=='disco';
    if(mode==='disco'){if(!this.discoAudio?.playing)this.startDisco();}
    else this.discoAudio?.stop();
    if(mode==='policy')this.playClip(this.clipName||'kick_right');
    else if(this.policyRobot && !this.exact){this.policyRobot.root.visible=false;this.robot.visible=true;}
    this.updateStatus();this.dirty=true;wake();
  }
  async startDisco(file){
    // Audio may only start from a click, which is where this is always called from.
    const {DiscoAudio,danceCommands}=await (this.discoModule??=import('./disco.js'));
    this.danceCommands=danceCommands;this.discoAudio??=new DiscoAudio();
    try{
      if(file){this.discoTrack='FINDING THE BEAT…';this.updateStatus();await this.discoAudio.playFile(file);}
      else this.discoAudio.playDemo();
      this.discoTrack=`${file?file.name.replace(/\.[^.]+$/,'').slice(0,28).toUpperCase():'DEMO BEAT'} · ${Math.round(this.discoAudio.bpm)} BPM`;
    }catch(error){console.warn('Ducktown: could not play that audio.',error);this.discoTrack='COULD NOT PLAY THAT FILE';}
    if(this.mode!=='disco')this.discoAudio.stop();
    this.discoDemo?.setAttribute('aria-pressed',String(!file));this.discoSong?.setAttribute('aria-pressed',String(!!file));
    this.updateStatus();this.dirty=true;wake();
  }
  async downloadScore(){
    const {buildScore}=await (this.discoModule??=import('./disco.js'));
    const score=buildScore({bpm:this.discoAudio?.bpm||118});
    const url=URL.createObjectURL(new Blob([JSON.stringify(score)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`duck-disco-${Math.round(score.bpm)}bpm.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async loadExactDuck(){
    if(this.exactLoading)return;this.exactLoading=true;
    // Pollen's exact robot becomes the hero: driven through its 14 real joints by our motion system,
    // or replaying recorded policies. The hand-built duck is only the placeholder while it loads.
    try{
      const [replay,{ExactDuck,quatFromEuler}]=await Promise.all([import('./policy-replay.js'),import('./exact-duck.js')]);
      const onProgress=p=>{this.dataset.progress=String(Math.round(p*100));};
      const [robot,tree]=await Promise.all([this.policyRobot||replay.loadPolicyRobot({onProgress}),replay.loadTree()]);
      if(!this.scene)return robot.dispose?.();
      if(!this.policyRobot){
        this.policyRobot=robot;
        robot.root.matrix.premultiply(new THREE.Matrix4().makeTranslation(0,-.24,0));
        robot.setColorway(PALETTES[this.variant]);this.scene.add(robot.root);
      }
      this.replay=replay;this.exact=new ExactDuck(tree);this.quatFromEuler=quatFromEuler;
      this.policyRobot.root.visible=true;this.robot.visible=false;this.dataset.exact='ready';
      this.updateStatus();this.dirty=true;wake();
    }catch(error){console.warn('Ducktown: exact robot unavailable; keeping the illustrated duck.',error);this.exactFailed=true;this.robot.visible=true;this.dirty=true;wake();}
  }
  poseExact(motion,crouch,sway,breathe){
    // Ducktown motion -> Pollen's real joints. Scene is cm (y up, z forward); MuJoCo is m (z up, x forward).
    const yaw=wrapAngle(this.heading)*this.faceBlend,[px,pz]=this.pathPoint(),cy=Math.cos(yaw),sy=Math.sin(yaw);
    const ground={pos:[pz/100,px/100,0],yawQuat:this.quatFromEuler(0,0,yaw)};
    // The real leg has no ankle roll, so the pelvis shift is kept small to keep soles flat (~3°).
    const shift=motion.shift*.0032,drop=Math.max(-.01,(crouch-.85)*.008);
    const trunk={
      pos:[ground.pos[0]-sy*shift,ground.pos[1]+cy*shift,this.exact.standHeight-drop],
      quat:this.quatFromEuler(sway*.006+motion.hipRoll+motion.roll*.4,motion.lean,yaw)
    };
    // Reach must match body travel 1:1 (cm -> m) or planted feet skid; only step height is scaled down.
    // The illustrated duck's 'right' leg sits on scene +x, which is the real robot's LEFT side
    // (MuJoCo +y). Map by side, not by name, so the stance foot and turn compensation line up.
    const feet={left:{lift:motion.lift*.008,reach:motion.reach*.01},right:{lift:motion.liftL*.008,reach:motion.reachL*.01}};
    const head={neck:motion.neck,pitch:motion.pitch-motion.lean*.6+this.gaze.pitch+breathe*.008,yaw:motion.yaw+this.gaze.yaw,roll:motion.roll-sway*.006};
    const poses=this.exact.solve({trunk,ground,feet,head});
    for(const [name,{pos,quat}] of poses){
      const body=this.policyRobot.bodies.get(name);
      if(body){body.position.set(pos[0],pos[1],pos[2]);body.quaternion.set(quat[1],quat[2],quat[3],quat[0]);}
    }
    this.policyRobot.bodies.get('ball').visible=false;
  }
  async playClip(name){
    // Load Pollen's exact robot once, then swap it in for the hand-built duck while replaying.
    this.clipName=name;
    for(const b of this.clipControls?.children||[])b.setAttribute('aria-pressed',String(b.dataset.clip===name));
    try{
      const replay=await import('./policy-replay.js');
      if(!this.policyRobot){
        this.policyRobot=await replay.loadPolicyRobot();
        this.policyRobot.root.matrix.premultiply(new THREE.Matrix4().makeTranslation(0,-.24,0));
        this.policyRobot.setColorway(PALETTES[this.variant]);
        this.scene?.add(this.policyRobot.root);
      }
      const clip=await replay.loadClip(name);
      if(this.clipName!==name || !this.scene)return;
      this.replay=replay;this.clip=clip;this.clipTime=0;
      this.clipNote=replay.POLICY_CLIPS.find(c=>c.id===name).note;
      const on=this.mode==='policy'||!!this.exact;
      this.policyRobot.root.visible=on;this.robot.visible=!on;
      this.updateStatus();this.dirty=true;wake();
    }catch(error){console.warn('Ducktown: policy replay unavailable.',error);}
  }
  tapBall(event){
    // Tap the red ball: the duck kicks it with Pollen's real kick policy, then goes back to playing.
    if(!this.ball?.visible || !this.exact || !motionEnabled())return;
    const rect=this.canvas.getBoundingClientRect();
    const ndc=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    const ray=new THREE.Raycaster();ray.setFromCamera(ndc,this.camera);
    // Generous hit area: the ball is small on screen.
    const hit=ray.ray.distanceToPoint(this.ball.getWorldPosition(new THREE.Vector3()))<6;
    if(!hit)return;
    this.autoReturn=true;this.setMode('policy');this.playClip('kick_right');
  }
  stomp(){
    if(!motionEnabled())return;
    if(this.mode==='policy'){this.clipTime=0;this.dirty=true;wake();return;}
    this.stompT=0;this.stompScale=this.mode==='walk'?.45:1;this.dirty=true;wake();
  }
  isPlaying(){
    return motionEnabled() && this.stage?.classList.contains('is-playing') && !this.stage.classList.contains('is-paused') &&
      (!this.card || this.card.matches(':hover,:focus-within') || this.touchPressed) &&
      !(document.body.classList.contains('has-modal') && this.closest('#view'));
  }
  isAlive(){
    // Ambient life (breathing, weight shift, gaze) keeps the hero feeling present; cards wake on hover.
    return motionEnabled() && this.visible && (this.isHero || this.isPlaying() || this.battleBlend>0 || this.walkBlend>0 || this.discoBlend>0 || this.mode==='policy' || this.mode==='disco') && !this.stage?.classList.contains('is-paused');
  }
  pose(){
    const t=this.time, l=this.life, motion=sampleMotion(this.behavior,t);
    if(this.gaitTotal>0){
      // One gait, one step rhythm: switching modes morphs stride, speed and stance instead of
      // crossfading two out-of-step cycles.
      const gait=sampleGait(this.gaitPhase,this.gaitParams,this.gaitTurn),k=this.gaitTotal;
      for(const key in motion)motion[key]+=(gait[key]-motion[key])*k;
    }
    if(this.stompT<.7){
      // Stomp: quick wind-up, heavy drop, roar, recover.
      const x=this.stompT/.7,hit=Math.sin(Math.PI*Math.min(1,x*1.4))*(this.stompScale??1);
      motion.crouch+=1.4*hit;motion.jaw=Math.max(motion.jaw,.34*hit);motion.pitch-=.18*hit;motion.lean+=.08*hit;
    }
    const beat=this.discoBlend>0&&this.danceCommands?this.discoAudio?.now():null;
    if(beat){
      // The dance arrives as real robot commands (robot.pose / robot.head / robot.mouth) and is
      // mapped onto the same channels, so the servo model and IK below treat it like any motion.
      const c=this.danceCommands(beat.beat,beat.energy),k=this.discoBlend;
      motion.crouch+=-c.pose.z/.008*k;motion.hipRoll+=c.pose.roll*k;motion.lean+=c.pose.pitch*k;
      motion.neck+=c.head.neck_pitch*k;motion.pitch+=c.head.head_pitch*k;motion.yaw+=c.head.head_yaw*k;motion.roll+=c.head.head_roll*k;
      motion.jaw=Math.max(motion.jaw,c.mouth.open*.3*k);
    }
    this.updateGlance(l);
    motion.yaw+=this.glance.yaw;motion.pitch+=this.glance.pitch;
    this.servoFilter(motion);
    const breathe=Math.sin(l*1.9), sway=Math.sin(l*.73)*.6+Math.sin(l*1.31)*.4;
    // Expressive overlay is tiny so authored clips still read clearly; feet stay planted.
    this.robot.rotation.z=sway*.006+motion.hipRoll;
    // Ready stance: knees always a little bent, with a soft bounce, like the real ducks.
    const crouch=.85+(motionEnabled()?breathe*.12:0)+motion.crouch;
    // Tipping rotates about the feet; lift by the shell's half-depth so the back rests on the floor.
    // While lying, crouch tucks the legs toward the body instead of sinking it.
    this.robot.rotation.x=-motion.tip;
    const path=this.pathPoint(),yaw=wrapAngle(this.heading)*this.faceBlend;
    // Rocking over a foot sinks that foot's outer edge; lift by the same amount so it rests on the floor.
    const rock=Math.sin(Math.abs(motion.hipRoll))*5.35;
    // Pelvis shift: the body slides sideways over the stance foot (in its own frame) while the feet stay put.
    const sx=Math.cos(yaw)*motion.shift,sz=-Math.sin(yaw)*motion.shift;
    this.robot.position.set(path[0]+sx,Math.sin(motion.tip)*3.4-crouch*Math.cos(motion.tip)+rock,path[1]+sz);
    const torso=this.robot.getObjectByName('torso');
    if(torso){torso.userData.baseY??=torso.position.y;torso.position.y=torso.userData.baseY+breathe*.04;torso.rotation.set(motion.lean,0,motion.roll*.4);}
    for(const side of ['left','right']){
      const right=side==='right',lift=right?motion.lift:motion.liftL,reach=right?motion.reach:motion.reachL;
      // Hip roll + pitch solve: the ankle stays on its spot as the pelvis shifts, sole kept flat.
      const leg=solveLeg3D(-motion.shift,ANKLE_REST+crouch+lift,reach);
      this.rig[`leg-${side}`].rotation.set(leg.hip,0,leg.roll);
      this.rig[`shin-${side}`].rotation.x=leg.knee;
      // Toe flick only while the foot is in the air (kicks); a planted sole stays flat on the ground.
      this.rig[`foot-${side}`].rotation.set(leg.foot-reach*.05*Math.min(1,lift),0,leg.footRoll);
    }
    // Head stabilisation: like a bird, the head holds level against the body's lean and roll;
    // it moves in quick glances that hold, rather than drifting.
    this.head.rotation.set(HEAD_LEVEL+motion.pitch-motion.lean*.6+this.gaze.pitch+breathe*.008,motion.yaw+this.gaze.yaw,motion.roll-sway*.006-motion.hipRoll);
    this.neck.rotation.x=NECK_LEAN+motion.neck;
    if(motion.tip>.001)this.restOnFloor();
    else if(this.groundLevel===undefined && !motion.lift && !motion.liftL)this.groundLevel=this.lowestPoint();
    this.jaw.rotation.x=Math.max(this.jawAngle,this.chirp||0,motion.jaw);
    this.robot.rotation.y=wrapAngle(this.heading)*this.faceBlend;
    if(this.ball){
      this.ball.position.set(motion.ball,1.13,3);
      this.ball.rotation.z=-this.ball.position.x/1.35;
    }
    if(this.exact && this.mode!=='policy' && motion.tip<.001)this.poseExact(motion,crouch,sway,breathe);
    this.dataset.poseTime=t.toFixed(3);
  }
  ensureCity(){
    // The hero duck stands in a real city (a 360° photo capture). Built once the renderer exists,
    // because the photo's HDR light is prefiltered on the GPU for the duck's reflections.
    if(this.city || !this.isHero || !renderer)return;
    this.city=buildCity({renderer,lite:LITE});
    this.scene.add(this.city.group);this.camera.far=this.city.farPlane;
    this.city.ready.then(ok=>{
      if(!ok || !this.scene)return;
      // Let the place light the duck: blue-hour sky fill from the photo, a softer warm key for the
      // contact shadow (like the street lamp), a cool rim, and a firmer shadow on the paving.
      this.hemi.intensity=.18;this.keyLight.color.set('#ffd2a1');this.keyLight.intensity=1.5;
      this.fillLight.intensity=.25;this.rimLight.color.set('#bcd3ff');this.rimLight.intensity=1.1;
      this.scene.environmentIntensity=1.05;this.floor.material.opacity=.38;
      this.dirty=true;wake();
    }).catch(error=>console.warn('Ducktown: city backdrop unavailable; keeping the studio stage.',error));
  }
  servoFilter(motion){
    // Sample-and-hold the commands at 50 Hz, then integrate each channel as a damped spring.
    const dt=Math.min(this.frameDt||0,.1);
    if(!this.servo || !motionEnabled()){
      this.servo=Object.fromEntries(SERVO_CHANNELS.map(key=>[key,{pos:motion[key],vel:0,cmd:motion[key]}]));
      this.servoClock=0;return;
    }
    this.servoClock+=dt;
    const latch=this.servoClock>=1/SERVO.hz;
    if(latch)this.servoClock%=1/SERVO.hz;
    const {omega,zeta}=SERVO,steps=Math.max(1,Math.ceil(dt/.004)),h=dt/steps;
    for(const key of SERVO_CHANNELS){
      const s=this.servo[key];
      if(latch)s.cmd=motion[key];
      for(let i=0;i<steps;i++){s.vel+=(omega*omega*(s.cmd-s.pos)-2*zeta*omega*s.vel)*h;s.pos+=s.vel*h;}
      motion[key]=s.pos;
    }
    // Feet can't push into the floor: a lifted foot settles to the ground, never below it.
    motion.lift=Math.max(0,motion.lift);motion.liftL=Math.max(0,motion.liftL);
  }
  updateGlance(l){
    // Every couple of seconds the duck glances somewhere new and holds it; the servo makes the move quick.
    this.glance??={yaw:0,pitch:0,next:1.5};
    if(!motionEnabled()){this.glance.yaw=this.glance.pitch=0;return;}
    if(l>=this.glance.next){
      const walking=this.gaitTotal>.5;
      this.glance.yaw=(Math.random()-.5)*(walking?.3:.5);this.glance.pitch=(Math.random()-.5)*.14;
      this.glance.next=l+1.2+Math.random()*2.6;
    }
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
    const ramp=motionEnabled()?1-Math.exp(-dt*5):1,blend=(value,target)=>Math.abs(target-value)<.002?target:value+(target-value)*ramp;
    const remaining=toHome(this.pathAngle);
    if(this.returning && (remaining<.02 || this.mode!=='idle')){this.returning=false;if(remaining<.02)this.pathAngle=0;}
    this.walkBlend=blend(this.walkBlend,this.mode==='walk'||this.returning?1:0);
    // Ease into home over the last stretch so the duck stops on its spot rather than overshooting.
    if(this.returning)this.walkBlend=Math.min(this.walkBlend,Math.max(.08,remaining/.6));
    this.battleBlend=blend(this.battleBlend,this.mode==='battle'?1:0);
    this.discoBlend=blend(this.discoBlend||0,this.mode==='disco'&&this.discoAudio?.playing?1:0);
    const sum=this.walkBlend+this.battleBlend,share=sum>0?this.battleBlend/sum:0;
    this.gaitTotal=Math.min(1,sum);this.gaitParams=mixGait(REAL_GAIT,GAIT,share);
    this.gaitPhase=(this.gaitPhase+dt*this.gaitParams.cadence*this.gaitTotal)%1;
    // The planted foot slides back at stanceSpeed: the walk share carries the body forward along
    // the loop, the battle share scrolls the floor stripes instead (running on the spot).
    const footSpeed=stanceSpeed(this.gaitParams)*this.gaitTotal,scroll=footSpeed*share;
    // Once idle and home, the fading gait settles in place rather than creeping past the start.
    const travel=this.mode!=='idle'||this.returning?footSpeed*(1-share):0;
    if(travel>0){
      const tangent=Math.hypot(PATH.x*Math.cos(this.pathAngle),PATH.z*Math.sin(this.pathAngle));
      this.pathAngle+=dt*travel/Math.max(.5,tangent);
      const θ=this.pathAngle,dx=PATH.x*Math.cos(θ),dz=-PATH.z*Math.sin(θ),ddx=-PATH.x*Math.sin(θ),ddz=-PATH.z*Math.cos(θ);
      this.heading+=wrapAngle(Math.atan2(dx,dz)-this.heading);
      // Signed curvature (heading change per cm) × the feet's 3.65 cm offset from the centre line.
      // Use the feet's real distance from the centre line (Pollen's robot once loaded).
      const footSpan=this.exact?Math.abs(this.exact.footOffset.left[1])*100:3.65;
      this.turn=Math.max(-.85,Math.min(.85,(dz*ddx-dx*ddz)/Math.hypot(dx,dz)**3*footSpan));
    }
    this.gaitTurn=(this.turn||0)*(1-share);
    if(sum===0 && toHome(this.pathAngle)<.02)this.pathAngle=0;
    // Face along the loop while away from home or walking; turn back to the camera once home.
    this.faceBlend=blend(this.faceBlend,this.mode==='walk'||toHome(this.pathAngle)>.02?1:0);
    if(this.stompT<.7)this.stompT+=dt;
    if(this.track){
      this.track.material.opacity=.9*this.battleBlend;
      // The track sits under the duck wherever it is on the loop, aligned with its heading.
      const [tx,tz]=this.pathPoint();this.track.position.set(tx,-.2,tz);
      this.track.rotation.set(-Math.PI/2,wrapAngle(this.heading)*this.faceBlend,0,'YXZ');
      // The plane's v axis points backward along the duck; lowering the offset carries stripes back with the planted foot.
      this.track.material.map.offset.y=(this.track.material.map.offset.y-dt*scroll/16+1)%1;
    }
    if(this.ball)this.ball.visible=this.battleBlend<.5&&this.walkBlend<.5&&!this.discoBlend;
    // Footfall impact: a small camera kick each time a foot plants, plus a big one for a stomp.
    const footfall=Math.max(0,Math.cos(this.gaitPhase*Math.PI*4))**12*this.battleBlend;
    const stompKick=this.stompT<.7?Math.max(0,Math.sin(Math.PI*Math.min(1,this.stompT/.7*1.4)))**6:0;
    this.shake=motionEnabled()?footfall*.18+stompKick*.6:0;
    const g=motionEnabled()?1-Math.exp(-dt*(this.mode==='battle'?9:5)):1;
    this.gaze.yaw+=(this.targetGaze.yaw-this.gaze.yaw)*g;this.gaze.pitch+=(this.targetGaze.pitch-this.gaze.pitch)*g;
    if(motionEnabled()){const k=Math.min(1,dt*10);this.yaw+=(this.targetYaw-this.yaw)*k;this.pitch+=(this.targetPitch-this.pitch)*k;}
    else {this.yaw=this.targetYaw;this.pitch=this.targetPitch;}
    if(motionEnabled())this.jawAngle+=(this.targetJawAngle-this.jawAngle)*(1-Math.exp(-dt*14));
    else this.jawAngle=this.targetJawAngle;
    if(Math.abs(this.targetJawAngle-this.jawAngle)<.001)this.jawAngle=this.targetJawAngle;
    this.frameDt=dt;
    this.pose();
    const jitter=this.shake*Math.sin(this.life*90);
    // Spherical orbit around the duck; the focus glides most of the way after it on its loop, so it
    // stays in view from above or below while still visibly travelling around the stage.
    const replaying=this.mode==='policy'&&this.clip;
    if(replaying){
      // Real replay: advance the sim clock, hold the last frame a moment, then loop.
      if(motionEnabled())this.clipTime+=dt;
      if(this.clipTime>this.clip.duration+1.2){
        if(this.autoReturn){this.autoReturn=false;this.setMode('idle');}
        else this.clipTime=0;
      }
      this.replay.applyClip(this.policyRobot,this.clip,Math.min(this.clipTime,this.clip.duration));
    }
    const [px,pz]=replaying?this.replay.clipTrunk(this.clip,Math.min(this.clipTime,this.clip.duration)).map(v=>v*FOLLOW):this.pathPoint().map(v=>v*FOLLOW),follow=motionEnabled()?1-Math.exp(-dt*4):1;
    this.focus.x+=(px-this.focus.x)*follow;this.focus.z+=(pz-this.focus.z)*follow;
    const target=this.isHero?12.6:13,radius=this.isHero?(this.clientWidth<600?HERO_RADIUS_NARROW:HERO_RADIUS):CARD_RADIUS,flat=Math.cos(this.pitch)*radius,fx=this.focus.x,fz=this.focus.z+1.6;
    this.camera.position.set(fx+Math.sin(this.yaw)*flat+jitter,target+Math.sin(this.pitch)*radius+this.shake*Math.cos(this.life*70),fz+Math.cos(this.yaw)*flat);
    // Frame the taller, forward-leaning silhouette (head rides ahead of the hips).
    this.camera.lookAt(fx,target,fz);
    const bounds=this.getBoundingClientRect();
    if(bounds.width<1 || bounds.height<1)return;
    const dpr=Math.min(devicePixelRatio||1,this.isHero?2:1.5),limit=this.isHero?1200:700,w=Math.min(limit,Math.round(bounds.width*dpr)),h=Math.min(limit,Math.round(bounds.height*dpr));
    if(this.canvas.width!==w || this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    // The hero canvas fills the stage so the city has no gaps, but the duck keeps its old frame:
    // the band 32px below the top and 42px above the bottom, clear of the player bar.
    // Cinematic hero: keep the duck clear of the dock (bottom) and, on wide screens, of the headline
    // (left) by framing it in the right part of the stage.
    const scale=h/bounds.height,wide=bounds.width>=600&&bounds.width/bounds.height>.9;
    // Phones: the headline fills the top of the stage, so the duck stands in the lower half.
    const top=this.isHero?bounds.height*(wide?.06:.42)*scale:0,bottom=this.isHero?(wide?96:150)*scale:0,frameH=this.isHero?h-top-bottom:h;
    this.camera.aspect=w/frameH;
    if(this.isHero)this.camera.setViewOffset(w,frameH,wide?-w*.2:0,-top,w,h);
    // Fit the full robot even in narrow containers; cards keep a roomy studio crop.
    this.camera.fov=this.isHero?32:34;
    if(this.camera.aspect<.85)this.camera.fov=39;
    this.camera.updateProjectionMatrix();this.scene.environment=this.city?.environment||environment;
    this.ensureCity();
    this.city?.update(this.camera);
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
  const modalOpen=document.body.classList.contains('has-modal');
  for(const item of active){
    if(!item.visible)continue;
    // A dialog covers the page views: keep them dirty and redraw once it closes.
    if(modalOpen && item.closest('#view'))continue;
    const changingAngle=Math.abs(item.targetYaw-item.yaw)+Math.abs(item.targetPitch-item.pitch)+Math.abs(item.focus.x-item.pathPoint()[0]*FOLLOW)+Math.abs(item.focus.z-item.pathPoint()[1]*FOLLOW)>.001;
    const changingJaw=Math.abs(item.targetJawAngle-item.jawAngle)>.001;
    const changingGaze=Math.abs(item.targetGaze.yaw-item.gaze.yaw)+Math.abs(item.targetGaze.pitch-item.gaze.pitch)>.001;
    const moving=item.isPlaying() || item.isAlive() || item.stompT<.7 || (item.battleBlend>0 && item.battleBlend<1) || item.walkBlend>0 || item.faceBlend%1>0 || changingAngle || changingJaw || changingGaze;
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
