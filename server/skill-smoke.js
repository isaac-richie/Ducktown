import { readFile, mkdir, rmdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulatorObserver } from './simulator.js';
import { parsePolicyList } from './policies.js';
import { captureSkillTelemetry } from './skill-telemetry.js';

const execFileAsync=promisify(execFile);
const sha256=data=>createHash('sha256').update(data).digest('hex');
const requireReading=async(observer,name)=>{
  const result=await observer.inspect(name);
  if(!result.configured||!result.ok)throw new Error(`${name} preflight failed: ${result.reason||'SDK unavailable'}`);
  return result.output;
};
const parseHealth=output=>{
  let health;
  try{health=JSON.parse(output);}catch{throw new Error('Official health output was not JSON');}
  if(health?.robot?.healthy!==true)throw new Error('Official daemon did not report a healthy robot');
  return {healthy:true,achievedHz:health.robot.control_loop?.achieved_hz??null,missedTicks:health.robot.control_loop?.missed??null};
};

// Standalone, fixed-scene SDK smoke test. This function is never called by the web server.
export async function runSkillSmoke({observer,root,state,rl,execute,collectTelemetry=null,load=readFile,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>new Date().toISOString()}) {
  const status=await requireReading(observer,'status');
  if(!/\bstanding\b/.test(status))throw new Error('Simulator did not report a standing duck');
  const healthBefore=parseHealth(await requireReading(observer,'health'));
  const policies=parsePolicyList(await requireReading(observer,'policies'));
  if(!policies.enabled||policies.mode!=='walk'||policies.homed!==true||policies.sitting!==false)throw new Error('Official policy is not in the expected driving state');
  const skill=policies.skills.find(item=>item.name==='kick_left'&&item.kind==='policy_skill');
  const expectedPolicy=path.join(state,'policies/current/ball_kick_left.onnx');
  if(!skill||skill.path!==expectedPolicy||!Number.isFinite(skill.durationSeconds)||skill.durationSeconds<=0||skill.durationSeconds>1)throw new Error('Official bounded kick_left policy was not reported at the expected path');
  const realtime=await requireReading(observer,'realtime');
  const factor=Number(realtime.match(/running at ([\d.]+)x real time/)?.[1]);
  if(!Number.isFinite(factor)||factor<0.95)throw new Error('Official simulator is below the safe realtime preflight threshold');
  const sceneFile=path.join(rl,'src/mjlab_microduck/robot/microduck/scene.xml');
  const [source,policyBytes,sceneBytes,bodyLog]=await Promise.all([
    load(path.join(state,'policies/current/.source'),'utf8'),load(expectedPolicy),load(sceneFile),load(path.join(state,'body.log'),'utf8')
  ]);
  if(!/^repo=pollen-robotics\/microduck-policies$/m.test(source)||!/^version=v5$/m.test(source))throw new Error('Policy source is not the official seeded v5 set');
  if(!/^== scene\.xml: 1 duck\(s\), starting at SIT$/m.test(bodyLog))throw new Error('Simulator did not report the fixed single-duck scene');
  const startedAt=now();
  let commandState='not_submitted',commandReason=null,telemetry=null;
  const submit=async()=>{
    try {
      const output=await execute(path.join(root,'scripts/duck-sim'),['ctl','robot','do','kick_left','--json'],{cwd:root,timeout:3000,maxBuffer:16384,encoding:'utf8',env:{...process.env,DUCK_SIM_STATE:state,DUCK_SIM_PORT:'17801',NO_COLOR:'1'}});
      const answer=JSON.parse(String(output.stdout||''));
      commandState=answer.accepted===true?'queued_acknowledged':'refused';
      commandReason=answer.reason??null;
    } catch(error) {
      commandState='unknown_after_error';
      commandReason=error.killed?'CLI timed out after submission; command outcome unknown':'CLI returned an error or malformed acknowledgement; command outcome unknown';
    }
    return {state:commandState,reason:commandReason};
  };
  try {
    if(collectTelemetry) {
      const capture=await collectTelemetry({root,state,port:'17801',skill:'kick_left',durationSeconds:skill.durationSeconds,submit});
      telemetry=capture.telemetry;
    } else await submit();
  } catch(error) {
    // The command may have been submitted before capture failed. Never retry it.
    telemetry={executionObserved:false,windowEndObserved:false,reason:`Telemetry capture failed: ${error.message}`};
  }
  await wait(Math.round(skill.durationSeconds*1000)+700);
  const readPostHealth=async()=>{try{return parseHealth(await requireReading(observer,'health'));}catch(error){return {healthy:false,reason:error.message};}};
  const healthSamples=[await readPostHealth()];
  // Retry only the read-only health check. Never replay an uncertain skill command.
  if(!healthSamples[0].healthy){await wait(700);healthSamples.push(await readPostHealth());}
  const healthAfter={...healthSamples.at(-1),samples:healthSamples};
  const finalStatus=await observer.inspect('status');
  healthAfter.standing=finalStatus.ok&&/\bstanding\b/.test(finalStatus.output||'');
  const executionObserved=commandState==='queued_acknowledged'&&telemetry?.executionObserved===true&&healthAfter.samples.every(sample=>sample.healthy)&&healthAfter.standing===true;
  return {kind:'simulator_skill_attempt',origin:'official_daemon_simulator',skill:'kick_left',scene:{name:'scene.xml',sha256:sha256(sceneBytes)},policy:{source:'pollen-robotics/microduck-policies',version:'v5',filename:'ball_kick_left.onnx',sha256:sha256(policyBytes)},preflight:{healthy:healthBefore.healthy,achievedHz:healthBefore.achievedHz,realtimeFactor:factor},command:{state:commandState,reason:commandReason},telemetry,executionObserved,postflight:healthAfter,startedAt,endedAt:now(),hardwareConnected:false,completionVerified:false,performanceMeasured:false};
}

export async function saveSkillAttempt(result,evidenceDir) {
  await mkdir(evidenceDir,{recursive:true,mode:0o700});
  const envelope={...result,recordSha256:sha256(JSON.stringify(result))};
  const evidenceFile=path.join(evidenceDir,`skill-smoke-${randomUUID()}.json`);
  await writeFile(evidenceFile,JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o600});
  return evidenceFile;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3||process.argv[2]!=='--execute')throw new Error('Pass --execute to run the fixed simulator-only kick_left smoke test');
  if(process.env.DUCK_SIM_STATE!=='/tmp/ducktown-sim-0927'||process.env.DUCK_SIM_PORT!=='17801'||process.env.DUCK_SIM_SCENE||process.env.DUCK_SIM_CAMERAS)throw new Error('This smoke test requires the isolated default scene at /tmp/ducktown-sim-0927 on port 17801, without cameras');
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const root=path.join(project,'work/microduck'),rl=path.join(project,'work/microduck_rl');
  const lockDir=path.join(process.env.DUCK_SIM_STATE,'.ducktown-skill-smoke.lock');
  await mkdir(lockDir);
  try {
    const result=await runSkillSmoke({observer:new SimulatorObserver({root}),root,state:process.env.DUCK_SIM_STATE,rl,execute:execFileAsync,collectTelemetry:captureSkillTelemetry});
    const evidenceFile=await saveSkillAttempt(result,path.join(project,'work/evidence'));
    console.log(JSON.stringify({evidenceFile,command:result.command,executionObserved:result.executionObserved,telemetryReason:result.telemetry?.reason,postflight:result.postflight,completionVerified:false}));
    if(!result.executionObserved)process.exitCode=1;
  } finally {await rmdir(lockDir);}
}
