// Dev tool (see render-duck.html): studio stills of Pollen's exact Microduck, posed through its
// real joints (ExactDuck IK) or taken from recorded policy clips, on a transparent background.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadPolicyRobot, loadTree, loadClip, applyClip } from './policy-replay.js';
import { ExactDuck, quatFromEuler } from './exact-duck.js';

const PALETTES = {
  cream: {shell: '#f7e6cb', trim: '#ed722c', sole: '#f6cb37'},
  graphite: {shell: '#6c6a68', trim: '#f2ca4d', sole: '#7964a1'},
  lavender: {shell: '#bfa9cf', trim: '#f2ca4d', sole: '#7964a1'},
  sky: {shell: '#a9dbe8', trim: '#ed722c', sole: '#f6cb37'}
};
// Poses in the robot's own controls: trunk drop/lean/roll, head offsets (rad), or a policy frame.
export const POSES = {
  stand: {head: {pitch: .05}},
  bow: {lean: .1, head: {neck: .35, pitch: .45}},
  hello: {head: {pitch: -.28, yaw: .35, roll: .32}},
  look: {head: {pitch: -.05, yaw: .6}},
  dance: {roll: .16, drop: .012, head: {roll: -.3, yaw: -.25, pitch: .1}},
  balance: {roll: -.18, head: {roll: .22}},
  sit: {drop: .022, lean: .05, head: {pitch: -.2}},
  kick: {clip: 'kick_right', t: 1.0},
  pick: {clip: 'ground_pick', t: 1.2},
  roll: {clip: 'roulade', t: 1.5}
};

const SIZE = 720;
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE); renderer.setClearColor(0, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
const key = new THREE.DirectionalLight('#fff6ea', 2.2);
key.position.set(40, 90, 60); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6;
Object.assign(key.shadow.camera, {left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300});
scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({opacity: .22}));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const camera = new THREE.PerspectiveCamera(26, 1, 1, 1000);

const robot = await loadPolicyRobot(), tree = await loadTree(), duck = new ExactDuck(tree);
scene.add(robot.root);
const clips = {};

async function pose(name) {
  const p = POSES[name];
  if (p.clip) {
    clips[p.clip] ??= await loadClip(p.clip);
    applyClip(robot, clips[p.clip], p.t);
    return;
  }
  const trunk = {pos: [0, 0, duck.standHeight - (p.drop || 0)], quat: quatFromEuler(p.roll || 0, p.lean || 0, 0)};
  const ground = {pos: [0, 0, 0], yawQuat: [1, 0, 0, 0]};
  for (let i = 0; i < 3; i++) duck.solve({trunk, ground, feet: {}, head: p.head}); // let the IK settle
  for (const [body, {pos, quat}] of duck.solve({trunk, ground, feet: {}, head: p.head})) {
    const b = robot.bodies.get(body);
    if (b) { b.position.set(...pos); b.quaternion.set(quat[1], quat[2], quat[3], quat[0]); }
  }
  robot.bodies.get('ball').visible = false;
}

// Frame the robot's actual bounds so every pose fills the image the same way.
function frame(yaw) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  robot.root.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const dist = Math.max(s.y, Math.hypot(s.x, s.z)) / 2 / Math.tan(THREE.MathUtils.degToRad(13)) * 1.18;
  camera.position.set(c.x + Math.sin(yaw) * dist, c.y + dist * .22, c.z + Math.cos(yaw) * dist);
  camera.lookAt(c.x, c.y - s.y * .03, c.z);
}

window.renderDuck = async (variant, poseName, yaw = .55) => {
  robot.setColorway(PALETTES[variant]);
  await pose(poseName);
  frame(yaw);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/webp', .9);
};
window.POSES = Object.keys(POSES);
window.renderReady = true;
