import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assessSkillTrace } from './skill-telemetry.js';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const artifactName=/^skill-smoke-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const invalid=message=>Object.assign(new Error(message),{status:422});

export function verifySimulatorArtifact(artifact) {
  if(!artifact||typeof artifact!=='object'||Array.isArray(artifact))throw invalid('Invalid evidence envelope');
  const {recordSha256,...record}=artifact;
  if(!digest.test(recordSha256||'')||sha256(JSON.stringify(record))!==recordSha256)throw invalid('Evidence record hash mismatch');
  if(record.kind!=='simulator_skill_attempt'||record.origin!=='official_daemon_simulator'||record.skill!=='kick_left'||record.hardwareConnected!==false)throw invalid('Not the allowlisted simulator skill artifact');
  if(record.completionVerified!==false||record.performanceMeasured!==false||record.executionObserved!==true)throw invalid('Artifact contains an unsupported result claim');
  if(record.command?.state!=='queued_acknowledged'||record.command.reason!==null)throw invalid('Skill was not acknowledged by the SDK');
  if(record.policy?.source!=='pollen-robotics/microduck-policies'||record.policy.version!=='v5'||record.policy.filename!=='ball_kick_left.onnx'||!digest.test(record.policy.sha256||''))throw invalid('Policy provenance is unsupported');
  if(record.scene?.name!=='scene.xml'||!digest.test(record.scene.sha256||''))throw invalid('Scene provenance is unsupported');
  if(record.preflight?.healthy!==true||record.preflight.realtimeFactor<0.95||record.postflight?.healthy!==true||record.postflight.standing!==true||!Array.isArray(record.postflight.samples)||!record.postflight.samples.length||record.postflight.samples.some(sample=>sample.healthy!==true))throw invalid('Health checks did not stay clean');
  const telemetry=record.telemetry;
  if(telemetry?.source!=='robotctl monitor --hz 50 --json'||typeof telemetry.rawMonitorNdjson!=='string'||Buffer.byteLength(telemetry.rawMonitorNdjson)>1048576||!digest.test(telemetry.traceSha256||'')||sha256(telemetry.rawMonitorNdjson)!==telemetry.traceSha256)throw invalid('Raw SDK trace is missing or altered');
  if(!telemetry.rawMonitorNdjson.endsWith('\n')||telemetry.rawMonitorNdjson.includes('\r'))throw invalid('SDK trace framing is invalid');
  const lines=telemetry.rawMonitorNdjson.slice(0,-1).split('\n');
  if(lines.length!==telemetry.frameCount||lines.length>250||!Number.isInteger(telemetry.submittedAtIndex))throw invalid('SDK frame count or submission marker mismatch');
  let frames;
  try {frames=lines.map(line=>{
    const item=JSON.parse(line);
    if(item.method!=='robot.state'||!item.params||typeof item.params!=='object')throw new Error('Not a state frame');
    const frame=item.params;
    return {t:frame.t,policy:frame.policy,fallen:frame.safety?.fallen,hz:frame.loop?.hz,missed:frame.loop?.missed};
  });}catch{throw invalid('SDK trace contains an invalid state frame');}
  if(JSON.stringify(frames)!==JSON.stringify(telemetry.frames))throw invalid('Derived SDK frames differ from raw trace');
  const verdict=assessSkillTrace(frames,{skill:'kick_left',durationSeconds:0.5,submittedAtIndex:telemetry.submittedAtIndex});
  if(!verdict.executionObserved||telemetry.executionObserved!==true||telemetry.windowEndObserved!==true||telemetry.reason!==null||telemetry.observedSeconds!==verdict.observedSeconds||telemetry.firstSkillT!==verdict.firstSkillT||telemetry.lastSkillT!==verdict.lastSkillT)throw invalid('SDK trace does not support the stated verdict');
  const startedAt=Date.parse(record.startedAt),endedAt=Date.parse(record.endedAt);
  if(!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt<startedAt||endedAt-startedAt>30000)throw invalid('Evidence timestamps are invalid');
  const first=frames.findIndex(frame=>frame.policy==='kick_left');
  const after=frames.findIndex((frame,index)=>index>first&&frame.policy!=='kick_left');
  const seconds=index=>Number((frames[index].t-frames[0].t).toFixed(2));
  const timeline=[
    {phase:'ready',atSeconds:seconds(0)},
    {phase:'move_seen',atSeconds:seconds(first)},
    {phase:'move_ended',atSeconds:seconds(after)}
  ];
  return {recordSha256,traceSha256:telemetry.traceSha256,skill:'kick_left',origin:'official_daemon_simulator',verification:'telemetry_observed',attribution:'local_operator_assigned_unverified',startedAt:record.startedAt,endedAt:record.endedAt,observedSeconds:verdict.observedSeconds,frameCount:frames.length,timeline,policySha256:record.policy.sha256,sceneSha256:record.scene.sha256,hardwareConnected:false,completionVerified:false,performanceMeasured:false};
}

export async function loadSimulatorArtifact(evidenceDir,filename) {
  if(typeof filename!=='string'||!artifactName.test(filename))throw Object.assign(new Error('Invalid evidence filename'),{status:400});
  const file=path.join(evidenceDir,filename);
  const stat=await lstat(file).catch(error=>{if(error.code==='ENOENT')throw Object.assign(new Error('Evidence artifact not found'),{status:404});throw error;});
  if(!stat.isFile()||stat.size>1500000)throw invalid('Evidence must be a bounded regular file');
  let artifact;
  try{artifact=JSON.parse(await readFile(file,'utf8'));}catch{throw invalid('Evidence JSON is invalid');}
  return {...verifySimulatorArtifact(artifact),artifactFile:filename};
}
