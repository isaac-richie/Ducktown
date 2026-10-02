#!/usr/bin/env python3
"""Shrink the exported Microduck CAD model (robot.json/.bin from record.py) for the web.

- Drops parts hidden inside the shells (bearings, PCBs, battery, internal brackets).
- Merges the rest per (body, colour) and simplifies to roughly --target triangles in total.
- Quantises positions to int16 per mesh and writes indices as uint16/uint32.

Usage: python pack_robot.py --src rec-out --out frontend/src/policy --target 70000
"""

import argparse
import json
import os
from collections import defaultdict

import fast_simplification
import numpy as np

HIDDEN = ("bearing", "pcb", "np_f970", "power_support", "m12_lens_holder", "speaker", "banana_pcb")

# Product-photo materials by part. Detail budget: shells and trim are what people look at, so
# they keep most of their triangles; servos and brackets are simplified harder.
CATEGORIES = [
    ("shell", ("top_head_shell", "left_shell", "right_shell", "upper_leg_left", "upper_leg_right"), .55),
    ("trim", ("bottom_head_shell", "jaw", "foot_left", "foot_right", "ankle_left", "ankle_right", "noenoeil"), .5),
    ("sole", ("sole_left", "sole_right"), .35),
    ("mouth", ("jaw_soft", "soft_mouth_top"), .5),
    ("face", ("face_part",), .6),
    ("lens", ("lens",), 1.0),
    ("servo", ("xl330",), .12),
    ("frame", ("hip_l", "leg", "neck", "upper_leg_rigidity_plate", "neck_pitch", "motor_support",
               "trunk_base", "yaw2roll", "yaw_roll_motion"), .2),
]


def category(mesh):
    for name, meshes, keep in CATEGORIES:
        if mesh in meshes:
            return name, keep
    return "frame", .2


def creased_normals(v, f, crease_deg=35.0):
    """Smooth vertex normals that keep sharp CAD edges, precomputed so the browser does no work.
    Each face corner averages the (area-weighted) normals of faces sharing its vertex whose normal is
    within crease_deg of its own; corners with different results become separate vertices."""
    cos_c = np.cos(np.radians(crease_deg))
    # Weld coincident positions first so smoothing sees true neighbours.
    keys, weld = np.unique(np.round(v / 1e-6).astype(np.int64), axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    pos = np.zeros((len(keys), 3)); pos[weld] = v
    fw = weld[f]
    a, b, c = pos[fw[:, 0]], pos[fw[:, 1]], pos[fw[:, 2]]
    cross = np.cross(b - a, c - a)
    fn = cross / np.maximum(np.linalg.norm(cross, axis=1, keepdims=True), 1e-20)
    corner_v = fw.reshape(-1)
    corner_f = np.repeat(np.arange(len(fw)), 3)
    order = np.argsort(corner_v, kind="stable")
    starts = np.searchsorted(corner_v[order], np.arange(len(pos) + 1))
    normals = np.zeros((len(corner_v), 3))
    for vid in range(len(pos)):
        idx = order[starts[vid]:starts[vid + 1]]
        if len(idx) == 0:
            continue
        faces = corner_f[idx]
        n = fn[faces]; w = cross[faces]  # area-weighted (|cross| = 2 * area)
        dots = n @ n.T
        acc = (dots > cos_c).astype(float) @ w
        normals[idx] = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-20)
    # Dedupe corners by (welded position, quantised normal) into an indexed mesh.
    qn = np.round(normals * 127).astype(np.int8)
    combo = np.concatenate([corner_v[:, None], qn.astype(np.int64)], axis=1)
    uniq, inv = np.unique(combo, axis=0, return_inverse=True)
    out_v = pos[uniq[:, 0]].astype(np.float32)
    out_n = uniq[:, 1:].astype(np.int8)
    return out_v, out_n, inv.reshape(-1, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", type=int, default=70000)
    args = ap.parse_args()
    meta = json.load(open(os.path.join(args.src, "robot.json")))
    blob = open(os.path.join(args.src, "robot.bin"), "rb").read()

    groups = defaultdict(lambda: {"v": [], "f": [], "n": 0, "keep": 1.0})
    dropped = 0
    for p in meta["parts"]:
        off, nv = p["positions"]; ioff, ni = p["indices"]
        if any(h in p["mesh"].lower() for h in HIDDEN):
            dropped += ni // 3
            continue
        v = np.frombuffer(blob, "<f4", nv * 3, off).reshape(-1, 3)
        f = np.frombuffer(blob, "<u4", ni, ioff).reshape(-1, 3)
        cat, keep = category(p["mesh"])
        g = groups[(p["body"], cat)]
        g["keep"] = keep
        g["f"].append(f + g["n"]); g["v"].append(v); g["n"] += nv

    # Scale every category's keep ratio so the whole robot lands near --target triangles.
    weighted = sum(sum(len(f) for f in g["f"]) * g["keep"] for g in groups.values())
    budget = min(1.0 / max(g["keep"] for g in groups.values()), args.target / weighted)
    out_parts, out = [], bytearray()
    kept = 0
    for (body, cat), g in groups.items():
        v = np.concatenate(g["v"]).astype(np.float32); f = np.concatenate(g["f"]).astype(np.int64)
        ratio = min(1.0, g["keep"] * budget)
        if ratio < .98 and len(f) > 400:
            v, f = fast_simplification.simplify(v, f, target_reduction=1 - ratio)
        v, normals, f = creased_normals(v, f)
        lo, hi = v.min(0), v.max(0)
        scale = np.maximum(hi - lo, 1e-9) / 65534.0
        q = np.round((v - lo) / scale - 32767).astype("<i2")
        pos_off = len(out); out += q.tobytes()
        if len(out) % 4: out += b"\0" * (4 - len(out) % 4)
        nrm_off = len(out); out += normals.astype("i1").tobytes()
        if len(out) % 4: out += b"\0" * (4 - len(out) % 4)
        dtype = "<u2" if len(v) < 65536 else "<u4"
        idx_off = len(out); out += f.astype(dtype).tobytes()
        if len(out) % 4: out += b"\0" * (4 - len(out) % 4)
        kept += len(f)
        out_parts.append({"body": body, "category": cat, "vertices": int(len(v)), "triangles": int(len(f)),
                          "positions": pos_off, "normals": nrm_off, "indices": idx_off, "index32": dtype == "<u4",
                          "min": [float(x) for x in lo], "scale": [float(x) for x in scale]})
    os.makedirs(args.out, exist_ok=True)
    open(os.path.join(args.out, "robot.bin"), "wb").write(out)
    json.dump({"source": meta["source"], "units": "m", "frame": "MuJoCo world: x forward, y left, z up",
               "quantisation": "pos = min + (int16 + 32767) * scale; normals int8 / 127 (creased, precomputed)", "parts": out_parts},
              open(os.path.join(args.out, "robot.json"), "w"), indent=1)
    print(f"dropped {dropped} hidden triangles; kept {kept} in {len(out_parts)} meshes; {len(out) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
