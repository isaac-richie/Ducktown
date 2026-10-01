import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMotion, solveLeg, ANKLE_REST, sampleGait, REAL_GAIT, GAIT } from './robot-motion.js';

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
  for(const [name,duration] of Object.entries({'sit-stand':7,kick:5,grab:6,'get-up':9,waddle:4.8})){
    const start=sampleMotion(name,0),end=sampleMotion(name,duration-.001);
    for(const key of Object.keys(start))assert.ok(Math.abs(start[key]-end[key])<.001,`${name} loop jumps`);
    for(let t=0;t<duration;t+=.01){
      const m=sampleMotion(name,t);
      assert.ok(m.crouch<=3.6 && m.reach<=3.2 && m.tip<=1.6 && m.lift<=1.6 && m.liftL<=1.6 && m.jaw<=.34 && Math.abs(m.lean)<=.35,`${name} out of range`);
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

test('get-up lies flat on the shell before rising, and the waddle alternates feet',()=>{
  assert.ok(sampleMotion('get-up',3).tip>1.4);
  assert.ok(sampleMotion('get-up',7.8).tip<.001);
  assert.ok(sampleMotion('waddle',.8).lift>1 && sampleMotion('waddle',.8).liftL===0);
  assert.ok(sampleMotion('waddle',2).liftL>1 && sampleMotion('waddle',2).lift===0);
});

test('battle gait alternates planted and swinging feet and loops without a jump',()=>{
  for(let p=0;p<1;p+=.01){
    const g=sampleGait(p);
    assert.ok(g.lift===0 || g.liftL===0,'both feet in the air');
    for(const v of Object.values(g))assert.ok(Number.isFinite(v));
  }
  const a=sampleGait(0),b=sampleGait(.9999);
  for(const key of Object.keys(a))assert.ok(Math.abs(a[key]-b[key])<.01,`gait ${key} jumps at wrap`);
  assert.ok(sampleGait(.75).lift>1.5 && sampleGait(.25).liftL>1.5);
});

test('real walk shuffles: shorter, lower, and quicker than the battle run, with a level head',()=>{
  assert.ok(REAL_GAIT.stride<GAIT.stride/2 && REAL_GAIT.height<GAIT.height/3 && REAL_GAIT.cadence>GAIT.cadence);
  for(let p=0;p<1;p+=.01){
    const g=sampleGait(p,REAL_GAIT);
    assert.ok(g.lift===0 || g.liftL===0);
    assert.ok(g.roll===0 && g.yaw===0 && g.pitch===0,'head should stay steady');
    assert.ok(Math.abs(g.hipRoll)<=REAL_GAIT.hipRoll+1e-9);
  }
});

test('turning lengthens the outer stride and shortens the inner one',()=>{
  const straight=sampleGait(0,REAL_GAIT),turning=sampleGait(0,REAL_GAIT,.4);
  assert.ok(Math.abs(turning.reach-straight.reach*.6)<1e-9);
  assert.ok(Math.abs(sampleGait(.5,REAL_GAIT,.4).reachL-sampleGait(.5,REAL_GAIT).reachL*1.4)<1e-9);
});
