// Dev tool (render-places.html): the Town Map's places as small real-scale dioramas. Props are CC0
// Poly Haven models (tools/fetch-place-assets.mjs); the robot is Pollen's exact Microduck, posed
// through its real joints. Units are centimetres, y up, like the rest of Ducktown.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadPolicyRobot, loadTree, loadClip, applyClip } from './policy-replay.js';
import { ExactDuck, quatFromEuler } from './exact-duck.js';

const W = 1200, H = 900, FLOOR = .4;
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.setClearColor(0, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), .04).texture;

const loader = new GLTFLoader();
const models = new Map();
// `only` keeps the named variants of a multi-variant asset (Poly Haven lays them out in a row).
async function model(id, only) {
  if (!models.has(id)) models.set(id, loader.loadAsync(`/place-assets-cache/${id}/${id}.gltf`).then(g => g.scene));
  const src = await models.get(id);
  let m = src.clone(true);
  if (only) {
    const keep = new THREE.Group();
    for (const child of [...m.children]) if (only.includes(child.name)) { child.position.x = 0; child.position.z = 0; keep.add(child); }
    m = keep;
  }
  m.scale.setScalar(100); // metres -> cm
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return m;
}
const boxOf = o => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
// Put a prop on the floor (or on top of another object) at x,z, optionally resized to a height.
async function put(scene, id, {x = 0, z = 0, rot = 0, height, width, on, only, lie} = {}) {
  const m = await model(id, only);
  if (lie) { const g = new THREE.Group(); m.rotation.x = -Math.PI / 2; g.add(m); g.scale.copy(m.scale); m.scale.setScalar(1); g.rotation.y = rot; return place(scene, g, {x, z, height, width, on}); }
  m.rotation.y = rot;
  return place(scene, m, {x, z, height, width, on});
}
function place(scene, m, {x, z, height, width, on}) {
  if (height || width) {
    const s = boxOf(m).getSize(new THREE.Vector3());
    m.scale.multiplyScalar(height ? height / s.y : width / Math.max(s.x, s.z));
  }
  const b = boxOf(m), base = on ? boxOf(on).max.y : FLOOR;
  m.position.set(x - (b.min.x + b.max.x) / 2 + m.position.x, base - b.min.y, z - (b.min.z + b.max.z) / 2 + m.position.z);
  scene.add(m);
  return m;
}

const robot = await loadPolicyRobot(), tree = await loadTree(), duck = new ExactDuck(tree);
robot.setColorway({shell: '#f7e6cb', trim: '#ed722c', sole: '#f6cb37'});
const holder = new THREE.Group(); holder.add(robot.root);
const POSES = {
  stand: {head: {pitch: .05}}, hello: {head: {pitch: -.28, yaw: .35, roll: .32}}, look: {head: {pitch: -.05, yaw: .6}},
  lookdown: {lean: .08, head: {neck: .3, pitch: .55}}, dance: {roll: .16, drop: .012, head: {roll: -.3, yaw: -.25, pitch: .1}},
  sit: {drop: .022, lean: .05, head: {pitch: -.2}}, kick: {clip: 'kick_right', t: 1.0}
};
async function poseRobot(name) {
  const p = POSES[name];
  if (p.clip) { applyClip(robot, await loadClip(p.clip), p.t); return; }
  const trunk = {pos: [0, 0, duck.standHeight - (p.drop || 0)], quat: quatFromEuler(p.roll || 0, p.lean || 0, 0)};
  const ground = {pos: [0, 0, 0], yawQuat: [1, 0, 0, 0]};
  let poses; for (let i = 0; i < 4; i++) poses = duck.solve({trunk, ground, feet: {}, head: p.head});
  for (const [body, {pos, quat}] of poses) {
    const b = robot.bodies.get(body);
    if (b) { b.position.set(...pos); b.quaternion.set(quat[1], quat[2], quat[3], quat[0]); }
  }
  robot.bodies.get('ball').visible = false;
}
// Stand the duck at x,z on the floor or on top of an object, facing `rot` (0 = toward +z).
async function putDuck(scene, {x = 0, z = 0, rot = 0, on, pose = 'stand', y} = {}) {
  await poseRobot(pose);
  holder.rotation.y = rot; holder.position.set(0, 0, 0);
  const b = boxOf(holder), base = y ?? (on ? boxOf(on).max.y : FLOOR);
  holder.position.set(x, base - b.min.y + .05, z);
  scene.add(holder);
  return holder;
}

function stage(scene, {radius = 90, color = '#e9e1d2', top = '#efe8db'} = {}) {
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, 10, 96), new THREE.MeshStandardMaterial({color, roughness: .85}));
  plinth.position.y = -5; plinth.receiveShadow = true; scene.add(plinth);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(radius * .985, radius * .985, .6, 96), new THREE.MeshStandardMaterial({color: top, roughness: .9}));
  lip.position.y = .1; // top at y = .4: above the plinth top, so the two never z-fight lip.receiveShadow = true; scene.add(lip);
}
function lights(scene, {key = '#fff2e2', intensity = 2.4, from = [120, 220, 160]} = {}) {
  scene.environment = envMap; scene.environmentIntensity = .9;
  const k = new THREE.DirectionalLight(key, intensity);
  k.position.set(...from); k.castShadow = true; k.shadow.mapSize.set(4096, 4096); k.shadow.radius = 5; k.shadow.bias = -.0006; k.shadow.normalBias = .6;
  Object.assign(k.shadow.camera, {left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 800});
  scene.add(k, new THREE.HemisphereLight('#fdf7ee', '#c9bba4', .35));
}

const SCENES = {
  async pond(scene) {
    lights(scene); stage(scene, {radius: 95, color: '#d9cfbb', top: '#cbbf9f'});
    const water = new THREE.Mesh(new THREE.CircleGeometry(52, 96), new THREE.MeshPhysicalMaterial({color: '#2f7f8f', roughness: .04, metalness: .1, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: 1.4}));
    water.rotation.x = -Math.PI / 2; water.position.set(-8, .55, -6); water.receiveShadow = true; scene.add(water);
    const rock = await put(scene, 'coast_rocks_01', {x: 34, z: 26, width: 48, rot: .6});
    await put(scene, 'coast_rocks_02', {x: -52, z: 36, width: 40, rot: 2});
    await put(scene, 'fern_02', {x: -58, z: -52, height: 46, only: ['fern_02_b']});
    await put(scene, 'fern_02', {x: 62, z: -44, height: 38, only: ['fern_02_a'], rot: 1.2});
    await put(scene, 'grass_medium_01', {x: 66, z: 4, height: 22, only: ['grass_medium_01_tall_a_LOD0']});
    await put(scene, 'grass_medium_01', {x: -70, z: 6, height: 18, rot: 1.4, only: ['grass_medium_01_mid_b_LOD0']});
    await putDuck(scene, {x: 34, z: 26, on: rock, pose: 'hello', rot: -.5});
    return {target: [20, 14, 14], dist: 200, yaw: .5, pitch: .42};
  },
  async workshop(scene) {
    lights(scene); stage(scene, {radius: 110, color: '#d8d2c6', top: '#bfb7a8'});
    const table = await put(scene, 'WoodenTable_01', {width: 150});
        await put(scene, 'metal_toolbox', {x: 48, z: -14, height: 18, on: table, rot: -.4});
    await put(scene, 'desk_lamp_arm_01', {x: 58, z: 20, height: 45, on: table, rot: -2.2});
    await put(scene, 'adjustable_wrench', {x: -30, z: 22, width: 22, on: table, rot: .8, lie: true});
    await putDuck(scene, {x: 6, z: 2, on: table, pose: 'lookdown', rot: -.3});
    return {target: [10, 84, 4], dist: 165, yaw: .55, pitch: .36};
  },
  async arena(scene) {
    lights(scene, {key: '#ffe2c4', intensity: 1.6}); stage(scene, {radius: 90, color: '#2f343b', top: '#d9d2c4'});
    for (const [c, x] of [['#ff9a5a', -120], ['#7fc8ff', 120]]) {
      const s = new THREE.SpotLight(c, 9e4, 0, .38, .6, 2); s.position.set(x, 260, 120); s.target.position.set(0, 0, 0);  scene.add(s, s.target);
    }
    await put(scene, 'boombox', {x: -44, z: -20, height: 26, rot: .5});
    await put(scene, 'football', {x: 42, z: 30, height: 9, only: ['football_inflated']});
    await putDuck(scene, {x: 6, z: 6, pose: 'dance', rot: .2});
    return {target: [0, 13, 0], dist: 175, yaw: .3, pitch: .32};
  },
  async perch(scene) {
    lights(scene); stage(scene, {radius: 120, color: '#e5dccb', top: '#d6c7ad'});
    await put(scene, 'ArmChair_01', {x: -40, z: -30, height: 95, rot: .5});
    const ct = await put(scene, 'CoffeeTable_01', {x: 40, z: 20, width: 80, rot: .1});
    await put(scene, 'classic_laptop', {x: 56, z: 10, width: 30, on: ct, rot: -.6});
    await put(scene, 'calathea_orbifolia_01', {x: 78, z: -56, height: 60, only: ['calathea_orbifolia_01_b']});
    await putDuck(scene, {x: 26, z: 26, on: ct, pose: 'hello', rot: .4});
    return {target: [22, 44, 14], dist: 215, yaw: .5, pitch: .32};
  },
  async residents(scene) {
    lights(scene); stage(scene, {radius: 110, color: '#c9d4b5', top: '#a9bf88'});
    await put(scene, 'painted_wooden_bench', {x: -20, z: -42, width: 120});
    await put(scene, 'planter_box_01', {x: 64, z: -30, width: 50, rot: -.6});
    await put(scene, 'pachira_aquatica_01', {x: -78, z: -10, height: 110, only: ['pachira_aquatica_01_bark_b', 'pachira_aquatica_01_leaves_b']});
    await put(scene, 'garden_gnome', {x: 40, z: 30, height: 30, rot: -.5});
    await putDuck(scene, {x: 2, z: 32, pose: 'look', rot: 1.0});
    return {target: [14, 22, 18], dist: 200, yaw: .45, pitch: .3};
  },
  async school(scene) {
    lights(scene); stage(scene, {radius: 110, color: '#dfd8cc', top: '#c8b99f'});
    const desk = await put(scene, 'SchoolDesk_01', {height: 76, rot: 0});
    await put(scene, 'SchoolChair_01', {z: 58, height: 82, rot: Math.PI});
    await put(scene, 'book_encyclopedia_set_01', {x: -24, z: -6, width: 30, on: desk, rot: .3});
    await putDuck(scene, {x: 16, z: 4, on: desk, pose: 'lookdown', rot: -.4});
    return {target: [6, 84, 2], dist: 175, yaw: .55, pitch: .34};
  }
};

window.renderPlace = async name => {
  const scene = new THREE.Scene();
  const view = await SCENES[name](scene);
  const camera = new THREE.PerspectiveCamera(28, W / H, 5, 3000);
  const [tx, ty, tz] = view.target;
  camera.position.set(tx + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, ty + Math.sin(view.pitch) * view.dist, tz + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  camera.lookAt(tx, ty, tz);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', .9);
  scene.remove(holder);
  return url;
};
window.PLACES = Object.keys(SCENES);
window.renderReady = true;
