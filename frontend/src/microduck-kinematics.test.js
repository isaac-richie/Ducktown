import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forwardKinematics, qposFrom } from './microduck-kinematics.js';

const tree = JSON.parse(readFileSync(new URL('./policy/tree.json', import.meta.url)));

test('forward kinematics places every body exactly where MuJoCo did',()=>{
  for(const frame of tree.fixture){
    const poses=forwardKinematics(tree,frame.qpos);
    for(const [name,expected] of Object.entries(frame.bodies)){
      const {pos,quat}=poses.get(name);
      const dp=Math.hypot(pos[0]-expected[0],pos[1]-expected[1],pos[2]-expected[2]);
      const dot=Math.abs(quat[0]*expected[3]+quat[1]*expected[4]+quat[2]*expected[5]+quat[3]*expected[6]);
      assert.ok(dp<1e-5,`${name} position off by ${dp}`);
      assert.ok(dot>1-1e-6,`${name} rotation off`);
    }
  }
});

test('joint angles are clamped to the real motor ranges',()=>{
  const qpos=qposFrom(tree,{left_knee:99});
  const knee=tree.bodies.find(b=>b.joint?.name==='left_knee').joint;
  assert.equal(qpos[knee.qposadr],knee.range[1]);
  assert.equal(tree.actuated.length,14);
});
