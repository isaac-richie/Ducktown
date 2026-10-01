// Drives Pollen's exact Microduck from Ducktown's motion system: trunk pose + foot targets in,
// 14 real joint angles out (clamped to the real motor ranges), then forward kinematics places
// every CAD body. Legs are solved with damped least squares on the real 5-motor chains.
import { forwardKinematics, qposFrom } from './microduck-kinematics.js';

const LEGS = {
  left: ['left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle'],
  right: ['right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle']
};
const ANKLE = {left: 'ankle_left', right: 'ankle_right'};
// rotError is in the world frame: components [0],[1] are tilt about world x and y.

const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
];
const qconj = q => [q[0], -q[1], -q[2], -q[3]];
const qrot = (q, v) => {
  const [w, x, y, z] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
export const quatFromEuler = (roll, pitch, yaw) => {
  // Z (yaw) * Y (pitch) * X (roll), MuJoCo frame.
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
};
// Rotation error as a small axis-angle vector (target relative to current).
const rotError = (target, current) => {
  let q = qmul(target, qconj(current));
  if (q[0] < 0) q = q.map(v => -v);
  const s = Math.hypot(q[1], q[2], q[3]);
  if (s < 1e-9) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, q[0]);
  return [q[1] / s * angle, q[2] / s * angle, q[3] / s * angle];
};

// Solve A x = b for a small square system (Gaussian elimination with partial pivoting).
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export class ExactDuck {
  constructor(tree) {
    this.tree = tree;
    this.angles = {...tree.default};
    this.ranges = Object.fromEntries(tree.bodies.filter(b => b.joint).map(b => [b.joint.name, b.joint.range]));
    // Standing reference: default joints, trunk at its standing height, feet flat on the floor.
    const ref = forwardKinematics(tree, qposFrom(tree, this.angles, [0, 0, 0], [1, 0, 0, 0]));
    this.standHeight = .1205; // trunk height of the recorded 'stand' policy clip (m)
    this.footOffset = {};
    this.footQuat = {};
    for (const side of ['left', 'right']) {
      const a = ref.get(ANKLE[side]);
      this.footOffset[side] = [a.pos[0], a.pos[1], a.pos[2] + this.standHeight]; // relative to ground frame
      this.footQuat[side] = a.quat;
    }
  }

  // trunk: {pos [m], quat}; ground: {pos, yawQuat} frame the feet are anchored to;
  // feet: {left:{lift, reach}, right:{...}} in metres; head: {neck, pitch, yaw, roll} offsets (rad).
  solve({trunk, ground, feet, head}) {
    const qpos = () => qposFrom(this.tree, this.angles, trunk.pos, trunk.quat);
    for (const side of ['left', 'right']) {
      const f = feet[side] || {lift: 0, reach: 0}, o = this.footOffset[side];
      const local = [o[0] + f.reach, o[1], o[2] + f.lift]; // ground frame: z = height above the floor
      const targetPos = ground.pos.map((v, i) => v + qrot(ground.yawQuat, local)[i]);
      const targetQuat = qmul(ground.yawQuat, this.footQuat[side]);
      this.solveLeg(side, targetPos, targetQuat, qpos);
    }
    const d = this.tree.default;
    this.angles.neck_pitch = d.neck_pitch + (head?.neck || 0);
    this.angles.head_pitch = d.head_pitch + (head?.pitch || 0);
    this.angles.head_yaw = d.head_yaw + (head?.yaw || 0);
    this.angles.head_roll = d.head_roll + (head?.roll || 0);
    this.clamp();
    return forwardKinematics(this.tree, qpos());
  }

  solveLeg(side, targetPos, targetQuat, qpos) {
    const joints = LEGS[side], body = ANKLE[side], eps = 1e-4, lambda = .02;
    for (let iter = 0; iter < 10; iter++) {
      const cur = forwardKinematics(this.tree, qpos()).get(body);
      const ep = targetPos.map((v, i) => v - cur.pos[i]), er = rotError(targetQuat, cur.quat);
      // The real leg has no ankle-roll motor (hip yaw, hip roll, hip pitch, knee, ankle pitch), so a
      // perfectly flat sole is not always reachable. Priority: ankle exactly on target; sole as flat
      // as the joints allow (tilt about the two horizontal world axes, lightly weighted).
      const W = .015;
      const err = [...ep, er[0] * W, er[1] * W];
      if (Math.hypot(...err) < 2e-5) break;
      const J = joints.map(name => {
        const saved = this.angles[name];
        this.angles[name] = saved + eps;
        const p = forwardKinematics(this.tree, qpos()).get(body);
        this.angles[name] = saved;
        const dr = rotError(p.quat, cur.quat);
        return [...p.pos.map((v, i) => (v - cur.pos[i]) / eps), dr[0] * W / eps, dr[1] * W / eps];
      });
      // Damped least squares: dθ = Jᵀ (J Jᵀ + λ² I)⁻¹ e  -> solve (JᵀJ + λ² I) dθ = Jᵀ e (5×5).
      const JtJ = joints.map((_, a) => joints.map((_, b) => J[a].reduce((s, v, k) => s + v * J[b][k], 0) + (a === b ? lambda * lambda : 0)));
      const Jte = joints.map((_, a) => J[a].reduce((s, v, k) => s + v * err[k], 0));
      const step = solve(JtJ, Jte);
      joints.forEach((name, k) => {
        const [lo, hi] = this.ranges[name];
        this.angles[name] = Math.min(hi, Math.max(lo, this.angles[name] + step[k]));
      });
    }
  }

  clamp() {
    for (const [name, [lo, hi]] of Object.entries(this.ranges)) this.angles[name] = Math.min(hi, Math.max(lo, this.angles[name]));
  }
}
