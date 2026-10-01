// Forward kinematics for Pollen's exact Microduck (kinematic tree exported from MuJoCo by
// tools/policy-recorder/record.py). Pure maths, no three.js, so it is unit-tested against MuJoCo.
// Quaternions are [w, x, y, z] like MuJoCo; positions in metres, MuJoCo world frame (z up, x forward).

const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
];
const qrot = (q, v) => {
  const [w, x, y, z] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
const axisAngle = (axis, angle) => {
  const s = Math.sin(angle / 2), n = Math.hypot(...axis) || 1;
  return [Math.cos(angle / 2), axis[0] / n * s, axis[1] / n * s, axis[2] / n * s];
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// qpos: MuJoCo layout (root free joint: 3 position + 4 quaternion, then hinge angles by qposadr).
// Returns Map(bodyName -> {pos, quat}) of world poses.
export function forwardKinematics(tree, qpos) {
  const out = new Map();
  for (const body of tree.bodies) {
    let pos, quat;
    if (!body.parent) {
      const a = tree.rootQposAdr;
      pos = [qpos[a], qpos[a + 1], qpos[a + 2]];
      quat = [qpos[a + 3], qpos[a + 4], qpos[a + 5], qpos[a + 6]];
    } else {
      const parent = out.get(body.parent);
      pos = add(parent.pos, qrot(parent.quat, body.pos));
      quat = qmul(parent.quat, body.quat);
      if (body.joint) {
        // Hinge about `axis` through `pos` (both in this body's frame).
        const r = axisAngle(body.joint.axis, qpos[body.joint.qposadr]);
        const pivot = qrot(quat, body.joint.pos);
        quat = qmul(quat, r);
        pos = add(add(pos, pivot), qrot(quat, sub([0, 0, 0], body.joint.pos)));
      }
    }
    out.set(body.name, {pos, quat});
  }
  return out;
}

// Joint angles by name -> qpos array for forwardKinematics (root pose given separately).
export function qposFrom(tree, angles, rootPos = [0, 0, .12], rootQuat = [1, 0, 0, 0]) {
  const size = Math.max(...tree.bodies.filter(b => b.joint).map(b => b.joint.qposadr)) + 1;
  const qpos = new Array(size).fill(0);
  qpos.splice(tree.rootQposAdr, 7, ...rootPos, ...rootQuat);
  for (const body of tree.bodies) {
    if (!body.joint) continue;
    const [lo, hi] = body.joint.range, value = angles[body.joint.name] ?? tree.default[body.joint.name] ?? 0;
    qpos[body.joint.qposadr] = Math.min(hi, Math.max(lo, value));
  }
  return qpos;
}
