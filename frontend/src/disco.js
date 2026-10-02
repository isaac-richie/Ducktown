// Duck Disco: music in, real-robot commands out.
//
// Every move is expressed in the Microduck's own command vocabulary (pollen-robotics/microduck,
// duck-ipc-proto): robot.pose {z, roll, pitch}, robot.head {neck_pitch, head_pitch, head_yaw,
// head_roll}, robot.mouth {open}, robot.sound {tag}. Ducktown's 3D duck performs exactly these,
// and the same dance can be exported as a timed score for a real robot.

// Pollen's trained ranges for robot.pose (the robot clamps nothing, so we must stay inside):
// z −0.025..+0.010 m, roll and pitch ±0.26 rad. We keep a safety margin.
export const POSE_LIMITS = {z: [-0.022, 0.008], roll: [-0.2, 0.2], pitch: [-0.18, 0.18]};
// Head offsets from the robot's default head pose (radians), kept gentle.
export const HEAD_LIMITS = {neck_pitch: .18, head_pitch: .3, head_yaw: .45, head_roll: .3};
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const sym = (v, m) => Math.min(m, Math.max(-m, v));

// beat: running beat count (float, e.g. 12.25 = a quarter after beat 12); energy: 0..1 loudness.
// Returns the command set for this instant. Pure, so it can be tested and exported.
export function danceCommands(beat, energy = .7) {
  const b = beat - Math.floor(beat), n = Math.floor(beat), e = Math.min(1, Math.max(0, energy));
  const bar = Math.floor(n / 4), inBar = n % 4, section = bar % 4; // change it up every bar
  const hit = Math.exp(-b * 7);                                   // sharp accent right on the beat
  const sway = Math.sin(Math.PI * (beat / 2));                    // hips: left on one beat, right on the next
  const z = -0.018 * hit * (.5 + .5 * e) + 0.004 * Math.sin(2 * Math.PI * b);
  let roll = .17 * sway * (.6 + .4 * e), pitch = .05 * Math.sin(2 * Math.PI * beat / 4);
  let yaw = .38 * Math.sin(Math.PI * beat / 4), nod = .22 * hit, tilt = .2 * sway;
  if (section === 1) { pitch = .12 * hit; yaw *= .5; }             // bow-bounce bar
  if (section === 2) { roll *= -1; tilt = -.25 * Math.sin(Math.PI * beat); } // head-wiggle bar
  if (section === 3) { yaw = .42 * Math.sign(Math.sin(Math.PI * beat / 2)) * (1 - hit * .3); } // look left/right
  return {
    pose: {z: clamp(z, POSE_LIMITS.z), roll: clamp(roll, POSE_LIMITS.roll), pitch: clamp(pitch, POSE_LIMITS.pitch)},
    head: {neck_pitch: sym(-.08 * hit, HEAD_LIMITS.neck_pitch), head_pitch: sym(nod - .05, HEAD_LIMITS.head_pitch),
      head_yaw: sym(yaw, HEAD_LIMITS.head_yaw), head_roll: sym(tilt, HEAD_LIMITS.head_roll)},
    mouth: {open: inBar === 0 ? Math.min(1, hit * 1.2) : .15 * hit},
    // A voice cue on the first beat of every second bar (robot.sound is a one-shot tag).
    sound: b < .06 && inBar === 0 && bar % 2 === 1 ? ['chirp', 'coo', 'greet'][bar % 3] : null
  };
}

// --- Tempo and beat detection for uploaded songs (offline, on the decoded audio) ---

// Returns {bpm, offset} where beats fall at offset + k * 60 / bpm seconds.
export function detectBeats(samples, sampleRate, {minBpm = 80, maxBpm = 160} = {}) {
  const hop = 512, frames = Math.floor(samples.length / hop);
  // Low-passed energy envelope (kick drum / bass), then positive differences = onset strength.
  const env = new Float32Array(frames);
  let lp = 0;
  const a = Math.exp(-2 * Math.PI * 150 / sampleRate);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) { lp = a * lp + (1 - a) * samples[i]; sum += lp * lp; }
    env[f] = Math.sqrt(sum / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);
  const fps = sampleRate / hop;
  // Autocorrelation over the tempo range picks the beat period.
  let best = 0, bestLag = 0;
  for (let lag = Math.round(fps * 60 / maxBpm); lag <= Math.round(fps * 60 / minBpm); lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag) return {bpm: 120, offset: 0};
  // Refine to a fractional lag (parabolic peak) for an accurate BPM.
  const ac = lag => { let s = 0; for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag]; return s; };
  const y0 = ac(bestLag - 1), y1 = best, y2 = ac(bestLag + 1), denom = y0 - 2 * y1 + y2;
  const lag = bestLag + (denom ? .5 * (y0 - y2) / denom : 0);
  // Phase: the offset whose beat grid collects the most onset strength.
  let bestPhase = 0, bestScore = -1;
  for (let p = 0; p < Math.ceil(lag); p++) {
    let s = 0;
    for (let f = p; f < frames; f += lag) s += onset[Math.round(f)] || 0;
    if (s > bestScore) { bestScore = s; bestPhase = p; }
  }
  return {bpm: 60 * fps / lag, offset: bestPhase / fps};
}

// --- Audio engine ---

export class DiscoAudio {
  constructor() { this.ctx = null; this.source = null; this.timer = null; this.mode = null; this.track = null; }

  ensure() {
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.analyser) {
      this.master = this.ctx.createGain(); this.master.gain.value = .7;
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512;
      this.master.connect(this.analyser); this.analyser.connect(this.ctx.destination);
      this.level = new Uint8Array(this.analyser.frequencyBinCount);
    }
    return this.ctx;
  }

  // A royalty-free beat synthesised on the fly (four-on-the-floor, 118 BPM).
  playDemo(bpm = 118) {
    this.stop(); const ctx = this.ensure();
    this.mode = 'demo'; this.bpm = bpm; this.start = ctx.currentTime + .08; this.track = 'Ducktown demo beat';
    const spb = 60 / bpm, roots = [55, 55, 49, 52]; // A, A, G, G#… in Hz (low bass)
    let next = 0;
    const noise = ctx.createBuffer(1, ctx.sampleRate * .3, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const hit = (t, fn) => fn(t);
    const kick = t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(.001, t + .28); o.connect(g).connect(this.master); o.start(t); o.stop(t + .3); };
    const noiseHit = (t, freq, dur, vol) => { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = 'highpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur); };
    const bass = (t, hz) => { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = hz; f.type = 'lowpass'; f.frequency.value = 600; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.32, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + spb * .45); o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + spb * .5); };
    const schedule = () => {
      while (this.start + next * spb / 2 < ctx.currentTime + .15) {
        const t = this.start + next * spb / 2, eighth = next % 8, beat = Math.floor(next / 2), bar = Math.floor(beat / 4);
        if (eighth % 2 === 0) hit(t, kick);
        else noiseHit(t, 7000, .05, .18);
        if (eighth === 2 || eighth === 6) noiseHit(t, 1500, .16, .35);
        bass(t, roots[bar % 4] * (eighth % 2 ? 2 : 1));
        next++;
      }
    };
    schedule(); this.timer = setInterval(schedule, 25);
  }

  async playFile(file) {
    this.stop(); const ctx = this.ensure();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = buffer.getChannelData(0);
    const {bpm, offset} = detectBeats(mono, buffer.sampleRate);
    const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(this.master);
    this.mode = 'file'; this.bpm = bpm; this.start = ctx.currentTime + .05 + offset; this.track = file.name;
    src.start(ctx.currentTime + .05); this.source = src;
    src.onended = () => { if (this.source === src) this.stop(); };
    return {bpm, offset};
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    try { this.source?.stop(); } catch {}
    this.source = null; this.mode = null;
  }

  get playing() { return !!this.mode; }

  // Current beat position and loudness, or null when nothing is playing.
  now() {
    if (!this.mode) return null;
    const t = this.ctx.currentTime - this.start;
    if (t < 0) return {beat: 0, energy: 0};
    this.analyser.getByteFrequencyData(this.level);
    let sum = 0; for (let i = 0; i < 24; i++) sum += this.level[i];
    return {beat: t * this.bpm / 60, energy: Math.min(1, sum / (24 * 200))};
  }
}

// A timed score of real-robot commands (50 Hz), for driving a physical Microduck later.
export function buildScore({bpm, seconds = 32, energy = .75}) {
  const hz = 50, frames = [];
  for (let i = 0; i < seconds * hz; i++) {
    const t = i / hz, c = danceCommands(t * bpm / 60, energy);
    frames.push({t: +t.toFixed(3), 'robot.pose': c.pose, 'robot.head': c.head, 'robot.mouth': c.mouth, ...(c.sound ? {'robot.sound': {tag: c.sound}} : {})});
  }
  return {
    format: 'ducktown-disco-score/1', bpm: +bpm.toFixed(2), hz,
    note: "Commands use pollen-robotics/microduck robot.* JSON-RPC params. robot.head values are offsets from the robot's default head pose. robot.pose stays inside Pollen's trained ranges.",
    frames
  };
}
