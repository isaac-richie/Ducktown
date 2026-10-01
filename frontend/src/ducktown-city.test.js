import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCity, ORBIT_CLEAR, PLAZA_RADIUS } from './ducktown-city.js';

test('the city never stands between the orbiting camera and the duck',()=>{
  for(const detail of [1,.5]){
    const {buildings,props}=layoutCity({detail});
    for(const b of buildings){
      const nearest=Math.hypot(b.x,b.z)-Math.hypot(b.width,b.depth)/2;
      assert.ok(nearest>PLAZA_RADIUS,`building reaches into the square at ${nearest.toFixed(1)}`);
    }
    for(const p of props)assert.ok(Math.hypot(p.x,p.z)>ORBIT_CLEAR,'prop inside the camera orbit');
  }
});

test('buildings in the same row do not overlap, and phones get a lighter city',()=>{
  const {buildings}=layoutCity();
  for(const ring of [0,1,2]){
    const row=buildings.filter(b=>b.ring===ring);
    for(let i=0;i<row.length;i++){
      const a=row[i],b=row[(i+1)%row.length];
      assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>(a.width+b.width)/2-.01,`ring ${ring} buildings ${i} overlap`);
    }
  }
  assert.ok(layoutCity({detail:.5}).buildings.length<buildings.length*.8);
  assert.deepEqual(layoutCity(),layoutCity(),'layout should be stable between visits');
});
