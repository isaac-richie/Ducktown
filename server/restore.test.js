import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { rehearseRestore } from './rehearse-restore.js';

test('restore rehearsal boots a copied backup and rejects a damaged backup',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-restore-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new Store(path.join(folder,'live.sqlite'));
  await store.open();
  const user=await store.createUser('restore_duck','test-hash');
  await store.createPost({text:'A real note',robotId:user.robotId},user);
  const backup=path.join(folder,'backup.sqlite');
  await store.backup(backup);
  store.close();
  assert.deepEqual(await rehearseRestore(backup),{integrity:'ok',api:'ok',accounts:1,visiblePosts:1,privateReceipts:0});
  const damaged=path.join(folder,'damaged.sqlite');
  await writeFile(damaged,'not a SQLite database');
  await assert.rejects(rehearseRestore(damaged));
  assert.deepEqual(await rehearseRestore(backup),{integrity:'ok',api:'ok',accounts:1,visiblePosts:1,privateReceipts:0});
});

test('concurrent account writes stay isolated and over-limit requests do not create posts',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-concurrent-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const app=await createApp({dataFile:path.join(folder,'town.json')});
  app.server.listen(0,'127.0.0.1');
  await new Promise(resolve=>app.server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const register=async(handle)=>{
    const response=await fetch(`${base}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle,password:`very-long-${handle}-password`})});
    assert.equal(response.status,201);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const [one,two]=[await register('load_one'),await register('load_two')];
  const burst=async(cookie,prefix)=>Promise.all(Array.from({length:20},(_,index)=>fetch(`${base}/api/v1/posts`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({text:`${prefix} ${index}`})})));
  const [first,second]=await Promise.all([burst(one,'One'),burst(two,'Two')]);
  for(const group of [first,second]){
    assert.equal(group.filter(response=>response.status===201).length,6);
    assert.equal(group.filter(response=>response.status===429).length,14);
    assert.ok(group.every(response=>[201,429].includes(response.status)));
  }
  const reads=await Promise.all(Array.from({length:30},()=>fetch(`${base}/api/v1/posts`)));
  assert.ok(reads.every(response=>response.status===200));
  const feed=await (await fetch(`${base}/api/v1/posts`)).json();
  assert.equal(feed.posts.length,12);
  assert.equal(new Set(feed.posts.map(post=>post.id)).size,12);
});
