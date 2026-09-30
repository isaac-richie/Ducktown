import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from './app.js';
import { Store } from './store.js';

async function listen(app){
  app.server.listen(0,'127.0.0.1');
  await new Promise(resolve=>app.server.once('listening',resolve));
  return `http://127.0.0.1:${app.server.address().port}`;
}
const close=app=>new Promise(resolve=>app.server.close(resolve));
function withHost(base,route,{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const request=http.request(new URL(route,base),{method,headers},response=>{
      let content='';response.setEncoding('utf8');response.on('data',chunk=>{content+=chunk;});response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:content}));
    });
    request.on('error',reject);
    request.end(body);
  });
}

test('public-origin mode requires the exact HTTPS origin and sets Secure cookies',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-public-origin-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dataFile=path.join(folder,'town.json');
  await assert.rejects(createApp({dataFile,publicOrigin:'http://ducktown.example'}),/HTTPS origin/);
  await assert.rejects(createApp({dataFile,publicOrigin:'https://ducktown.example/path'}),/HTTPS origin/);
  const app=await createApp({dataFile,publicOrigin:'https://ducktown.example'});
  const base=await listen(app);
  t.after(()=>close(app));
  const route='/api/v1/auth/register';
  const body=JSON.stringify({handle:'secure_duck',password:'secure-long-password'});
  const headers={Host:'ducktown.example','Content-Type':'application/json'};
  assert.equal((await fetch(`${base}/api/v1/health`)).status,200,'the local operator health probe remains usable');
  assert.equal((await withHost(base,route,{method:'POST',headers,body})).status,403,'missing Origin must fail');
  assert.equal((await withHost(base,route,{method:'POST',headers:{...headers,Origin:'http://ducktown.example'},body})).status,403);
  assert.equal((await withHost(base,route,{method:'POST',headers:{...headers,Origin:'https://wrong.example'},body})).status,403);
  assert.equal((await withHost(base,route,{method:'POST',headers:{...headers,Host:'wrong.example',Origin:'https://ducktown.example'},body})).status,403);
  const registration=await withHost(base,route,{method:'POST',headers:{...headers,Origin:'https://ducktown.example'},body});
  assert.equal(registration.status,201,registration.body);
  assert.equal(registration.headers['strict-transport-security'],'max-age=31536000');
  assert.match(registration.headers['set-cookie'][0],/HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure/);
  const cookie=registration.headers['set-cookie'][0].split(';')[0];
  assert.equal((await withHost(base,'/api/v1/auth/me',{headers:{Host:'ducktown.example',Cookie:cookie}})).status,200);
  assert.equal((await withHost(base,'/api/v1/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie},body:'{}'})).status,403);
  assert.equal((await withHost(base,'/api/v1/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie,Origin:'https://ducktown.example'},body:'{}'})).status,200);
  const token=(await readFile(`${dataFile}.operator-token`,'utf8')).trim();
  assert.equal((await fetch(`${base}/api/v1/operator/reports`,{headers:{Authorization:`Bearer ${token}`}})).status,200,'operator CLI remains direct-loopback only');
  assert.equal((await withHost(base,'/api/v1/operator/reports',{headers:{Authorization:`Bearer ${token}`,Host:'ducktown.example'}})).status,403,'proxy-hosted operator request is forbidden');
});

test('write limits are transactional and survive restart; oversized JSON returns 413',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-write-limits-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dataFile=path.join(folder,'town.json');
  const a=new Store(dataFile),b=new Store(dataFile);
  await a.open();await b.open();
  assert.deepEqual(a.consumeRateLimit('test','same',2,1000,10000),{allowed:true});
  assert.deepEqual(b.consumeRateLimit('test','same',2,1000,10000),{allowed:true});
  assert.deepEqual(a.consumeRateLimit('test','same',2,1000,10000),{allowed:false,retryAfter:1});
  assert.deepEqual(b.consumeRateLimit('test','same',2,1000,11001),{allowed:true});
  a.close();b.close();
  let app=await createApp({dataFile});
  let base=await listen(app);
  const request=(route,body,cookie)=>fetch(`${base}${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const registration=await request('/api/v1/auth/register',{handle:'limited_duck',password:'long-limited-password'});
  assert.equal(registration.status,201);
  const cookie=registration.headers.get('set-cookie').split(';')[0];
  for(let n=0;n<6;n++)assert.equal((await request('/api/v1/posts',{text:`Note ${n}`},cookie)).status,201);
  const limited=await request('/api/v1/posts',{text:'One too many'},cookie);
  assert.equal(limited.status,429);
  assert.ok(Number(limited.headers.get('retry-after'))>0);
  await close(app);
  app=await createApp({dataFile});base=await listen(app);
  t.after(()=>close(app));
  assert.equal((await request('/api/v1/posts',{text:'Still limited'},cookie)).status,429);
  assert.equal((await fetch(`${base}/api/v1/posts`)).status,200,'read-only browsing remains available');
  const oversized=await fetch(`${base}/api/v1/posts`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({text:'x'.repeat(9000)})});
  assert.equal(oversized.status,413);
  assert.equal((await oversized.json()).error,'Body too large');
});

test('online backup restores account state and rate limits into a separate database',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-backup-restore-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const live=new Store(path.join(folder,'live.sqlite'));
  await live.open();
  await live.createUser('backup_duck','test-password-hash');
  assert.equal(live.consumeRateLimit('report-user','backup-user',1,60_000).allowed,true);
  const backup=path.join(folder,'restored.sqlite');
  await live.backup(backup);
  live.close();
  const restored=new Store(backup);
  await restored.open();
  try {
    assert.equal(restored.db.pragma('integrity_check',{simple:true}),'ok');
    assert.equal(restored.userByHandle('backup_duck').handle,'backup_duck');
    assert.equal(restored.consumeRateLimit('report-user','backup-user',1,60_000).allowed,false);
  } finally {restored.close();}
});
