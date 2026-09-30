import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulatorObserver } from './simulator.js';
import { runSkillSmoke, saveSkillAttempt } from './skill-smoke.js';
import { captureSkillTelemetry } from './skill-telemetry.js';
import { loadSimulatorArtifact } from './receipts.js';
import { importReceipt } from './import-receipt.js';
import { Store } from './store.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execFileAsync=promisify(execFile);
const handlePattern=/^[a-z][a-z0-9_]{2,23}$/;

async function requireLocalAccount(handle,dataFile) {
  const store=new Store(dataFile);
  try {await store.open();if(!store.userByHandle(handle))throw new Error('Create the exact Ducktown account before running this challenge');}
  catch(error){if(error.message.startsWith('Create the exact'))throw error;throw new Error('The local account store could not be read',{cause:error});}
  finally {store.close();}
}

async function requireLocalServer(baseUrl) {
  const url=new URL(baseUrl);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:')throw new Error('The challenge can only attach to a loopback Ducktown server');
  let response;
  try {response=await fetch(new URL('/api/v1/health',url),{signal:AbortSignal.timeout(3000)});}
  catch {throw new Error('Start the local Ducktown server before running this challenge');}
  const data=await response.json().catch(()=>null);
  if(!response.ok||data?.status!=='ok'||data.hardwareConnected!==false)throw new Error('The local Ducktown server did not pass its health check');
}

// An operator-only workflow. The browser cannot invoke the skill command.
// This measures only the SDK-observed policy window and return, never ball motion.
export async function runAndAttachChallenge({handle,dataFile=path.join(project,'data/ducktown.json'),evidenceDir=path.join(project,'work/evidence'),baseUrl=`http://127.0.0.1:${process.env.DUCKTOWN_PORT||8787}`,requireAccount=requireLocalAccount,requireServer=requireLocalServer,runAttempt,saveAttempt=saveSkillAttempt,validate=loadSimulatorArtifact,attach=importReceipt}) {
  if(typeof handle!=='string'||!handlePattern.test(handle))throw new Error('Specify an exact existing account handle');
  if(typeof runAttempt!=='function')throw new Error('A fixed simulator runner is required');
  await requireAccount(handle,dataFile);
  await requireServer(baseUrl);
  const attempt=await runAttempt();
  // Preserve failed/uncertain attempts privately for diagnosis. Never attach or publish them.
  const evidenceFile=await saveAttempt(attempt,evidenceDir);
  const artifactFile=path.basename(evidenceFile);
  if(!attempt.executionObserved)return {status:'not_observed',artifactFile,reason:attempt.telemetry?.reason||attempt.command?.reason||'The SDK did not show a clean return'};
  const verified=await validate(evidenceDir,artifactFile);
  if(verified.verification!=='telemetry_observed'||verified.completionVerified!==false||verified.performanceMeasured!==false)throw new Error('The saved trace does not support this challenge');
  const receipt=await attach({dataFile,baseUrl,handle,artifactFile});
  return {status:'private_receipt_ready',artifactFile,receiptId:receipt.id,observedSeconds:verified.observedSeconds,attribution:receipt.attribution,shared:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==5||process.argv[2]!=='--execute'||process.argv[3]!=='--handle')throw new Error('Usage: node server/run-challenge.js --execute --handle HANDLE');
  if(process.env.DUCK_SIM_STATE!=='/tmp/ducktown-sim-0927'||process.env.DUCK_SIM_PORT!=='17801'||process.env.DUCK_SIM_SCENE||process.env.DUCK_SIM_CAMERAS)throw new Error('This challenge requires the isolated default simulator scene, port 17801, and no cameras');
  const root=path.join(project,'work/microduck'),rl=path.join(project,'work/microduck_rl');
  const lockDir=path.join(process.env.DUCK_SIM_STATE,'.ducktown-skill-smoke.lock');
  const runAttempt=async()=>{
    await mkdir(lockDir);
    try {return await runSkillSmoke({observer:new SimulatorObserver({root}),root,state:process.env.DUCK_SIM_STATE,rl,execute:execFileAsync,collectTelemetry:captureSkillTelemetry});}
    finally {await rmdir(lockDir);}
  };
  const result=await runAndAttachChallenge({handle:process.argv[4],runAttempt});
  console.log(JSON.stringify(result));
  if(result.status!=='private_receipt_ready')process.exitCode=1;
}
