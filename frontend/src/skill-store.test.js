import test from 'node:test';
import assert from 'node:assert/strict';
import {prettyName, pickMedia, toSkill} from './skill-store.js';

test('skill names drop the microduck prefix and hash suffixes', () => {
  assert.equal(prettyName('HannesVonEssen/microduck-chimney-climb'), 'Chimney climb');
  assert.equal(prettyName('fffiloni/microduck-polite-bow-b1d864'), 'Polite bow');
  assert.equal(prettyName('pollen-robotics/microduck-policies'), 'Official skill set');
});

test('the preview prefers a top-level clip over old training iterations', () => {
  const {video} = pickMedia(['legacy/iteration-8749/media/preview.mp4', 'lineage/x/preview.mp4', 'media/preview.mp4']);
  assert.equal(video, 'media/preview.mp4');
  assert.equal(pickMedia(['preview.mp4', 'thumbnail.webp']).poster, 'thumbnail.webp');
});

test('only public repos with an ONNX policy become skills', () => {
  const base = {id: 'a/microduck-hop', likes: 2, downloads: 5, tags: ['kind:episodic'], lastModified: '2026-09-01'};
  assert.equal(toSkill({...base, siblings: [{rfilename: 'README.md'}]}), null);
  assert.equal(toSkill({...base, gated: 'auto', siblings: [{rfilename: 'policy.onnx'}]}), null);
  const skill = toSkill({...base, siblings: [{rfilename: 'policy.onnx'}, {rfilename: 'manifest.json'}]});
  assert.equal(skill.kind, 'trick');
  assert.equal(skill.hasManifest, true);
});
