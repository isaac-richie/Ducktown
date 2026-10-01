import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ExactDuck, quatFromEuler } from './exact-duck.js';

const tree = JSON.parse(readFileSync(new URL('./policy/tree.json', import.meta.url)));

function check(duck, poses, ground, feet) {
  for (const side of ['left','right']) {
    const f=feet[side]||{lift:0,reach:0}, o=duck.footOffset[side];
    const yaw=ground.yaw||0, lx=o[0]+f.reach, ly=o[1];
    const want=[ground.pos[0]+lx*Math.cos(yaw)-ly*Math.sin(yaw), ground.pos[1]+lx*Math.sin(yaw)+ly*Math.cos(yaw), o[2]+f.lift];
    const got=poses.get(side==='left'?'ankle_left':'ankle_right').pos;
    const err=Math.hypot(got[0]-want[0],got[1]-want[1],got[2]-want[2]);
    assert.ok(err<1e-3,`${side} foot misses its target by ${(err*1000).toFixed(2)} mm`);
  }
  for (const [name,[lo,hi]] of Object.entries(duck.ranges)) assert.ok(duck.angles[name]>=lo-1e-9 && duck.angles[name]<=hi+1e-9, `${name} outside its motor range`);
}

test('exact legs reach their foot targets: stand, crouch, weight shift, step, turn',()=>{
  const duck=new ExactDuck(tree);
  const cases=[
    {crouch:0,shift:0,feet:{}},
    {crouch:.02,shift:0,feet:{}},
    {crouch:.008,shift:.011,feet:{right:{lift:.012,reach:.008}}},
    {crouch:.008,shift:-.011,feet:{left:{lift:.012,reach:-.006}}},
    {crouch:.01,shift:0,feet:{},yaw:.8}
  ];
  for (const c of cases) {
    const yaw=c.yaw||0, yq=quatFromEuler(0,0,yaw);
    const ground={pos:[0,0,0],yawQuat:yq,yaw};
    const side=[-Math.sin(yaw)*c.shift, Math.cos(yaw)*c.shift];
    const trunk={pos:[side[0],side[1],duck.standHeight-c.crouch],quat:yq};
    for (let i=0;i<4;i++) duck.solve({trunk,ground,feet:c.feet}); // warm start, like frame-to-frame
    check(duck, duck.solve({trunk,ground,feet:c.feet}), ground, c.feet);
  }
});
