// Authored presentation poses in radians. These are not SDK joint commands.
// Each phrase has anticipation, a held gesture, and a quiet return to neutral.
// crouch/lift/reach are centimetres of presentation travel; lean/kick are radians; jaw opens 0-.34.
const rest={pitch:0,yaw:0,roll:0,neck:0,ball:0,crouch:0,lean:0,lift:0,reach:0,jaw:0};
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
