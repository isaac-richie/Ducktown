import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicyList } from './policies.js';

const sample=JSON.stringify({
  policies:{mode:'walk',enabled:true,homed:true,sitting:false,slots:[
    {slot:'walk',path:'walk.onnx',origin:'official',overridden:false,error:null},
    {slot:'roller',path:null,origin:null,overridden:false,error:null}
  ],skills:['kick_left','sit_toggle']},
  skills:{skills:[{name:'kick_left',path:'ball_kick_left.onnx',duration:.5},{name:'polite-bow',path:'owner/policy.onnx',duration:4,overridden:true}],built_in:['sit_toggle']}
});

test('parses the official robotctl policy list JSON contract',()=>{
  const parsed=parsePolicyList(sample);
  assert.equal(parsed.mode,'walk');
  assert.equal(parsed.enabled,true);
  assert.equal(parsed.slots[0].path,'walk.onnx');
  assert.equal(parsed.slots[1].path,null);
  assert.equal(parsed.skills[0].overridden,false);
  assert.equal(parsed.skills[1].durationSeconds,4);
  assert.equal(parsed.builtIn[0].kind,'daemon_built_in');
  assert.equal(parsed.detailsAvailable,true);
  const older=parsePolicyList(JSON.stringify({policies:{mode:'walk',enabled:false,slots:[],skills:['kick_left']},skills:null}));
  assert.equal(older.enabled,false);
  assert.equal(older.detailsAvailable,false);
  assert.equal(older.skills[0].kind,'listed_skill');
  assert.throws(()=>parsePolicyList('not json'),{status:502});
  assert.throws(()=>parsePolicyList(JSON.stringify({policies:{mode:'walk',enabled:'yes',slots:[]}})),{status:502});
});

test('rejects malformed or truncated SDK policy data instead of inventing an inventory',()=>{
  const bad=[
    '',
    '{"policies":',
    '[]',
    JSON.stringify({policies:{mode:'walk',enabled:true,slots:{}}}),
    JSON.stringify({policies:{mode:'walk',enabled:true,slots:[{slot:'walk',overridden:'false'}]}}),
    JSON.stringify({policies:{mode:'walk',enabled:true,slots:[]},skills:{skills:[{name:17}],built_in:[]}}),
    JSON.stringify({policies:{mode:'walk',enabled:true,slots:[]},skills:{skills:[],built_in:[null]}})
  ];
  for(const value of bad)assert.throws(()=>parsePolicyList(value),{status:502});
  const fallback=parsePolicyList(JSON.stringify({policies:{mode:'idle',enabled:false,slots:[],skills:['stand']},skills:null}));
  assert.deepEqual(fallback.skills,[{name:'stand',path:null,durationSeconds:null,overridden:false,kind:'listed_skill'}]);
  assert.deepEqual(fallback.builtIn,[]);
});
