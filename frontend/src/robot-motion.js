// Authored presentation poses in radians. These are not SDK joint commands.
// Each phrase has anticipation, a held gesture, and a quiet return to neutral.
// crouch/lift/reach are centimetres of presentation travel (lift/reach = right foot, liftL/reachL = left);
// lean and tip (whole-body fall onto the back) are radians; jaw opens 0-.34.
// hipRoll rocks the whole body over the stance foot (radians) while the head counter-rotates to stay level.
const rest={pitch:0,yaw:0,roll:0,neck:0,ball:0,crouch:0,lean:0,lift:0,reach:0,liftL:0,reachL:0,tip:0,jaw:0,hipRoll:0};
const clips={
  idle:[[0,{}],[1.8,{}],[2.6,{yaw:.15}],[3.6,{yaw:.15}],[4.6,{}],[8,{}]],
  'polite-bow':[[0,{}],[.7,{pitch:-.06}],[1.5,{pitch:.32,neck:.12}],[2.5,{pitch:.32,neck:.12}],[3.5,{pitch:-.025}],[4.2,{}],[7,{}]],
  'hello-wave':[[0,{}],[.6,{pitch:-.07}],[1.2,{roll:.16,yaw:.1}],[1.8,{roll:-.1,yaw:.1}],[2.4,{roll:.12,yaw:.1}],[3.3,{}],[6,{}]],
  'duck-spot':[[0,{}],[1,{yaw:-.34}],[2.1,{yaw:-.34}],[3.1,{yaw:.34}],[4.4,{yaw:.34,pitch:-.04}],[5.5,{}],[7,{}]],
  'balance-back':[[0,{}],[1,{}],[1.25,{roll:.14,neck:-.07}],[1.8,{roll:-.07,neck:.03}],[2.4,{roll:.025}],[3,{}],[6,{}]],
  'tiny-dance':[[0,{}],[.5,{pitch:-.05}],[1,{roll:.12,yaw:.12}],[1.5,{roll:-.12,yaw:-.12}],[2,{roll:.12,yaw:.12,neck:.035}],[2.5,{roll:-.12,yaw:-.12}],[3.2,{}],[5,{}]],
  'sit-stand':[[0,{}],[.6,{crouch:-.3,pitch:-.05}],[1.6,{crouch:3.4,lean:.22,pitch:-.18}],[3.4,{crouch:3.4,lean:.22,pitch:-.18}],[3.9,{crouch:3.5,lean:.24,pitch:-.12,jaw:.18}],[4.4,{crouch:3.4,lean:.22,pitch:-.18}],[5.4,{crouch:-.25,lean:-.03,pitch:.04}],[6,{}],[7,{}]],
  kick:[[0,{}],[.6,{crouch:.6,roll:-.05}],[1.1,{crouch:.6,roll:-.08,lift:1.2,reach:-1.6,lean:-.06}],[1.32,{crouch:.4,roll:-.08,lift:1.6,reach:3,lean:.1,pitch:.12,jaw:.25}],[1.7,{crouch:.6,roll:-.06,lift:.9,reach:1.2,pitch:.06}],[2.3,{crouch:.5,roll:-.02}],[2.8,{}],[5,{}]],
  grab:[[0,{}],[.7,{pitch:.1,crouch:.4}],[1.8,{crouch:3.1,lean:.3,pitch:.34,neck:.2,jaw:.34}],[2.4,{crouch:3.1,lean:.3,pitch:.34,neck:.2,jaw:.34}],[2.7,{crouch:3.1,lean:.3,pitch:.34,neck:.2}],[3.5,{crouch:-.4,lean:-.04,pitch:-.12,jaw:0}],[4,{pitch:.02}],[4.5,{}],[6,{}]],
  // Sit back, roll onto the shell, tuck the legs, rock, and swing up into a crouch.
  'get-up':[[0,{}],[.6,{crouch:.6,pitch:.1}],[1.6,{tip:1.5,crouch:1.2,pitch:-.2}],[2,{tip:1.42,crouch:1}],[3.2,{tip:1.42,crouch:1,pitch:-.1,jaw:.2}],[3.9,{tip:1.42,crouch:3.4}],[4.5,{tip:1.58,crouch:3.4,pitch:-.25}],[5.4,{tip:.05,crouch:3.4,lean:.32,pitch:.25}],[6,{crouch:3.2,lean:.28,pitch:.2}],[7,{crouch:-.2,pitch:-.05}],[7.6,{}],[9,{}]],
  waddle:[[0,{}],[.4,{roll:.08,crouch:.3}],[.8,{roll:.08,crouch:.3,lift:1.4,reach:.6,yaw:.05}],[1.2,{roll:.02,crouch:.3}],[1.6,{roll:-.08,crouch:.3}],[2,{roll:-.08,crouch:.3,liftL:1.4,reachL:.6,yaw:-.05}],[2.4,{roll:-.02,crouch:.3}],[2.8,{roll:.08,crouch:.3}],[3.2,{roll:.08,crouch:.3,lift:1.4,reach:.6,yaw:.05}],[3.6,{crouch:.3}],[4,{roll:-.08,crouch:.3,liftL:1.4,reachL:.6,yaw:-.05}],[4.4,{crouch:.3}],[4.8,{}]],
  'ball-follow':[[0,{pitch:.1}],[.8,{pitch:.1}],[2.4,{ball:7,yaw:.34,pitch:.1}],[3.2,{ball:7,yaw:.34,pitch:.1}],[5.2,{ball:-7,yaw:-.34,pitch:.1}],[6,{ball:-7,yaw:-.34,pitch:.1}],[7.5,{pitch:.1}],[8,{pitch:.1}]]
};
export function sampleMotion(name,time){
  const clip=clips[name]||clips.idle;
  const duration=clip.at(-1)[0],t=((time%duration)+duration)%duration;
  const end=clip.findIndex(([at])=>at>t),a=clip[Math.max(0,end-1)],b=clip[end];
  const x=(t-a[0])/(b[0]-a[0]),ease=x*x*x*(x*(x*6-15)+10);
  return Object.fromEntries(Object.keys(rest).map(key=>[key,(a[1][key]||0)+((b[1][key]||0)-(a[1][key]||0))*ease]));
}

// Two-link leg solve in the rig's y/z plane so feet stay planted while the body crouches.
// Rotation about x is complex multiplication on y+iz; rest pose returns all zeros.
const thigh=[-3.65,-1.4],shin=[-4.5,1.4],L1=Math.hypot(...thigh),L2=Math.hypot(...shin);
const arg=v=>Math.atan2(v[1],v[0]),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function solveLeg(y,z){
  const target=[y,z],d=Math.min(Math.hypot(y,z),L1+L2-1e-4);
  const alpha=Math.acos(Math.max(-1,Math.min(1,(L1*L1+d*d-L2*L2)/(2*L1*d))));
  const hip=wrap(arg(target)+alpha-arg(thigh));
  const knee=[L1*Math.cos(arg(thigh)+hip),L1*Math.sin(arg(thigh)+hip)];
  const total=wrap(arg([target[0]-knee[0],target[1]-knee[1]])-arg(shin));
  return {hip,knee:wrap(total-hip),foot:-total};
}
export const ANKLE_REST=thigh[0]+shin[0];

// Procedural mech-style run: each foot slides back flat on the ground (stance), then lifts and swings
// forward (swing), half a cycle apart. Feet move at a constant speed during stance so a floor scrolling
// at stanceSpeed() keeps them visually planted.
const smooth=x=>x*x*(3-2*x);
function footCycle(q,stride,height){
  if(q<.5)return {reach:stride*(1-4*q),lift:0};
  const s=(q-.5)/.5;
  return {reach:-stride+2*stride*smooth(s),lift:height*Math.sin(Math.PI*s)};
}
// Battle: a stylised mech run (long strides, high knees, deep crouch). Not a real Microduck gait.
export const GAIT={stride:2.2,height:1.7,crouch:1.9,lean:.2,cadence:1.55,roll:.07,yaw:.09,bob:.35,nod:.04,hipRoll:0};
// Real walk: closer to the trained Microduck walk as filmed: short quick shuffle steps, feet barely
// lifting, an upright body rocking over each stance foot, and a steady head. Still hand-authored.
export const REAL_GAIT={stride:.9,height:.5,crouch:.15,lean:.04,cadence:2.2,roll:0,yaw:0,bob:.12,nod:0,hipRoll:.055};
// turn = signed curvature × half hip width: on a curve the outer foot needs a longer stride and the
// inner foot a shorter one, or the planted foot skids as the body rotates over it.
export function sampleGait(phase,{stride,height,crouch,lean,roll,yaw,bob,nod,hipRoll}=GAIT,turn=0){
  const p=((phase%1)+1)%1,w=Math.PI*2*p;
  const right=footCycle(p,stride*(1-turn),height),left=footCycle((p+.5)%1,stride*(1+turn),height);
  return {...rest,crouch:crouch+bob*Math.abs(Math.sin(w)),lean,roll:roll*Math.sin(w),yaw:yaw*Math.sin(w),
    pitch:nod*Math.abs(Math.cos(w)),hipRoll:-hipRoll*Math.sin(w),lift:right.lift,reach:right.reach,liftL:left.lift,reachL:left.reach};
}
// cm/s the stance foot travels backward; the floor scrolls at this speed.
export const stanceSpeed=({stride,cadence}=GAIT)=>4*stride*cadence;
