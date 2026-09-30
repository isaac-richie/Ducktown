import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execFileAsync=promisify(execFile);
const commands={
  status:['status'],
  health:['ctl','health','--json'],
  policies:['ctl','policy','list','--json'],
  version:['ctl','version'],
  realtime:['realtime']
};
const executable=async file=>{try{await access(file,constants.X_OK);return true;}catch{return false;}};
const runProcess=(file,args,options)=>execFileAsync(file,args,options);

export class SimulatorObserver {
  constructor({root=process.env.DUCKTOWN_MICRODUCK_ROOT,checkExecutable=executable,runner=runProcess}={}) {
    this.root=root ? path.resolve(root) : null;
    this.checkExecutable=checkExecutable;
    this.runner=runner;
  }
  async inspect(command) {
    if(!Object.hasOwn(commands,command)) throw Object.assign(new Error('Unsupported simulator check'),{status:404});
    const checkedAt=new Date().toISOString();
    const base={source:'configured_duck_sim_cli',command,checkedAt,hardwareConnected:false,verifiedRun:false};
    if(!this.root) return {...base,configured:false,ok:false,reason:'Set DUCKTOWN_MICRODUCK_ROOT to an official microduck checkout; restart Ducktown.'};
    const script=path.join(this.root,'scripts','duck-sim');
    if(!(await this.checkExecutable(script))) return {...base,configured:false,ok:false,reason:'Official scripts/duck-sim was not found or is not executable at the configured path.'};
    try {
      const result=await this.runner(script,commands[command],{cwd:this.root,timeout:8000,maxBuffer:65536,encoding:'utf8',env:{...process.env,NO_COLOR:'1'}});
      const output=String(result.stdout||'').trim().slice(0,65536);
      // duck-sim's status/realtime wrappers can return exit 0 after a caught
      // connection failure. Empty stdout is never a valid SDK observation.
      if(!output)return {...base,configured:true,ok:false,exitCode:0,reason:'Official simulator returned no output',output:String(result.stderr||'').trim().slice(0,4096)};
      if(command==='status' && /^robot[ \t]+unavailable\b/m.test(output)) return {...base,configured:true,ok:false,exitCode:0,reason:'Official status could not reach robotd',output:output.slice(0,4096)};
      if(command==='version' && /^\s*robotd\s+unavailable\b/m.test(output)) return {...base,configured:true,ok:false,exitCode:0,reason:'Official version check could not reach robotd',output:output.slice(0,4096)};
      return {...base,configured:true,ok:true,exitCode:0,output};
    } catch(error) {
      return {...base,configured:true,ok:false,exitCode:Number.isInteger(error.code)?error.code:null,reason:error.killed?'Check timed out':'Official simulator check failed',output:String(error.stdout||error.stderr||'').trim().slice(0,4096)};
    }
  }
  async snapshot() {
    const names=['status','health','policies','version','realtime'];
    const readings=[];
    for(const name of names) {
      const reading=await this.inspect(name);
      if(!reading.configured || !reading.ok) return {ready:false,reason:reading.reason||`${name} did not complete successfully`,failedCheck:name,readings};
      readings.push(reading);
    }
    const byName=Object.fromEntries(readings.map(item=>[item.command,item]));
    const digest=value=>createHash('sha256').update(value).digest('hex');
    return {ready:true,observation:{type:'sdk_observation',source:'configured_duck_sim_cli',verification:'unverified',isRun:false,hardwareConnected:false,observedAt:new Date().toISOString(),
      policyListOutput:byName.policies.output.slice(0,16384),versionOutput:byName.version.output.slice(0,4096),
      checks:Object.fromEntries(readings.map(item=>[item.command,{ok:item.ok,outputSha256:digest(item.output),checkedAt:item.checkedAt}]))}};
  }
}
