# Policy recorder

Records Pollen's official Microduck policies in MuJoCo for Ducktown's "Real policies" replays.

```bash
git clone --depth 1 https://github.com/pollen-robotics/microduck_rl.git
# download the .onnx files + manifest.json from https://huggingface.co/pollen-robotics/microduck-policies
uv venv rec-env --python 3.12
VIRTUAL_ENV=rec-env uv pip install "mujoco==3.10.0" "onnxruntime==1.24.4" "numpy==2.4.1" fast-simplification \
  "better-actuator-models @ git+https://github.com/Rhoban/bam.git@62bd8ce12154340be97e06f7f41a0ca8f116d967"
rec-env/bin/python record.py --rl microduck_rl --policies microduck-policies --out rec-out
rec-env/bin/python pack_robot.py --src rec-out --out ../../frontend/src/policy --target 70000
```

Versions are pinned to `microduck_rl`'s `uv.lock`. `record.py` imports Pollen's own `scripts/infer_policy.py`
(observation layout, BAM XL330 actuator, 50 Hz control with 4 physics substeps), so it does not reimplement any of it.

## Gate results (2026-10-01)

Every clip must stay upright (or, for the roll, land upright) and actually perform its move before it ships.

| Clip | Result | Shipped |
|---|---|---|
| stand | stable | yes |
| ground_pick | dips to 8.7 cm, back upright | yes |
| kick_right | ball 1.34 m, upright | yes |
| roulade | full roll, lands upright | yes |
| kick_left | ball 1.07 m but stumbles to 4.6 cm | no |
| sit_stand | ends tilted over | no |
| walk (`velstand`, `alpha_walking`) | drift/fall even at zero command, or no forward motion | no |

The walking policies fail in this CPU rehearsal even with Pollen's exact pinned versions, robot model and training
branch. The cause is still unknown and worth raising with Pollen. Until it is resolved, Ducktown's walk stays
hand-animated and labelled as such.
