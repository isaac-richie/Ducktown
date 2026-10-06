// Town Map scenes: small toy-style 3D dioramas, one per place, with Pollen's exact Microduck
// living in each (posed every frame through its real joints with ExactDuck). One shared WebGL
// renderer draws only the tiles on screen, about 30 times a second, into each tile's 2D canvas.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadPolicyRobot, loadTree } from './policy-replay.js';
import { ExactDuck, quatFromEuler } from './exact-duck.js';
import { danceCommands } from './disco.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-disabled');
const COLORWAYS = {
  cream: {shell: '#f7e6cb', trim: '#ed722c', sole: '#f6cb37'},
  graphite: {shell: '#6c6a68', trim: '#f2ca4d', sole: '#7964a1'},
  lavender: {shell: '#bfa9cf', trim: '#f2ca4d', sole: '#7964a1'},
  sky: {shell: '#a9dbe8', trim: '#ed722c', sole: '#f6cb37'}
};

// ---------- toy kit: chunky shapes in soft clay colours ----------
const clay = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .62, metalness: 0, ...extra});
function mesh(geometry, material, {x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s} = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); if (s) m.scale.setScalar(s);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const box = (w, h, d, color, at, r = 1.2) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), clay(color), at);
const cyl = (rt, rb, h, color, at, seg = 32) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), clay(color), at);
const ball = (r, color, at, mat) => mesh(new THREE.SphereGeometry(r, 32, 20), mat || clay(color), at);
function island(group, radius, top, side) {
  group.add(cyl(radius, radius * .96, 8, side, {y: -4.6}, 64));
  group.add(cyl(radius * .99, radius * .99, 1.2, top, {y: -.6}, 64));
}
function tree(x, z, h = 40, leaf = '#7fbf6a') {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(cyl(1.6, 2.2, h * .5, '#9a6b4b', {y: h * .25}, 12));
  for (const [dx, dy, dz, r] of [[0, .62, 0, .26], [-.12, .52, .08, .2], [.13, .55, -.06, .19], [0, .78, 0, .17]]) g.add(ball(h * r, leaf, {x: h * dx, y: h * dy, z: h * dz}));
  return g;
}
function house(x, z, color, roof, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  g.add(box(22, 18, 18, color, {y: 9}, 1.5));
  const r = mesh(new THREE.CylinderGeometry(.01, 15.5, 11, 4), clay(roof), {y: 23.5, ry: Math.PI / 4});
  r.scale.set(1, 1, .95); g.add(r);
  g.add(box(6, 10, 1, '#7a5541', {y: 5, z: 9.2}, .6));
  for (const sx of [-6.5, 6.5]) g.add(box(4.5, 4.5, .8, '#bfe3f2', {x: sx, y: 12, z: 9.2}, .4));
  return g;
}
function textTexture(lines, {w = 512, h = 320, bg = '#2f5a48', fg = '#f2f6ee', font = 'bold 74px system-ui'} = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => g.fillText(t, w / 2, h / (lines.length + 1) * (i + 1)));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// ---------- the robot ----------
let robotAssets = null;
function loadRobotAssets() {
  robotAssets ??= Promise.all([loadPolicyRobot(), loadTree()]).then(([robot, tree]) => ({robot, tree}));
  return robotAssets;
}
// A copy of Pollen's robot for one scene: shared geometry, its own materials (its own colourway).
function makeDuck({robot, tree}) {
  const root = robot.root.clone(true), bodies = new Map(), mats = new Map();
  root.traverse(o => {
    if (o.isMesh) { if (!mats.has(o.material)) mats.set(o.material, o.material.clone()); o.material = mats.get(o.material); }
  });
  for (const child of root.children) bodies.set(child.name, child);
  bodies.get('ball').visible = false;
  const holder = new THREE.Group(); holder.add(root);
  const duck = new ExactDuck(tree);
  return {holder, bodies, duck, mats};
}
// Pose: trunk drop (m), roll/lean (rad), head offsets (rad); feet stay planted on the floor.
function pose(d, {drop = 0, roll = 0, lean = 0, yaw = 0, head = {}}) {
  const trunk = {pos: [0, 0, d.duck.standHeight - drop], quat: quatFromEuler(roll, lean, yaw)};
  const result = d.duck.solve({trunk, ground: {pos: [0, 0, 0], yawQuat: [1, 0, 0, 0]}, feet: {}, head});
  for (const [name, {pos, quat}] of result) {
    const b = d.bodies.get(name);
    if (b) { b.position.set(pos[0], pos[1], pos[2]); b.quaternion.set(quat[1], quat[2], quat[3], quat[0]); }
  }
}
function placeDuck(d, scene, {x = 0, y = 0, z = 0, ry = 0}) {
  d.holder.position.set(x, y + .2, z); d.holder.rotation.y = ry; scene.add(d.holder);
}

// ---------- the six places ----------
const SCENES = {
  pond: {tint: '#d4ebe9', colorway: 'cream', view: {target: [-2, 8, 0], dist: 128, yaw: .55, pitch: .52}, build(scene, d) {
    // Land: grass top over a soil band, like a scoop of garden.
    const PX = -8, PZ = -4, PR = 33;
    scene.add(cyl(60, 54, 10, '#a8805c', {y: -5.6}, 72));
    // Grass top with a hole where the pond is (shape y maps to -z after the rotation).
    const lawn = new THREE.Shape(); lawn.absarc(0, 0, 60.5, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(PX, -PZ, PR + .4, 0, Math.PI * 2, true); lawn.holes.push(hole);
    const lg = new THREE.ExtrudeGeometry(lawn, {depth: 2.4, bevelEnabled: true, bevelThickness: .5, bevelSize: .5, bevelSegments: 3, curveSegments: 72});
    lg.rotateX(-Math.PI / 2); scene.add(mesh(lg, clay('#94cf72'), {y: -.6}));
    for (let i = 0; i < 12; i++) { const a = i * .52 + .2, r = 52 + (i % 3) * 2.5, m = ball(2.6 + (i % 3) * .8, '#8ec46b', {x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r}); m.scale.y = .6; scene.add(m); }
    // Pond bed and water: the bed shows through at the shallow edge.
    const wg = new THREE.CircleGeometry(PR, 64, 0, Math.PI * 2); wg.rotateX(-Math.PI / 2);
    const base = wg.attributes.position.array.slice();
    const colors = new Float32Array(wg.attributes.position.count * 3), deepC = new THREE.Color('#2f8fb5'), shallowC = new THREE.Color('#9be6e3'), tmp = new THREE.Color();
    for (let i = 0; i < wg.attributes.position.count; i++) {
      const r = Math.hypot(base[i * 3], base[i * 3 + 2]) / PR; tmp.copy(deepC).lerp(shallowC, Math.pow(r, 2.2)).toArray(colors, i * 3);
    }
    wg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const water = mesh(wg, new THREE.MeshPhysicalMaterial({vertexColors: true, roughness: .06, metalness: 0, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1.3}), {x: PX, y: .6, z: PZ});
    water.castShadow = false; scene.add(water);
    // Pebble shoreline.
    for (let i = 0; i < 34; i++) {
      const a = i / 34 * Math.PI * 2 + (i % 2) * .05, r = PR + 1.2 + (i % 3) * .9;
      const p = ball(1.6 + (i * 13 % 5) * .35, ['#cfc6b8', '#b8ad9c', '#e2dbcf', '#a99f90'][i % 4], {x: PX + Math.cos(a) * r, y: 2.2, z: PZ + Math.sin(a) * r});
      p.scale.y = .55; scene.add(p);
    }
    // Wooden dock reaching into the water; the duck stands at its end.
    const dock = new THREE.Group(); dock.position.set(PX + 30, 0, PZ + 10); dock.rotation.y = 2.6;
    for (let i = 0; i < 6; i++) dock.add(box(4.2, 1.2, 14, i % 2 ? '#c79363' : '#b98353', {x: i * 4.5, y: 2.6}, .4));
    for (const x of [0, 22.5]) for (const z of [-6, 6]) dock.add(cyl(.9, .9, 6, '#8d5f3c', {x, y: .6, z}, 10));
    scene.add(dock);
    dock.updateMatrixWorld();
    const dockEnd = new THREE.Vector3(18, 3.2, 0).applyMatrix4(dock.matrixWorld);
    placeDuck(d, scene, {x: dockEnd.x, y: dockEnd.y, z: dockEnd.z, ry: -.2});
    // Lily pads (one with a flower, one with a frog).
    const pad = (x, z, r) => { const g = new THREE.Group(); g.position.set(PX + x, .55, PZ + z); const m = mesh(new THREE.CylinderGeometry(r, r, .5, 28, 1, false, .35, Math.PI * 2 - .7), clay('#4fa35a'), {}); g.add(m); scene.add(g); return g; };
    const pads = [pad(-14, 6, 5), pad(4, -16, 4.2), pad(-6, -6, 3.4), pad(10, 8, 3.8)];
    const lotus = new THREE.Group(); for (let k = 0; k < 6; k++) { const pet = ball(1.4, '#f7a8c8', {x: Math.cos(k) * .9, y: 1.2, z: Math.sin(k) * .9}); pet.scale.set(.6, 1, .6); lotus.add(pet); } lotus.add(ball(.8, '#ffd23f', {y: 1.6})); pads[1].add(lotus);
    const frog = new THREE.Group(); frog.position.y = .4;
    const body = ball(2.6, '#6cc04a', {y: 1.8}); body.scale.set(1, .75, 1.15); frog.add(body);
    const throat = ball(1.3, '#d9f2a6', {y: 1.2, z: 2.1}); frog.add(throat);
    const eyes = [-1.2, 1.2].map(x => { const e = new THREE.Group(); e.position.set(x, 3.6, 1.2); e.add(ball(1, '#6cc04a', {}), ball(.55, '#1d1d1d', {z: .7})); frog.add(e); return e; });
    frog.rotation.y = .6; pads[0].add(frog);
    // Rubber duck, fish, ripples.
    const rubber = new THREE.Group(); rubber.add(ball(3.2, '#ffd23f', {y: 2.2}), ball(2.2, '#ffd23f', {x: 2.2, y: 5.4}), mesh(new THREE.ConeGeometry(.9, 2, 12), clay('#ff8a3d'), {x: 4.3, y: 5.3, rz: -Math.PI / 2}));
    scene.add(rubber);
    const fish = new THREE.Group(); const fb = mesh(new THREE.CapsuleGeometry(1.3, 3.4, 6, 12), clay('#ff8a3d'), {rz: Math.PI / 2}); fish.add(fb, mesh(new THREE.ConeGeometry(1.4, 2.2, 3), clay('#ff6a2d'), {x: -3.4, rz: Math.PI / 2}), ball(.35, '#222', {x: 1.9, y: .5, z: .8}));
    scene.add(fish);
    const ripple = () => { const r = mesh(new THREE.TorusGeometry(2, .28, 6, 40), clay('#ffffff', {transparent: true, opacity: 0}), {rx: Math.PI / 2}); r.castShadow = false; scene.add(r); return r; };
    const ripples = [ripple(), ripple(), ripple()], splash = [ripple(), ripple()];
    // Shore planting: reeds, flowers, a bush and a tree.
    for (const [x, z, h] of [[-38, 14, 18], [-36, 20, 22], [-41, 22, 16], [-33, 25, 20]]) { scene.add(cyl(.4, .5, h, '#5e8a3e', {x, y: h / 2, z}, 6)); scene.add(mesh(new THREE.CapsuleGeometry(1.1, 3.4, 4, 10), clay('#8a5a3c'), {x, y: h - 1, z})); }
    const flowers = [];
    for (let i = 0; i < 16; i++) {
      const a = 1.2 + i * .37, r = 43 + (i % 4) * 3.5, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const f = new THREE.Group(); f.position.set(x, 0, z);
      f.add(cyl(.25, .25, 5, '#5e8a3e', {y: 2.5}, 5), ball(1.2, ['#ff7fa8', '#fff3b0', '#c9a7ff', '#ffffff'][i % 4], {y: 5.4}), ball(.5, '#ffcc33', {y: 5.6, z: .6}));
      scene.add(f); flowers.push(f);
    }
    scene.add(ball(8, '#7cbd5c', {x: 34, y: 3.5, z: -36}), ball(6, '#8ccd6b', {x: 42, y: 2.5, z: -30}));
    const oak = tree(-30, -40, 50, '#78bf5f'); scene.add(oak);
    // Dragonfly.
    const fly = new THREE.Group(); fly.add(mesh(new THREE.CapsuleGeometry(.35, 4, 4, 8), clay('#3fb5c9'), {rz: Math.PI / 2}));
    const wings = [-1, 1].flatMap(sx => [-.6, .6].map(dx => { const w = mesh(new THREE.PlaneGeometry(3.6, 1), new THREE.MeshStandardMaterial({color: '#e8fbff', transparent: true, opacity: .6, side: THREE.DoubleSide}), {x: dx, z: sx * 1.9, rx: Math.PI / 2}); w.castShadow = false; fly.add(w); return w; }));
    scene.add(fly);
    const pos = wg.attributes.position;
    return t => {
      // Gentle rolling water.
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        pos.array[i * 3 + 1] = Math.sin(x * .22 + t * 1.6) * .22 + Math.sin(z * .27 - t * 1.2) * .18 + Math.sin((x + z) * .4 + t * 2.3) * .08;
      }
      pos.needsUpdate = true; wg.computeVertexNormals();
      pads.forEach((p, i) => { p.position.y = .55 + Math.sin(t * 1.6 + i * 1.3) * .2; p.rotation.y = Math.sin(t * .3 + i) * .2; });
      rubber.position.set(PX + Math.cos(t * .25) * 14, .2 + Math.sin(t * 2.2) * .3, PZ + Math.sin(t * .25) * 12); rubber.rotation.y = -t * .25 + Math.PI / 2; rubber.rotation.z = Math.sin(t * 1.9) * .1;
      ripples.forEach((r, i) => { const k = (t * .35 + i / 3) % 1; r.position.set(PX - 4, .6, PZ + 2); r.scale.setScalar(.6 + k * 5); r.material.opacity = (1 - k) * .7; });
      // The fish leaps every 4.5 s in a short arc, with a splash where it lands.
      const cycle = (t % 4.5) / 1.1, fx = PX + 6, fz = PZ - 2;
      fish.visible = cycle < 1;
      if (fish.visible) { fish.position.set(fx - 7 + cycle * 14, Math.sin(cycle * Math.PI) * 9 - .5, fz); fish.rotation.z = (.5 - cycle) * 1.8; }
      splash.forEach((r, i) => { const k = Math.min(1, Math.max(0, ((t % 4.5) - 1.05 - i * .15) / .9)); r.position.set(fx + 7, .6, fz); r.scale.setScalar(.5 + k * 3); r.material.opacity = k > 0 && k < 1 ? (1 - k) * .9 : 0; });
      // Frog: throat puffs, eyes blink now and then.
      throat.scale.setScalar(1 + Math.max(0, Math.sin(t * 3)) * .45);
      const blink = (t % 3.7) < .12 ? .15 : 1; eyes.forEach(e => { e.scale.y = blink; });
      flowers.forEach((f, i) => { f.rotation.z = Math.sin(t * 1.4 + i) * .08; });
      oak.rotation.z = Math.sin(t * .9) * .025;
      const fa = t * .9; fly.position.set(Math.sin(fa) * 26 + PX, 14 + Math.sin(t * 2.6) * 3, Math.sin(fa * 2) * 14 + PZ); fly.rotation.y = -Math.atan2(Math.cos(fa * 2) * 28, Math.cos(fa) * 26);
      wings.forEach((w, i) => { w.rotation.x = Math.PI / 2 + Math.sin(t * 40 + i) * .5; });
      const wave = Math.sin(t * 6) * .5 + .5;
      pose(d, {drop: .004 + Math.sin(t * 2) * .002, roll: Math.sin(t * 1.2) * .04, head: {pitch: -.18, yaw: .3 + Math.sin(t * .9) * .2, roll: .25 * wave}});
    };
  }},
  workshop: {tint: '#f1e3cf', colorway: 'sky', view: {target: [0, 30, 0], dist: 165, yaw: .5, pitch: .38}, build(scene, d) {
    island(scene, 60, '#e6c9a0', '#c49a6c');
    for (let i = -4; i <= 4; i++) scene.add(box(110, .3, 1, '#d9b98d', {y: .1, z: i * 12}, .1));
    const bench = new THREE.Group(); bench.add(box(62, 4, 30, '#b9824f', {y: 22}, 1));
    for (const [x, z] of [[-27, -12], [27, -12], [-27, 12], [27, 12]]) bench.add(box(3.5, 20, 3.5, '#8f6038', {x, y: 10, z}, .8));
    scene.add(bench);
    scene.add(box(14, 9, 8, '#e5533d', {x: 19, y: 28.5, z: -6}, 1.4), box(15, 1.6, 9, '#c23e2b', {x: 19, y: 33.5, z: -6}, .6));
    const board = box(70, 34, 2, '#e9d7b8', {y: 44, z: -24}, 1); scene.add(board);
    const gears = [[-20, 52, 7, '#f2b134'], [-6, 44, 5, '#5aa6d6'], [14, 50, 6, '#e5533d']].map(([x, y, r, c]) => {
      const g = new THREE.Group(); g.position.set(x, y, -22);
      g.add(cyl(r, r, 2, c, {rx: Math.PI / 2}, 24));
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; g.add(box(2, 2.2, 2, c, {x: Math.cos(a) * (r + .8), y: Math.sin(a) * (r + .8), rz: a}, .4)); }
      g.add(cyl(r * .3, r * .3, 2.4, '#3b3b3b', {rx: Math.PI / 2}, 16)); scene.add(g); return g;
    });
    const lamp = new THREE.Group(); lamp.position.set(-22, 24, 4);
    lamp.add(cyl(3, 3.6, 1.4, '#2f3a44'), cyl(.5, .5, 14, '#2f3a44', {y: 7, rz: .3}, 8));
    const shade = mesh(new THREE.ConeGeometry(4, 5, 20, 1, true), clay('#ff8a3d', {side: THREE.DoubleSide}), {x: -2, y: 14, rz: -.9}); lamp.add(shade);
    const bulb = new THREE.PointLight('#ffcf8a', 600, 60, 2); bulb.position.set(-1, 12, 0); lamp.add(bulb); scene.add(lamp);
    scene.add(box(10, 1.2, 3, '#9aa3ad', {x: -6, y: 24.6, z: 9, ry: .5}, .5));
    placeDuck(d, scene, {x: 2, y: 24, z: 2, ry: -.3});
    return t => {
      gears[0].rotation.z = t * 1.2; gears[1].rotation.z = -t * 1.68; gears[2].rotation.z = t * 1.4;
      bulb.intensity = 560 + Math.sin(t * 9) * 25;
      const nod = Math.max(0, Math.sin(t * 2.4));
      pose(d, {lean: .06, drop: .006, head: {neck: .25, pitch: .35 + nod * .15, yaw: Math.sin(t * .7) * .3}});
    };
  }},
  arena: {tint: '#e4def0', colorway: 'lavender', view: {target: [0, 22, 0], dist: 135, yaw: .3, pitch: .3}, build(scene, d) {
    scene.add(cyl(58, 56, 8, '#2c2f3a', {y: -4.6}, 64));
    const floor = cyl(55, 55, 1.2, '#3b3f4f', {y: -.6}, 64); scene.add(floor);
    const rim = mesh(new THREE.TorusGeometry(56.5, 1.1, 10, 96), clay('#ff6fae', {emissive: '#ff6fae', emissiveIntensity: 1.4}), {y: .2, rx: Math.PI / 2}); scene.add(rim);
    const tiles = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const t = box(13, .6, 13, '#4b5066', {x: i * 14, y: .3, z: j * 14}, .5);
      t.material = clay('#4b5066', {emissive: '#000000'}); scene.add(t); tiles.push(t);
    }
    const disco = ball(7, null, {y: 50}, new THREE.MeshStandardMaterial({color: '#dfe6ee', metalness: 1, roughness: .18, flatShading: true}));
    disco.geometry = new THREE.IcosahedronGeometry(7, 2); scene.add(disco, cyl(.25, .25, 20, '#999', {y: 67}, 6));
    const speakers = [-38, 38].map(x => { const s = new THREE.Group(); s.position.set(x, 0, -22); s.add(box(16, 26, 13, '#262a33', {y: 13}, 2)); const cone = cyl(4.6, 4.6, 1.4, '#555b6e', {y: 9, z: 6.6, rx: Math.PI / 2}); const tw = cyl(2.2, 2.2, 1.4, '#555b6e', {y: 19, z: 6.6, rx: Math.PI / 2}); s.add(cone, tw); scene.add(s); return [s, cone]; });
    const spots = ['#ff5fa2', '#57c7ff', '#ffd23f'].map((c, i) => { const s = new THREE.SpotLight(c, 3.5e4, 0, .3, .55, 2); s.position.set((i - 1) * 50, 110, 60); scene.add(s, s.target); return s; });
    placeDuck(d, scene, {x: 0, z: 6, ry: .1});
    return t => {
      const beat = t * 118 / 60, c = danceCommands(beat, .9, 'mix'), k = Math.exp(-(beat % 1) * 6);
      pose(d, {drop: -c.pose.z, roll: c.pose.roll, lean: c.pose.pitch, head: {neck: c.head.neck_pitch, pitch: c.head.head_pitch, yaw: c.head.head_yaw, roll: c.head.head_roll}});
      disco.rotation.y = t * .8;
      spots.forEach((s, i) => s.target.position.set(Math.sin(t * .9 + i * 2.1) * 30, 0, Math.cos(t * .7 + i * 1.7) * 30));
      speakers.forEach(([s, cone]) => { s.scale.y = 1 + k * .04; cone.scale.setScalar(1 + k * .18); });
      tiles.forEach((tl, i) => { const on = (i * 7 + Math.floor(beat)) % 5 === 0; tl.material.emissive.set(on ? ['#ff5fa2', '#57c7ff', '#ffd23f'][i % 3] : '#000000'); tl.material.emissiveIntensity = on ? .55 * (.4 + k) : 0; });
      rim.material.emissiveIntensity = 1 + k;
    };
  }},
  residents: {tint: '#e1edd6', colorway: 'graphite', view: {target: [0, 16, 0], dist: 165, yaw: .4, pitch: .4}, build(scene, d) {
    island(scene, 60, '#a9d886', '#83b064');
    scene.add(box(14, .4, 60, '#efe2c8', {x: 6, y: .1, z: 10, ry: .4}, .2));
    scene.add(house(-26, -22, '#ffd7a8', '#e5533d', .3), house(10, -32, '#c7e3f6', '#5a6fd6', -.1), house(40, -12, '#f6c7da', '#7a5bd6', -.6));
    for (let i = 0; i < 8; i++) scene.add(box(1.6, 7, 1.6, '#fffaf0', {x: -46 + i * 5.2, y: 3.5, z: 22}, .5));
    scene.add(box(38, 1.2, 1, '#fffaf0', {x: -27.8, y: 5, z: 22.9}, .3));
    const oak = tree(-40, 4, 44, '#6fb35e'); scene.add(oak);
    const flies = [['#ffb3d1', 0], ['#ffe066', 2.1]].map(([c, ph]) => {
      const f = new THREE.Group();
      const wing = () => mesh(new THREE.CircleGeometry(2.2, 16), clay(c, {side: THREE.DoubleSide}));
      const l = wing(), r = wing(); l.position.x = -1.8; r.position.x = 1.8; f.add(l, r, ball(.5, '#333', {})); scene.add(f); return {f, l, r, ph};
    });
    placeDuck(d, scene, {x: 10, z: 12, ry: -.9});
    return t => {
      oak.rotation.z = Math.sin(t * 1.1) * .03;
      for (const {f, l, r, ph} of flies) {
        const a = t * .7 + ph; f.position.set(Math.cos(a) * 26 + 6, 22 + Math.sin(t * 2 + ph) * 5, Math.sin(a) * 20); f.rotation.y = -a;
        const flap = Math.sin(t * 22 + ph) * .9; l.rotation.y = flap; r.rotation.y = -flap;
      }
      const wave = Math.sin(t * 5);
      pose(d, {roll: Math.sin(t * 1.4) * .05, head: {pitch: -.25, yaw: -.25 + Math.sin(t * .8) * .25, roll: .2 * wave}});
    };
  }},
  perch: {tint: '#efe5d6', colorway: 'cream', view: {target: [4, 20, 0], dist: 160, yaw: .5, pitch: .36}, build(scene, d) {
    island(scene, 58, '#d8c3a5', '#b89c78');
    scene.add(cyl(36, 36, .8, '#e88f6a', {x: 6, y: .3, z: 8}, 48), cyl(30, 30, .9, '#f3c08f', {x: 6, y: .4, z: 8}, 48));
    const chair = new THREE.Group(); chair.position.set(-26, 0, -12); chair.rotation.y = .5;
    chair.add(box(30, 10, 26, '#5a8f7b', {y: 9}, 4), box(30, 24, 8, '#5a8f7b', {y: 22, z: -10}, 4), box(7, 16, 26, '#4c7a68', {x: -15, y: 14}, 3), box(7, 16, 26, '#4c7a68', {x: 15, y: 14}, 3), box(22, 4, 16, '#f2ead8', {y: 15, z: 2}, 2));
    scene.add(chair);
    scene.add(cyl(12, 12, 2, '#a86d44', {x: 18, y: 16, z: 10}, 32), cyl(1.6, 1.6, 15, '#7a4e30', {x: 18, y: 7.5, z: 10}, 10), cyl(6, 6, 1, '#7a4e30', {x: 18, y: .9, z: 10}, 20));
    const laptop = new THREE.Group(); laptop.position.set(22, 17, 6); laptop.rotation.y = -.7;
    laptop.add(box(12, .8, 8, '#b8c0cc', {}, .3));
    const screen = box(12, 8, .6, '#b8c0cc', {y: 4, z: -4, rx: -.25}, .3); laptop.add(screen);
    const glow = mesh(new THREE.PlaneGeometry(10.6, 6.6), new THREE.MeshBasicMaterial({color: '#8fd3ff'}), {y: 4, z: -3.6, rx: -.25}); laptop.add(glow); scene.add(laptop);
    const lampG = new THREE.Group(); lampG.position.set(-44, 0, 18);
    lampG.add(cyl(5, 5, 1.2, '#3a3a3a', {y: .6}), cyl(.6, .6, 40, '#3a3a3a', {y: 20}, 8), mesh(new THREE.CylinderGeometry(6, 9, 9, 24, 1, true), clay('#ffe2b0', {side: THREE.DoubleSide, emissive: '#ffcf8a', emissiveIntensity: .6}), {y: 42}));
    const warm = new THREE.PointLight('#ffc97a', 900, 90, 2); warm.position.set(0, 40, 0); lampG.add(warm); scene.add(lampG);
    const plant = new THREE.Group(); plant.position.set(42, 0, -24);
    plant.add(cyl(6, 4.6, 10, '#e5775b', {y: 5}, 20));
    const leaves = [0, 1, 2, 3, 4].map(i => { const l = mesh(new THREE.SphereGeometry(5, 16, 10), clay('#5fae5a'), {y: 16, rz: (i - 2) * .45, ry: i}); l.scale.set(.5, 1.5, .25); plant.add(l); return l; });
    scene.add(plant);
    placeDuck(d, scene, {x: 12, y: 17, z: 14, ry: .3});
    return t => {
      glow.material.color.setHSL(.55 + Math.sin(t * .5) * .05, .8, .72 + Math.sin(t * 3) * .04);
      leaves.forEach((l, i) => { l.rotation.x = Math.sin(t * 1.3 + i) * .08; });
      warm.intensity = 880 + Math.sin(t * 1.7) * 40;
      pose(d, {drop: .003 + Math.sin(t * 1.6) * .002, head: {pitch: -.15 + Math.sin(t * .6) * .08, yaw: .45 + Math.sin(t * .5) * .2, roll: Math.sin(t * .9) * .12}});
    };
  }},
  school: {tint: '#e3e8ee', colorway: 'sky', view: {target: [0, 26, 0], dist: 165, yaw: .45, pitch: .34}, build(scene, d) {
    island(scene, 58, '#cfd8e3', '#a9b6c6');
    const board = new THREE.Group(); board.position.set(-4, 0, -30);
    board.add(box(64, 40, 3, '#b07b4f', {y: 36}, 1.2));
    board.add(mesh(new THREE.PlaneGeometry(58, 34), new THREE.MeshStandardMaterial({map: textTexture(['sim → real', 'ABC 123']), roughness: .9}), {y: 36, z: 1.6}));
    for (const x of [-26, 26]) board.add(box(3, 18, 3, '#8f6038', {x, y: 9}, .8));
    scene.add(board);
    const desk = new THREE.Group(); desk.position.set(8, 0, 6);
    desk.add(box(40, 3, 24, '#f2c15a', {y: 21}, 1));
    for (const [x, z] of [[-17, -9], [17, -9], [-17, 9], [17, 9]]) desk.add(box(2.6, 20, 2.6, '#6c7a89', {x, y: 10, z}, .6));
    scene.add(desk);
    const books = [['#e5533d', 0], ['#5a6fd6', 3.4], ['#4fae7a', 6.8]].map(([c, y]) => box(14, 3.2, 10, c, {x: -10, y: 24.2 + y, z: 6, ry: y * .05}, .6));
    books.forEach(b => desk.add(b));
    desk.add(cyl(2.2, 2, 6, '#e8eef4', {x: 15, y: 25.5, z: -6}, 16), cyl(.4, .4, 10, '#ffd23f', {x: 15, y: 29, z: -6, rz: .2}, 6));
    const letters = ['A', 'B', 'C', '★'].map((ch, i) => {
      const m = mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({map: textTexture([ch], {w: 128, h: 128, bg: 'rgba(0,0,0,0)', fg: ['#e5533d', '#5a6fd6', '#4fae7a', '#f2b134'][i], font: 'bold 104px system-ui'}), transparent: true, side: THREE.DoubleSide}), {x: -30 + i * 20, y: 58, z: -8});
      m.castShadow = false; scene.add(m); return m;
    });
    placeDuck(d, scene, {x: 14, y: 22.5, z: 10, ry: -.5});
    return t => {
      letters.forEach((m, i) => { m.position.y = 56 + Math.sin(t * 1.4 + i) * 3; m.rotation.y = Math.sin(t * .8 + i) * .5; });
      const read = Math.sin(t * 1.1);
      pose(d, {lean: .05, head: {neck: .22, pitch: .32 + Math.max(0, Math.sin(t * 2.6)) * .08, yaw: read * .3}});
    };
  }}
};

// ---------- one shared renderer for every tile ----------
let renderer = null, env = null, failed = false;
function getRenderer() {
  if (renderer || failed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'low-power'});
    renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(renderer); env = pmrem.fromScene(new RoomEnvironment(), .04).texture; pmrem.dispose();
  } catch { failed = true; renderer = null; }
  return renderer;
}

const tiles = new Set();
let raf = 0, last = 0;
function loop(now) {
  raf = 0;
  const live = [...tiles].filter(t => t.visible && t.ready);
  if (!live.length) return;
  if (now - last >= 33) {
    last = now;
    for (const tile of live) tile.draw(now / 1000);
  }
  if (!reduced()) raf = requestAnimationFrame(loop);
}
const wake = () => { if (!raf) raf = requestAnimationFrame(loop); };

class TownScene extends HTMLElement {
  connectedCallback() {
    const name = this.dataset.place, spec = SCENES[name];
    if (!spec || this.canvas) return;
    this.canvas = document.createElement('canvas'); this.canvas.setAttribute('aria-hidden', 'true');
    this.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    this.style.setProperty('--tint', spec.tint);
    tiles.add(this);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) { this.start(); wake(); } }, {rootMargin: '120px'});
    this.io.observe(this);
    this.addEventListener('pointermove', e => { const r = this.getBoundingClientRect(); this.tilt = ((e.clientX - r.left) / r.width - .5) * .5; });
    this.addEventListener('pointerleave', () => { this.tilt = 0; });
  }
  disconnectedCallback() { tiles.delete(this); this.io?.disconnect(); }
  async start() {
    if (this.starting) return; this.starting = true;
    const gl = getRenderer(); if (!gl) { this.classList.add('is-static'); return; }
    const assets = await loadRobotAssets().catch(() => null);
    if (!assets || !this.isConnected) return;
    const spec = SCENES[this.dataset.place];
    const scene = new THREE.Scene(); scene.environment = env; scene.environmentIntensity = .55;
    const sun = new THREE.DirectionalLight('#fff4e4', 2.3); sun.position.set(60, 140, 90); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; sun.shadow.bias = -.0005; sun.shadow.normalBias = .4;
    Object.assign(sun.shadow.camera, {left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 400});
    scene.add(sun, new THREE.HemisphereLight('#fffaf0', '#d8c9b0', .6));
    // Tint the source robot's shell/trim/sole materials, then copy the colours onto this scene's copies.
    const d = makeDuck(assets);
    assets.robot.setColorway(COLORWAYS[spec.colorway]);
    for (const [orig, copy] of d.mats) copy.color.copy(orig.color);
    this.update = spec.build(scene, d);
    this.scene = scene; this.view = spec.view; this.tilt = 0; this.yawNow = 0;
    this.camera = new THREE.PerspectiveCamera(30, 4 / 3, 5, 2000);
    this.ready = true; this.classList.add('is-live');
    this.draw(performance.now() / 1000); wake();
  }
  draw(t) {
    const gl = getRenderer(); if (!gl || !this.ready) return;
    const r = this.getBoundingClientRect(); if (r.width < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, 2, 900 / r.width), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const time = reduced() ? 1.2 : t;
    this.update(time);
    const v = this.view; this.yawNow += ((reduced() ? 0 : Math.sin(t * .25) * .12 + this.tilt) - this.yawNow) * .08;
    const yaw = v.yaw + this.yawNow, [tx, ty, tz] = v.target;
    this.camera.aspect = w / h;
    // Keep the whole diorama in frame on tall tiles too.
    const dist = v.dist * Math.max(1, 1.25 / this.camera.aspect);
    this.camera.position.set(tx + Math.sin(yaw) * Math.cos(v.pitch) * dist, ty + Math.sin(v.pitch) * dist, tz + Math.cos(yaw) * Math.cos(v.pitch) * dist);
    this.camera.lookAt(tx, ty, tz); this.camera.updateProjectionMatrix();
    gl.setSize(w, h, false); gl.render(this.scene, this.camera);
    this.ctx.clearRect(0, 0, w, h); this.ctx.drawImage(gl.domElement, 0, 0);
  }
}
if (!customElements.get('town-scene')) customElements.define('town-scene', TownScene);
export const PLACE_SCENES = Object.keys(SCENES);
