import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMotion, solveLeg, ANKLE_REST } from './robot-motion.js';

test('authored gestures stay bounded and close their loops without a jump',()=>{
  for(const [name,duration] of Object.entries({idle:8,'polite-bow':7,'hello-wave':6,'duck-spot':7,'balance-back':6,'tiny-dance':5,'ball-follow':8})){
    for(let t=0;t<duration;t+=.01){
      for(const [key,value] of Object.entries(sampleMotion(name,t))){
        assert.ok(Number.isFinite(value));
        assert.ok(Math.abs(value)<=(key==='ball'?7.001:.35),`${name} exceeds ${key} presentation range`);
      }
    }
    const start=sampleMotion(name,0),end=sampleMotion(name,duration-.001);
    for(const key of Object.keys(start))assert.ok(Math.abs(start[key]-end[key])<.001,`${name} loop jumps`);
  }
});

test('bow includes anticipation, a held greeting, and a settled finish',()=>{
  assert.ok(sampleMotion('polite-bow',.7).pitch<0);
  assert.deepEqual(sampleMotion('polite-bow',1.7),sampleMotion('polite-bow',2.3));
  assert.ok(sampleMotion('polite-bow',2).pitch>.3);
  assert.deepEqual(sampleMotion('polite-bow',5),sampleMotion('polite-bow',0));
});

test('new tricks loop cleanly and stay in a believable range',()=>{
  for(const [name,duration] of Object.entries({'sit-stand':7,kick:5,grab:6})){
    const start=sampleMotion(name,0),end=sampleMotion(name,duration-.001);
    for(const key of Object.keys(start))assert.ok(Math.abs(start[key]-end[key])<.001,`${name} loop jumps`);
    for(let t=0;t<duration;t+=.01){
      const m=sampleMotion(name,t);
      assert.ok(m.crouch<=3.6 && m.reach<=3.2 && m.jaw<=.34 && Math.abs(m.lean)<=.35,`${name} out of range`);
    }
  }
});

test('leg solve keeps the rest pose and plants the ankle through a crouch',()=>{
  const restPose=solveLeg(ANKLE_REST,0);
  for(const value of Object.values(restPose))assert.ok(Math.abs(value)<1e-6);
  for(const crouch of [.5,1.5,3.5]){
    const {hip,knee}=solveLeg(ANKLE_REST+crouch,0);
    const rot=(v,a)=>[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)];
    const k=rot([-3.65,-1.4],hip),a=rot([-4.5,1.4],hip+knee);
    assert.ok(Math.abs(k[0]+a[0]-(ANKLE_REST+crouch))<1e-6 && Math.abs(k[1]+a[1])<1e-6);
  }
});
