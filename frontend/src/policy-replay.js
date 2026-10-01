import * as THREE from 'three';

// Replays of Pollen's official Microduck policies on Pollen's exact robot model.
// Data comes from tools/policy-recorder (MuJoCo + Pollen's own inference code): every body's
// world pose at 50 Hz. Nothing here is hand-animated; we only place meshes where the sim put them.
// Robot model and policies: pollen-robotics/microduck_rl and microduck-policies (Apache-2.0).

const ROBOT_JSON = new URL('./policy/robot.json', import.meta.url).href;
const ROBOT_BIN = new URL('./policy/robot.bin', import.meta.url).href;
const clipUrl = (name, ext) => new URL(`./policy/clips/${name}.${ext}`, import.meta.url).href;

export const POLICY_CLIPS = [
  {id: 'kick_right', label: 'Kick', note: 'Ball kick, right foot'},
  {id: 'roulade', label: 'Roll', note: 'Forward roll, back on its feet'},
  {id: 'ground_pick', label: 'Pick', note: 'Beak to the floor and back up'},
  {id: 'stand', label: 'Stand', note: 'Balancing in place'}
];
const BALL_RADIUS = .035; // metres, from microduck_rl/scripts/infer_policy.py

// MuJoCo is z-up with the robot facing +x; Ducktown is y-up, cm, robot facing +z.
const MJ_TO_SCENE = new THREE.Matrix4().set(
  0, 100, 0, 0,
  0, 0, 100, 0,
  100, 0, 0, 0,
  0, 0, 0, 1
);

export async function loadPolicyRobot() {
  const [meta, buffer] = await Promise.all([
    fetch(ROBOT_JSON).then(r => r.json()),
    fetch(ROBOT_BIN).then(r => r.arrayBuffer())
  ]);
  const root = new THREE.Group();
  root.name = 'pollen-microduck';
  root.matrixAutoUpdate = false;
  root.matrix.copy(MJ_TO_SCENE);
  const bodies = new Map(), materials = new Map();
  const shellMaterials = [];
  for (const part of meta.parts) {
    if (!bodies.has(part.body)) {
      const body = new THREE.Group(); body.name = part.body; bodies.set(part.body, body); root.add(body);
    }
    const q = new Int16Array(buffer, part.positions, part.vertices * 3), positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) positions[i] = part.min[i % 3] + (q[i] + 32767) * part.scale[i % 3];
    const indices = part.index32 ? new Uint32Array(buffer, part.indices, part.triangles * 3) : new Uint16Array(buffer, part.indices, part.triangles * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    const key = part.rgba.join(',');
    if (!materials.has(key)) {
      const color = new THREE.Color().setRGB(part.rgba[0], part.rgba[1], part.rgba[2], THREE.SRGBColorSpace);
      const light = color.r + color.g + color.b > 2.1;
      const material = new THREE.MeshStandardMaterial({color, roughness: light ? .38 : .55, metalness: light ? 0 : .15});
      if (light) shellMaterials.push(material);
      materials.set(key, material);
    }
    const mesh = new THREE.Mesh(geometry, materials.get(key));
    mesh.castShadow = true; mesh.receiveShadow = true;
    bodies.get(part.body).add(mesh);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 16), new THREE.MeshStandardMaterial({color: '#d96248', roughness: .55}));
  ball.castShadow = true; ball.visible = false; ball.name = 'ball';
  bodies.set('ball', ball); root.add(ball);
  return {
    root, bodies,
    // Shell colourways: tint the light shell parts, keep servos, trim and soles as built.
    setShell(hex) { for (const m of shellMaterials) m.color.set(hex); },
    dispose() {
      root.traverse(o => o.geometry?.dispose());
      for (const m of materials.values()) m.dispose();
      ball.material.dispose();
    }
  };
}

export async function loadClip(name) {
  const [meta, buffer] = await Promise.all([
    fetch(clipUrl(name, 'json')).then(r => r.json()),
    fetch(clipUrl(name, 'bin')).then(r => r.arrayBuffer())
  ]);
  const data = new Int16Array(buffer), stride = meta.bodies.length * 7;
  // Start the replay where the duck stands: subtract the trunk's first-frame ground position.
  const ox = data[0] / 10000, oy = data[1] / 10000;
  return {...meta, data, stride, origin: [ox, oy], duration: (meta.frames - 1) / meta.hz};
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
// Pose every body at time t (seconds), interpolating between the 50 Hz frames.
export function applyClip(robot, clip, t) {
  const f = Math.min(clip.frames - 1, Math.max(0, t * clip.hz)), i = Math.floor(f), j = Math.min(clip.frames - 1, i + 1), k = f - i;
  const {data, stride, origin} = clip;
  robot.bodies.get('ball').visible = clip.bodies.includes('ball');
  clip.bodies.forEach((name, b) => {
    const body = robot.bodies.get(name);
    if (!body) return;
    const a = i * stride + b * 7, c = j * stride + b * 7;
    body.position.set(
      (data[a] + (data[c] - data[a]) * k) / 10000 - origin[0],
      (data[a + 1] + (data[c + 1] - data[a + 1]) * k) / 10000 - origin[1],
      (data[a + 2] + (data[c + 2] - data[a + 2]) * k) / 10000
    );
    // Stored as w,x,y,z; three.js wants x,y,z,w.
    qa.set(data[a + 4], data[a + 5], data[a + 6], data[a + 3]).normalize();
    qb.set(data[c + 4], data[c + 5], data[c + 6], data[c + 3]).normalize();
    body.quaternion.slerpQuaternions(qa, qb, k);
  });
}

// Trunk ground position in scene centimetres (for the camera to follow).
export function clipTrunk(clip, t) {
  const i = Math.min(clip.frames - 1, Math.max(0, Math.round(t * clip.hz))) * clip.stride;
  const x = clip.data[i] / 10000 - clip.origin[0], y = clip.data[i + 1] / 10000 - clip.origin[1];
  return [y * 100, x * 100];
}
