import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';

const MAX_FRAMES=250;
const MAX_GAP_SECONDS=0.08;
const MAX_DURATION_SECONDS=3;

export function assessSkillTrace(frames,{skill='kick_left',durationSeconds=0.5,submittedAtIndex=0,streamError=null}={}) {
  const fail=reason=>({executionObserved:false,windowEndObserved:false,reason});
  if(streamError)return fail(streamError);
  if(frames.length<8)return fail('Too few SDK state frames');
  if(submittedAtIndex<3||submittedAtIndex>=frames.length)return fail('No stable pre-command baseline');
  if(frames.slice(0,submittedAtIndex).some(frame=>!['stand','walk'].includes(frame.policy)))return fail('Another action occupied the baseline');
  const active=[];
  for(let index=0;index<frames.length;index++) {
    const frame=frames[index],previous=frames[index-1];
    if(!Number.isFinite(frame.t)||!Number.isFinite(frame.hz)||frame.hz<45||frame.fallen!==false)return fail('Unhealthy or malformed SDK state frame');
    if(!Number.isInteger(frame.missed)||frame.missed<0)return fail('Missing control-loop tick counter');
    if(previous) {
      const gap=frame.t-previous.t;
      if(gap<=0||gap>MAX_GAP_SECONDS)return fail('Telemetry gap or reordered frames');
      if(frame.missed!==previous.missed)return fail('Control-loop ticks were missed during capture');
    }
    if(frame.policy===skill)active.push(index);
  }
  if(active.length<Math.ceil(durationSeconds*25))return fail('Skill policy was not sampled densely enough');
  const first=active[0],last=active.at(-1);
  if(first<submittedAtIndex)return fail('Skill was already active before command submission');
  if(frames.slice(first,last+1).some(frame=>frame.policy!==skill))return fail('Skill segment was interrupted or repeated');
  if(frames.slice(last+1).length<3||frames.slice(last+1).some(frame=>!['stand','walk'].includes(frame.policy)))return fail('No stable return to standing or walking policy');
  if(frames.slice(submittedAtIndex,first).some(frame=>!['stand','walk'].includes(frame.policy)))return fail('Competing action before the skill');
  const observedSeconds=frames[last].t-frames[first].t;
  if(observedSeconds<durationSeconds*0.7||observedSeconds>durationSeconds+0.3)return fail('Observed skill window has implausible duration');
  return {executionObserved:true,windowEndObserved:true,reason:null,observedSeconds:Number(observedSeconds.toFixed(3)),firstSkillT:frames[first].t,lastSkillT:frames[last].t};
}

// Local SDK CLI only. It subscribes before invoking one fixed simulator command.
// The returned trace is an observation, never a Pollen-signed completion event.
export async function captureSkillTelemetry({root,state,port='17801',skill='kick_left',durationSeconds=0.5,submit,spawnProcess=spawn}) {
  // Call the official robotctl binary directly with the same socket arguments as
  // duck-sim's ctl wrapper, so terminating capture cannot orphan a shell child.
  const cli=path.join(root,'target/debug/robotctl');
  const child=spawnProcess(cli,[
    '--robot-socket',path.join(state,'duck-a.sock'),
    '--tof-socket',path.join(state,'duck-a-tof.sock'),
    '--config-socket',path.join(state,'duck-a-config.sock'),
    '--socket',path.join(state,'duck-a-updater.sock'),
    'monitor','--hz','50','--json'
  ],{
    cwd:root,env:{...process.env,DUCK_SIM_STATE:state,DUCK_SIM_PORT:port,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']
  });
  const frames=[],rawLines=[],digest=createHash('sha256');
  let rawBytes=0;
  let streamError=null,closed=false,submittedAtIndex=0,command=null;
  const stop=()=>{if(!closed)child.kill('SIGTERM');};
  child.on('error',error=>{streamError=`Monitor could not start: ${error.message}`;closed=true;});
  child.on('close',()=>{closed=true;});
  child.stderr.on('data',()=>{}); // Drain diagnostics; never treat stderr as state evidence.
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    if(streamError)return;
    const lineBytes=Buffer.byteLength(line)+1;
    if(lineBytes>8192||rawBytes+lineBytes>1048576||frames.length>=MAX_FRAMES){streamError='Monitor output exceeded its bounded capture';stop();return;}
    let item;
    try{item=JSON.parse(line);}catch{streamError='Malformed SDK monitor JSON';stop();return;}
    if(item?.method!=='robot.state'||!item.params||typeof item.params!=='object'){
      streamError='Unexpected SDK monitor message';stop();return;
    }
    const stateFrame=item.params;
    rawBytes+=lineBytes;
    rawLines.push(line);
    digest.update(line).update('\n');
    frames.push({t:stateFrame.t,policy:stateFrame.policy,fallen:stateFrame.safety?.fallen,
      hz:stateFrame.loop?.hz,missed:stateFrame.loop?.missed});
  });
  const until=async(predicate,timeoutMs)=>{
    const deadline=Date.now()+timeoutMs;
    while(!predicate()&&!streamError&&!closed&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    return predicate();
  };
  try {
    if(!(await until(()=>frames.length>=3,1800)))return {command:null,telemetry:{...assessSkillTrace(frames,{streamError:streamError||'No pre-command telemetry baseline'}),frameCount:frames.length}};
    submittedAtIndex=frames.length;
    command=await submit();
    if(command.state==='queued_acknowledged') {
      await until(()=>{
        const last=frames.findLastIndex(frame=>frame.policy===skill);
        return last>=submittedAtIndex&&frames.length-last-1>=3;
      },Math.min(MAX_DURATION_SECONDS*1000,Math.round((durationSeconds+2)*1000)));
    }
    const assessment=assessSkillTrace(frames,{skill,durationSeconds,submittedAtIndex,streamError:streamError||(!closed?null:'Monitor closed early')});
    return {command,telemetry:{...assessment,source:'robotctl monitor --hz 50 --json',frameCount:frames.length,
      submittedAtIndex,traceSha256:digest.digest('hex'),rawMonitorNdjson:rawLines.join('\n')+'\n',frames}};
  } finally {stop();lines.close();}
}
