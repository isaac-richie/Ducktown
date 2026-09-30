# Ducktown UI draft

**Working product:** Ducktown, a social town for Microduck residents and the people who care for them.

**Prototype stage:** concept UI; sample activity is illustrative and does not claim live SDK connectivity.

## The product decision

Make the resident (the duck) the center of the interface. People create and supervise residents; residents accrue a visible history of experiments, behaviors, and community participation. Keep the town metaphor from Musebook, and make the signature content distinctly robotic: a behavior, an experiment, a challenge result, or a physical-world moment with its evidence and provenance.

The first usable product should support simulation residents before hardware is available. A simulation resident can have a profile, join rooms, enter challenges, and publish replays. A later hardware connection attaches a real Microduck to that resident after owner pairing.

## What is left

### Product and UX

- Validate the town metaphor with Microduck users and SDK contributors.
- Decide whether the first audience is hobbyists, educators, or researchers. Prototype assumes hobbyists and makers.
- Define resident identity, owner link, visibility, and what is public by default.
- Design mobile layouts and accessibility states beyond this desktop-first draft.
- Decide how much agent-authored conversation is allowed versus structured robot event posts.

### SDK and robotics discovery

- Read the current official README and docs index, then trace the exact local/network API and authentication for robot control.
- Verify current simulator launch, reset, observation, camera, and multi-instance interfaces against source code.
- Verify policy manifest fields, validation, install/activate/rollback commands, signing/provenance, and policy permissions.
- Verify which event sources exist today (falls, skills, health, policy changes, camera frames) and which need a companion service.
- Confirm hardware connection and remote-control boundaries on actual firmware before implementing a robot adapter.

### Platform engineering

- Define event and behavior package schemas.
- Build a local companion/adapter with offline queueing and owner approval.
- Build cloud identity, rooms, feed, media, challenge, and policy registry services.
- Add simulation job limits, artifact storage, moderation, and safety review.
- Add real-hardware verification only after simulator flow and local approval are proven.

## Proposed information architecture

| Place | Job | First-release content |
|---|---|---|
| Pond | Browse community activity | Behavior posts, simulator replays, robot moments, questions |
| Town map | Orient and discover | Rooms, current activity, challenge calendar |
| Workshop | Build together | Policy packages, experiments, forks, review requests |
| Arena | Give people a reason to return | Small, measurable simulation challenges |
| Schoolhouse | Help newcomers get started | SDK guides, simulator setup, policy explainers |
| Duck profile | Give each resident continuity | Identity, owner link, skills, history, current mode |
| Human Perch | Give owners control | Pairing, permissions, privacy, approvals, activity log |

## Main screen plan

### Pond — home

The home opens with a large interactive robot stage and an editorial explanation of Ducktown's purpose. It offers viewing angles and all four official shell colorways. The adjacent panel explains the Workshop, evidence, and social profiles, with a direct link to Pollen Robotics' official simulator. A town pulse and community feed follow.

Desktop layout:

- Left: town navigation and the current user's duck.
- Center: featured moment, feed filters, activity cards.
- Right: current resident status, weekly challenge, active rooms, trust explanation.

The feed card is the core reusable component. It shows the author and room, one short result-oriented statement, optional replay/video, a provenance receipt, and actions to reply, save, inspect, or try the behavior. Provenance labels should be explicit: **Simulation**, **Hardware**, or **Unverified upload**.

### Duck profile

- Name, avatar, owner, identity status, and whether it is simulation-only or hardware-connected.
- Skills and published behavior packages.
- Recent activity and challenge history.
- A compact activity receipt for every claimed result.
- A clear distinction between generated narration and measured robot events.

### Behavior detail

- An immersive, replay-first viewer with a distinct robot colorway for each example.
- Separate Overview and Evidence tabs, so measured outcomes do not get confused with copywriting.
- What the behavior does and what robot/runtime versions it supports.
- Package version, license, publisher, content hash, permissions, simulation results, and hardware evidence.
- Actions: **Run in simulation**, **Fork**, **Save**, and later **Install on my duck**.
- Hardware install requires local owner approval and a visible rollback route.

### Arena challenge

- One measurable task, rules, supported simulation environment, time window, and scoring method.
- Submission includes policy version and replay, with hardware runs labeled separately.
- Leaderboards do not mix simulated and hardware results.

### Human Perch

- Connection health and last-seen time.
- Activity and approval history.
- Camera/microphone sharing controls.
- Policy install approval and rollback.
- Pause/stop controls only if the current SDK exposes a safe supported path; verify this in the SDK audit.

## Core flows

### Before owning a robot

1. Create a Ducktown account and a simulation resident.
2. Pick a starter personality and name.
3. Follow a beginner challenge.
4. Run a provided behavior in simulation.
5. Publish a replay with automatic simulation provenance.
6. Browse and fork community packages.

### When hardware arrives

1. Pair locally using the official Microduck setup path.
2. Owner confirms which Ducktown resident is linked to the physical unit.
3. Companion reports connection and runtime health without uploading camera or sensor streams by default.
4. Owner reviews a behavior package and its provenance.
5. Owner approves local install; robot runtime remains the authority for execution and safety.
6. Result is posted only under the resident's sharing settings.

## Visual direction

- Warm, quiet, and playful; a workshop notebook meets a small-town noticeboard.
- Cream paper, forest green, pale pond blue, and a restrained duck-yellow accent.
- Friendly rounded cards, readable typography, compact metadata.
- Use original illustrations and real simulator captures as content; avoid a busy cartoon town that competes with behavior evidence.
- The robot now uses an original, photo-referenced 3D presentation model: long hood, small camera lens, articulated bill, exposed neck and leg joints, compact torso, and layered feet. Its Cream, Graphite, Lavender, and Sky shell colors come from the [Microduck press kit](https://pollen-robotics.com/microduck/press-kit/). A simplified SVG remains as a fallback when WebGL is unavailable. Neither model is an official product render or calibrated CAD.
- On mobile, collapse to a single feed column with a compact top identity and bottom navigation.

### Motion system

- The Pond’s featured scene is an eight-second 3D ball-follow study: the ball travels, Pepper’s camera-head tracks it, and the legs make a restrained weight shift. Viewers can rotate the model to front, three-quarter, and side angles, drag it, and change between Cream, Graphite, Lavender, and Sky shells. The loop has a visible play/pause control and is labeled as a visual study without simulator telemetry.
- Workshop behavior cards use small, distinct actions—bow, head greeting, balance correction, dance, and friend-spotting—so motion communicates the behavior rather than decorating every surface identically.
- The expanded behavior viewer and motion-study player animate the same robot parts. Cards enter as they scroll into view; offscreen scenes pause.
- Arena and Town Map have quieter contextual motion: a welcoming wave and gently moving location markers. Challenge and place cards enter in a staggered rhythm.
- The robot motion runs in a Three.js rig rendered through one shared WebGL context; UI accents use CSS transforms and opacity. Offscreen robots stop drawing. The header has a persistent site-wide pause/resume switch, and the featured loop and motion-study player have their own controls. `prefers-reduced-motion` disables the choreography and entrance effects, leaving a still model visible.

## Interaction prototype

Open [ducktown.html](./ducktown.html) in a browser. The responsive front end includes the Pond, Workshop, Arena, Town Map, Pepper’s profile, and Human Perch. It supports local search, feed filters, behavior details, challenge joining, owner settings, illustrative replays, and local notes. These interactions are front-end demonstrations only; there is no backend or SDK connection yet. The earlier [ducktown-ui-draft.html](./ducktown-ui-draft.html) remains as an initial wireframe.

The Sim Lab now opens Pollen’s official browser sandbox for real published policies, while Ducktown’s own animation is clearly labeled as a non-executing UI preview. No new result receipt or public post is created by that animation. See the [Microduck integration brief](./microduck-integration-brief.md) for the daemon-backed path to measured runs.

## First implementation milestone

Build one vertical slice before expanding the town:

1. Simulator resident profile.
2. One predefined simulation challenge.
3. Run and replay one known policy.
4. Publish an immutable result receipt with policy/version and simulator metadata.
5. Show that result in the Pond feed and resident history.

That slice tests the product's defining loop—**run, observe, share, remix**—without requiring social scale or physical hardware. The SDK audit should confirm the simulator and policy interfaces before this becomes an implementation commitment.
