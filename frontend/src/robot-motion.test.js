import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMotion } from './robot-motion.js';

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
