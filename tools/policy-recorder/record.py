#!/usr/bin/env python3
"""Record Pollen's official Microduck policies in MuJoCo for Ducktown replays.

Runs headlessly on CPU, reusing pollen-robotics/microduck_rl's own inference code
(`scripts/infer_policy.py`: observation layout, BAM XL330 actuator model, 50 Hz control
with 4 physics substeps), so a replay shows what the policy actually does in simulation.

Outputs (into --out):
  robot.json + robot.bin   exact visual model: Pollen's meshes merged per moving body
  clips/<name>.json/.bin   per-frame world pose (position + quaternion) of every body, 50 Hz

Both repos are Apache-2.0. Usage:
  python record.py --rl path/to/microduck_rl --policies path/to/microduck-policies --out frontend/src/policy
"""

import argparse
import json
import os
import struct
import sys

import numpy as np


def load_infer_module(rl_root):
    sys.path.insert(0, os.path.join(rl_root, "scripts"))
    os.chdir(rl_root)  # infer_policy resolves scene XML paths relative to the repo root
    import infer_policy  # noqa: E402  (Pollen's script; imports mujoco + onnxruntime only)
    return infer_policy


def build_sim(ip, policies, scene=None):
    import mujoco
    xml = scene or ip.MICRODUCK_XML
    bam_model = ip.load_bam_model(ip.BAM_KP_FW, 7.4, None)
    model, data, bam_ctrl, _ = ip.load_mujoco_with_bam(xml, bam_model, 0.005, 0.1, ip.BAM_VIN_MIN)
    p = lambda name: os.path.join(policies, name)
    policy = ip.PolicyInference(
        model, data, bam_ctrl=bam_ctrl,
        # Base policy: alpha_stand. The walk policies (velstand / alpha_walking) do not walk
        # stably in this CPU rehearsal (they drift and fall even at zero command), so they fail
        # the gate and are not recorded; every trick below starts from and returns to standing.
        standing_onnx_path=p("alpha_stand.onnx"),
        new_cmd_obs=True,
        sitstand_onnx_path=p("alpha_sitstand.onnx"),
        ground_pick_onnx_path=p("alpha_ground_pick.onnx"),
        kick_left_onnx_path=p("ball_kick_left.onnx"),
        kick_right_onnx_path=p("ball_kick_right.onnx"),
        roulade_onnx_path=p("roulade.onnx"),
    )
    # Same initial state as infer_policy.main(): trunk at 12.5 cm, joints at the default pose.
    fj = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, "trunk_base_freejoint")
    adr = model.jnt_qposadr[fj]
    data.qpos[adr:adr + 3] = [0.0, 0.0, 0.125]
    data.qpos[adr + 3:adr + 7] = [1, 0, 0, 0]
    for i, q in enumerate(policy.joint_qpos_indices):
        data.qpos[q] = policy.default_pose[i]
    bam_ctrl.reset(data.qpos)
    policy.set_position_targets(policy.default_pose)
    mujoco.mj_forward(model, data)
    return model, data, bam_ctrl, policy


def run_clip(ip, rl, policies, name, seconds, events, scene=None):
    """Simulate `seconds` at 50 Hz. events: {control_step: callable(policy)}."""
    import mujoco
    model, data, bam_ctrl, policy = build_sim(ip, policies, scene)
    bodies = [b for b in range(1, model.nbody)]
    frames, decimation, dt = [], 4, 0.02
    steps = int(round(seconds / dt))
    fell = False
    for step in range(steps):
        if step in events:
            events[step](policy)
        policy.update_ground_pick_phase(dt)
        policy.update_behavior(dt)
        policy.apply_action(policy.infer())
        for _ in range(decimation):
            bam_ctrl.update()
            mujoco.mj_step(model, data)
        frames.append(np.concatenate([np.concatenate([data.xpos[b], data.xquat[b]]) for b in bodies]))
        trunk_up = 1 - 2 * (data.xquat[1][1] ** 2 + data.xquat[1][2] ** 2)  # z of trunk's up axis
        if trunk_up < 0.3 and "roulade" not in name:
            fell = True
    names = [mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, b) or f"body{b}" for b in bodies]
    return names, np.array(frames, dtype=np.float32), fell


def write_clip(out, name, body_names, frames, meta):
    # Int16 quantisation: positions in 0.1 mm (±3.2 m), quaternions × 32767.
    n_frames, n_bodies = frames.shape[0], len(body_names)
    f = frames.reshape(n_frames, n_bodies, 7)
    pos = np.clip(np.round(f[:, :, :3] * 10000), -32767, 32767).astype("<i2")
    quat = np.clip(np.round(f[:, :, 3:] * 32767), -32767, 32767).astype("<i2")
    packed = np.concatenate([pos, quat], axis=2)
    os.makedirs(os.path.join(out, "clips"), exist_ok=True)
    packed.tofile(os.path.join(out, "clips", f"{name}.bin"))
    with open(os.path.join(out, "clips", f"{name}.json"), "w") as fh:
        json.dump({"name": name, "hz": 50, "frames": n_frames, "bodies": body_names,
                   "layout": "frame,body,[x,y,z (0.1mm), qw,qx,qy,qz (/32767)] int16 LE", **meta}, fh, indent=1)


def export_robot(ip, policies, out):
    """Merge every visual mesh geom into its body frame, grouped by material colour."""
    import mujoco
    model, data, _, _ = build_sim(ip, policies)

    def rot(q):
        w, x, y, z = q
        return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

    parts, blob = [], bytearray()
    for g in range(model.ngeom):
        if model.geom_type[g] != mujoco.mjtGeom.mjGEOM_MESH or model.geom_group[g] != 2:
            continue  # visual meshes only (collision proxies live in other groups)
        m = model.geom_dataid[g]
        v0, nv = model.mesh_vertadr[m], model.mesh_vertnum[m]
        f0, nf = model.mesh_faceadr[m], model.mesh_facenum[m]
        verts = model.mesh_vert[v0:v0 + nv] @ rot(model.geom_quat[g]).T + model.geom_pos[g]
        faces = model.mesh_face[f0:f0 + nf]
        mat = model.geom_matid[g]
        rgba = (model.mat_rgba[mat] if mat >= 0 else model.geom_rgba[g]).tolist()
        mesh_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_MESH, m)
        body = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, model.geom_bodyid[g])
        pos_off = len(blob); blob += verts.astype("<f4").tobytes()
        idx_off = len(blob); blob += faces.astype("<u4").tobytes()
        parts.append({"body": body, "mesh": mesh_name, "rgba": [round(c, 4) for c in rgba],
                      "positions": [pos_off, int(nv)], "indices": [idx_off, int(nf) * 3]})
    with open(os.path.join(out, "robot.bin"), "wb") as fh:
        fh.write(blob)
    with open(os.path.join(out, "robot.json"), "w") as fh:
        json.dump({"source": "pollen-robotics/microduck_rl (Apache-2.0)", "units": "m",
                   "parts": parts}, fh, indent=1)
    tris = sum(p["indices"][1] // 3 for p in parts)
    print(f"robot: {len(parts)} visual parts, {tris} triangles, {len(blob) / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rl", required=True)
    ap.add_argument("--policies", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--robot-only", action="store_true")
    args = ap.parse_args()
    out = os.path.abspath(args.out); policies = os.path.abspath(args.policies)
    ip = load_infer_module(os.path.abspath(args.rl))
    os.makedirs(out, exist_ok=True)
    export_robot(ip, policies, out)
    if args.robot_only:
        return

    clips = {
        # name: (seconds, events at control steps (50 Hz), scene)
        "stand": (4, {}, None),
        "sit_stand": (9, {25: lambda p: p.toggle_sit(), 250: lambda p: p.toggle_sit()}, None),
        "ground_pick": (6, {50: lambda p: p.trigger_ground_pick()}, None),
        "kick_left": (5, {50: lambda p: p.trigger_behavior("kick_left")}, ip.MICRODUCK_BALL_XML),
        "kick_right": (5, {50: lambda p: p.trigger_behavior("kick_right")}, ip.MICRODUCK_BALL_XML),
        "roulade": (6, {50: lambda p: p.trigger_behavior("roulade")}, None),
    }
    summary = {}
    for name, (seconds, events, scene) in clips.items():
        body_names, frames, fell = run_clip(ip, args.rl, policies, name, seconds, events, scene)
        write_clip(out, name, body_names, frames, {"policy_set": "pollen-robotics/microduck-policies",
                                                   "simulated": True, "fell": fell})
        trunk = frames[:, :3]
        summary[name] = {"frames": len(frames), "fell": fell,
                         "travel_m": round(float(np.linalg.norm(trunk[-1, :2] - trunk[0, :2])), 3)}
        print(f"{name}: {summary[name]}")
    with open(os.path.join(out, "clips", "index.json"), "w") as fh:
        json.dump(summary, fh, indent=1)


if __name__ == "__main__":
    main()
