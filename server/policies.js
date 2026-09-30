const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const optionalString=value=>value===null || value===undefined || typeof value==='string';

// The shape comes from robotctl's PolicyCommand::List { json } and
// duck-ipc-proto::{PoliciesResult, SkillsResult}; no table scraping.
export function parsePolicyList(output) {
  let body;
  try {body=JSON.parse(output);}catch{throw Object.assign(new Error('Official policy list was not valid JSON'),{status:502});}
  const policies=body?.policies,details=body?.skills;
  if(!object(policies)||typeof policies.mode!=='string'||typeof policies.enabled!=='boolean'||!Array.isArray(policies.slots)) throw Object.assign(new Error('Official policy list JSON has an unsupported shape'),{status:502});
  const slots=policies.slots.map(slot=>{
    if(!object(slot)||typeof slot.slot!=='string'||!optionalString(slot.path)||!optionalString(slot.origin)||typeof slot.overridden!=='boolean'||!optionalString(slot.error)) throw Object.assign(new Error('Official policy slot has an unsupported shape'),{status:502});
    return {slot:slot.slot,path:slot.path??null,origin:slot.origin??null,overridden:slot.overridden,error:slot.error??null};
  });
  let skills=[],builtIn=[],detailsAvailable=false;
  if(details!==null && details!==undefined) {
    if(!object(details)||!Array.isArray(details.skills)||!Array.isArray(details.built_in??[])) throw Object.assign(new Error('Official skill list has an unsupported shape'),{status:502});
    skills=details.skills.map(skill=>{
      if(!object(skill)||typeof skill.name!=='string'||!optionalString(skill.path)||(skill.duration!==null && skill.duration!==undefined && (typeof skill.duration!=='number'||!Number.isFinite(skill.duration)))||(skill.overridden!==undefined&&typeof skill.overridden!=='boolean')) throw Object.assign(new Error('Official skill entry has an unsupported shape'),{status:502});
      return {name:skill.name,path:skill.path??null,durationSeconds:skill.duration??null,overridden:skill.overridden??false,kind:'policy_skill'};
    });
    if(!(details.built_in??[]).every(name=>typeof name==='string')) throw Object.assign(new Error('Official built-in skill list has an unsupported shape'),{status:502});
    builtIn=(details.built_in??[]).map(name=>({name,kind:'daemon_built_in'}));
    detailsAvailable=true;
  } else if(Array.isArray(policies.skills)) {
    skills=policies.skills.filter(name=>typeof name==='string').map(name=>({name,path:null,durationSeconds:null,overridden:false,kind:'listed_skill'}));
  }
  return {mode:policies.mode,enabled:policies.enabled,homed:typeof policies.homed==='boolean'?policies.homed:null,sitting:typeof policies.sitting==='boolean'?policies.sitting:null,slots,skills,builtIn,detailsAvailable};
}
