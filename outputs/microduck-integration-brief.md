# Ducktown × Microduck: first real integration

Status: local social API foundation running; official daemon simulator connected through read-only CLI observation. The Ducktown web process has not executed a policy or robot action. A separate, fixed-scene SDK runner has observed one official simulator-only skill through live SDK telemetry and can now attach its validated trace to a chosen local account as a private receipt. The owner can then share a conservative summary. This does not produce a verified completion, ball-outcome score, or hardware result.

## Two official simulator paths

1. [Microduck Sandbox](https://huggingface.co/spaces/pollen-robotics/microduck-simulator) runs published RL policies in-browser with MuJoCo WebAssembly and ONNX Runtime Web. Its documented actions include walking, sit/stand, roll, and kicks. Ducktown now links to this real sandbox, but the sandbox does not document a result-export or embed-control API. Opening it is **not** a Ducktown run and produces no Ducktown receipt.
2. The [daemon-backed simulator](https://github.com/pollen-robotics/microduck/blob/main/docs/robot/simulation.md) uses `scripts/duck-sim` to run the robot daemons against `microduck_rl`'s MuJoCo body. It exposes the same `robotctl` and IPC surface as the robot, with a 50 Hz control loop. This is the right path for reproducible Ducktown run receipts and eventual hardware parity.

## Narrow vertical slice

1. Install the official `microduck` and `microduck_rl` repositories in a separate development checkout; use `scripts/duck-sim` and verify `status`, `ctl health --json`, `ctl policy list --json`, and `realtime` before any UI connection.
2. Build a local companion process. It should connect only to the simulator's local IPC socket, expose a small localhost API to Ducktown, and report connection/health without exposing credentials or raw camera streams.
3. Implement one official, published policy and one fixed scene. The companion starts a bounded run, records the actual policy identity and version, scene, start/end times, health, and observed outcome. Do not generate a success score in the browser.
4. Store a signed or content-hashed receipt and replay metadata, then render it in Pepper's history. Only a receipt with simulator-origin evidence may be labeled “simulation result.” Publishing to the Pond remains an explicit owner action.
5. Add community packages and hardware only after package compatibility, permissions, rollback, and physical safety checks are in place.

## Provenance contract

Every activity item needs `origin` (`illustrative`, `ui_preview`, `official_browser_sandbox`, `daemon_simulator`, or `hardware`) and a visible label. For measured runs, include `runtime_version`, `policy_id`, `policy_version_or_hash`, `scene_id`, `started_at`, `ended_at`, `metrics`, and `replay_artifact_hash`. Missing fields should remain “not verified,” never be filled with sample numbers.

## Current Ducktown behavior

- The UI animation is explicitly a non-executing preview; it writes no result, telemetry, or public post.
- Older preview entries in local browser storage are preserved but relabeled as UI previews.
- Workshop concept cards show no success rates or test claims; their animated replays remain non-executing visual studies, not verified Microduck results.
- The official Sandbox link lets users play with real published policies while the daemon adapter is built.
- A loopback-only Ducktown server now supports local accounts, owned simulation-only duck profiles, and owner-scoped notes. Legacy Pepper/demo notes remain unowned. It does **not** mint simulator receipts or control hardware. See [`../server/README.md`](../server/README.md).
- The first SDK-facing integration is a **read-only observer** of the documented `scripts/duck-sim` CLI (`status`, `ctl health --json`, `ctl policy list --json`, `ctl version`, `realtime`). It requires a configured official checkout and an already-running simulator; Ducktown does not start the simulator, execute policies, or produce verified results. Exit-zero but unavailable/empty SDK responses are rejected.
- Workshop now shows SDK-reported policy slots, skills, and daemon-built-in actions in a separate installed panel. It reads `robotctl policy list --json`; the six Ducktown cards below it remain illustrative concepts, never an installed inventory.
- A signed-in owner may explicitly capture a private SDK observation when all five checks succeed. The record preserves policy-list/version output and hashes, but is never a run receipt or score. Nothing is saved when the official simulator is absent or a check fails.
- On 2026-09-27, the official daemon simulator ran headless in an isolated state at 50 Hz. Ducktown's live parser and API matched the CLI output: seven slots, three policy skills, and two daemon-built-in actions. A controlled outage made all five observer checks fail; the simulator recovered after restart. This validates observation only, not policy performance or hardware safety.
- The separate `server/skill-smoke.js` runner can queue only the official seeded `kick_left` policy in the fixed one-duck scene after strict health and provenance preflight. It now captures the official `robotctl monitor --json` stream before submission and records the raw stream plus a hash. One live run observed a contiguous `stand → kick_left → stand` policy sequence and healthy postflight; the artifact is labeled execution observed in simulation, **not** SDK-confirmed completion, ball-kick success, or hardware validation. Earlier runs recorded an accepted queue acknowledgement and a transient postflight health failure rather than claiming success. The web API remains read-only.
- A local operator can now import one validated artifact to an existing account's private simulator receipt history. The import endpoint requires a private local token, replays the verdict from the raw SDK frames, and refuses duplicate or inflated claims. The Human Perch displays the summary with unverified operator attribution. No browser account can self-claim an artifact. The account owner can explicitly publish a fixed-wording, conservatively labeled summary to the local Pond; raw SDK telemetry stays private. The normal web API remains read-only with respect to simulator control.
- `server/run-challenge.js` closes the supported local loop for one fixed, isolated simulator-only `kick_left` attempt: account/server preflight → bounded official CLI execution → raw SDK trace → validated, private account receipt → owner review/share. The UI renders a three-event timeline derived from the trace, not a video or a made-up score. One opt-in live integration test completed this loop against a temporary test account and database. The official daemon stream does not expose ball displacement, so the result remains “move observed and returned,” never “ball kicked successfully.”

Sources: [official browser sandbox README](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/blob/main/README.md), [official daemon simulator guide](https://github.com/pollen-robotics/microduck/blob/main/docs/robot/simulation.md), [official `robotctl` cheat sheet](https://github.com/pollen-robotics/microduck/blob/main/docs/robot/cheatsheet.md).
