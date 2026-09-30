# Microduck visual study

Ducktown's robot visual is an original procedural Three.js model in [`microduck-3d.js`](./microduck-3d.js). It was drawn from the publicly displayed [Microduck press photographs and colorways](https://pollen-robotics.com/microduck/press-kit/), with the robot's long hood, small single camera lens, separate bill, exposed articulated neck and legs, and orange or yellow layered feet as the main reference points. The shell colors use the press kit's published swatches. Geometry and joint poses are approximate presentation art, not Pollen Robotics CAD or a simulation output.

The [official simulator](https://huggingface.co/spaces/pollen-robotics/microduck-simulator) contains model assets. The [Microduck RL repository](https://github.com/pollen-robotics/microduck_rl#license) says 3D model files carry a Creative Commons BY-SA-NC license. This commercial product prototype does not copy its STL, GLB, or kinematics files. A separate license review would be needed before distributing any official hardware asset in Ducktown.

Three.js is vendored locally at `vendor/node_modules/three/` under its included MIT license. A simplified inline SVG is kept as a graceful fallback if WebGL is unavailable. The 3D choreography is hand authored and labeled as a visual study; it does not issue hardware commands or run a robot policy.

The sidebar now uses an original, compact [`microduck-head-mark.svg`](./microduck-head-mark.svg) drawn against Pollen's current header sticker and product photographs. It faces right like the header reference: cream shell behind a grey front panel, one orange-rimmed camera, small side sensor, narrow orange lower bill, and a rear hinge. Its gradients and paths are Ducktown artwork, not Pollen's official mark or a copy of their sticker.

## September visual comparison

Compared with the [official Microduck homepage](https://pollen-robotics.com/microduck/) and its [kickabout press photograph](https://pollen-robotics.com/assets/microduck/press/photos/microduck-kickabout.jpg): the current study now has a deeper cream hood, dark recessed front panel, one offset circular camera with a yellow surround, layered orange bill, side seam/hinge, exposed neck, articulated legs, and the four published shell colors. Ducktown keeps its own green-and-cream social-product identity; orange/yellow hardware accents connect it visually to the robot.

It is still an interpretation, not a photorealistic or dimensionally accurate Microduck. The curved shell aperture, beak hinge, motor castings, and neck wiring remain simplified, and the keyframed ball-follow loop is not Pollen's gait or policy. Before an investor or Pollen demo, obtain permission for approved product imagery or a licensed official mesh, align on brand usage, and validate any hardware or SDK claims against the shipped robot. The new Pond workflow panel quotes the broad train/deploy/refine/publish concept from Pollen's homepage but labels Ducktown's sharing layer as proposed.
