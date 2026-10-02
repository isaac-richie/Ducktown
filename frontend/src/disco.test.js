import test from 'node:test';
import assert from 'node:assert/strict';
import {danceCommands, detectBeats, buildScore, POSE_LIMITS} from './disco.js';

test('dance stays inside the real robot.pose trained ranges', () => {
  for (let b = 0; b < 64; b += .01) {
    const {pose, mouth} = danceCommands(b, 1);
    assert.ok(pose.z >= -0.025 && pose.z <= 0.010);
    assert.ok(Math.abs(pose.roll) <= .26 && Math.abs(pose.pitch) <= .26);
    assert.ok(pose.z >= POSE_LIMITS.z[0] && mouth.open >= 0 && mouth.open <= 1);
  }
});

test('beat detection finds the tempo of a click track', () => {
  const rate = 22050, bpm = 120, samples = new Float32Array(rate * 12);
  for (let k = 0; k * 60 / bpm < 12; k++) {
    const start = Math.round((.1 + k * 60 / bpm) * rate);
    for (let i = 0; i < 800 && start + i < samples.length; i++) samples[start + i] = Math.sin(i / rate * 2 * Math.PI * 60) * Math.exp(-i / 200);
  }
  const found = detectBeats(samples, rate);
  assert.ok(Math.abs(found.bpm - bpm) < 2, `bpm ${found.bpm}`);
});

test('score is 50 Hz robot commands', () => {
  const score = buildScore({bpm: 118, seconds: 4});
  assert.equal(score.frames.length, 200);
  assert.ok('robot.pose' in score.frames[0] && 'robot.head' in score.frames[0]);
});
