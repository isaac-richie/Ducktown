import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { SimulatorObserver } from '../server/simulator.js';

const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-browser-'));
let app;
try {
  app=await createApp({dataFile:path.join(folder,'town.json'),publicOrigin:null,simulator:new SimulatorObserver({root:null})});
  app.server.listen(8790,'127.0.0.1');
  await new Promise((resolve,reject)=>{app.server.once('listening',resolve);app.server.once('error',reject);});
  console.log('Ducktown isolated browser test server: http://127.0.0.1:8790/');
} catch(error) {app?.store.close();await rm(folder,{recursive:true,force:true});throw error;}

let closing=false;
async function stop(){
  if(closing)return;closing=true;
  await new Promise(resolve=>app.server.close(resolve));
  await rm(folder,{recursive:true,force:true});
  process.exit(0);
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
