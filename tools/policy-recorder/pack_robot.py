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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", type=int, default=70000)
    args = ap.parse_args()
    meta = json.load(open(os.path.join(args.src, "robot.json")))
    blob = open(os.path.join(args.src, "robot.bin"), "rb").read()

    groups = defaultdict(lambda: {"v": [], "f": [], "n": 0})
    dropped = 0
    for p in meta["parts"]:
        off, nv = p["positions"]; ioff, ni = p["indices"]
        if any(h in p["mesh"].lower() for h in HIDDEN):
            dropped += ni // 3
            continue
        v = np.frombuffer(blob, "<f4", nv * 3, off).reshape(-1, 3)
        f = np.frombuffer(blob, "<u4", ni, ioff).reshape(-1, 3)
        g = groups[(p["body"], tuple(p["rgba"]))]
        g["f"].append(f + g["n"]); g["v"].append(v); g["n"] += nv

    total = sum(sum(len(f) for f in g["f"]) for g in groups.values())
    ratio = min(1.0, args.target / total)
    out_parts, out = [], bytearray()
    kept = 0
    for (body, rgba), g in groups.items():
        v = np.concatenate(g["v"]).astype(np.float32); f = np.concatenate(g["f"]).astype(np.int64)
        if ratio < 1 and len(f) > 400:
            v, f = fast_simplification.simplify(v, f, target_reduction=1 - ratio)
        lo, hi = v.min(0), v.max(0)
        scale = np.maximum(hi - lo, 1e-9) / 65534.0
        q = np.round((v - lo) / scale - 32767).astype("<i2")
        pos_off = len(out); out += q.tobytes()
        if len(out) % 4: out += b"\0" * (4 - len(out) % 4)
        dtype = "<u2" if len(v) < 65536 else "<u4"
        idx_off = len(out); out += f.astype(dtype).tobytes()
        if len(out) % 4: out += b"\0" * (4 - len(out) % 4)
        kept += len(f)
        out_parts.append({"body": body, "rgba": list(rgba), "vertices": int(len(v)), "triangles": int(len(f)),
                          "positions": pos_off, "indices": idx_off, "index32": dtype == "<u4",
                          "min": [float(x) for x in lo], "scale": [float(x) for x in scale]})
    os.makedirs(args.out, exist_ok=True)
    open(os.path.join(args.out, "robot.bin"), "wb").write(out)
    json.dump({"source": meta["source"], "units": "m", "frame": "MuJoCo world: x forward, y left, z up",
               "quantisation": "pos = min + (int16 + 32767) * scale", "parts": out_parts},
              open(os.path.join(args.out, "robot.json"), "w"), indent=1)
    print(f"dropped {dropped} hidden triangles; kept {kept} in {len(out_parts)} meshes; {len(out) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
