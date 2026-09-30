import { copyFile, lstat, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createApp } from './app.js';

// Rehearses a restore without replacing or opening the live database for writes.
export async function rehearseRestore(backupPath){
  const source=path.resolve(backupPath);
  const sourceStat=await lstat(source);
  if(!sourceStat.isFile()||sourceStat.size===0||path.extname(source)!=='.sqlite')throw new Error('Choose a nonempty, regular .sqlite backup file');
  const live=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/ducktown.json.sqlite');
  if(source===live)throw new Error('Choose a backup, not the live Ducktown database');
  for(const suffix of ['-wal','-shm']){
    const sidecar=await stat(`${source}${suffix}`).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(sidecar?.size&&suffix==='-wal')throw new Error('Backup has an active WAL sidecar; use an online backup before rehearsing a standalone restore');
  }
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-restore-'));
  const restoredPath=path.join(folder,'restored.sqlite');
  let app;
  try {
    await copyFile(source,restoredPath);
    const db=new Database(restoredPath,{readonly:true,fileMustExist:true});
    let expected;
    try {
      if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Backup failed SQLite integrity_check');
      const record=db.prepare('SELECT document FROM app_state WHERE id=1').get();
      if(!record)throw new Error('Backup has no Ducktown state');
      expected=JSON.parse(record.document);
      if(!Array.isArray(expected.users)||!Array.isArray(expected.robots)||!Array.isArray(expected.posts)||!Array.isArray(expected.receipts))throw new Error('Backup has incomplete Ducktown state');
      for(const user of expected.users){
        if(!expected.robots.some(robot=>robot.id===user.robotId&&robot.ownerId===user.id))throw new Error('Backup has an account without its duck profile');
      }
    } finally {db.close();}
    app=await createApp({dataFile:restoredPath,publicOrigin:null});
    app.server.listen(0,'127.0.0.1');
    await new Promise(resolve=>app.server.once('listening',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const [health,posts,anonymous]=await Promise.all([
      fetch(`${base}/api/v1/health`),fetch(`${base}/api/v1/posts`),fetch(`${base}/api/v1/auth/me`)
    ]);
    if(!health.ok||!posts.ok||!anonymous.ok)throw new Error('Restored app did not answer its API checks');
    const [healthBody,postsBody,anonymousBody]=await Promise.all([health.json(),posts.json(),anonymous.json()]);
    const visiblePosts=expected.posts.filter(post=>!post.hidden).length;
    if(healthBody.status!=='ok'||healthBody.hardwareConnected!==false||postsBody.posts?.length!==visiblePosts||anonymousBody.user!==null)throw new Error('Restored app did not match the backup state');
    return {integrity:'ok',api:'ok',accounts:expected.users.length,visiblePosts,privateReceipts:expected.receipts.length};
  } finally {
    if(app?.server.listening)await new Promise(resolve=>app.server.close(resolve));
    else app?.store.close();
    await rm(folder,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw new Error('Usage: node server/rehearse-restore.js BACKUP.sqlite');
  const result=await rehearseRestore(process.argv[2]);
  console.log(JSON.stringify(result));
}
