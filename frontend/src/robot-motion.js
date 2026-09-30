// Authored presentation poses in radians. These are not SDK joint commands.
// Each phrase has anticipation, a held gesture, and a quiet return to neutral.
const rest={pitch:0,yaw:0,roll:0,neck:0,ball:0};
const clips={
  idle:[[0,{}],[1.8,{}],[2.6,{yaw:.15}],[3.6,{yaw:.15}],[4.6,{}],[8,{}]],
  'polite-bow':[[0,{}],[.7,{pitch:-.06}],[1.5,{pitch:.32,neck:.12}],[2.5,{pitch:.32,neck:.12}],[3.5,{pitch:-.025}],[4.2,{}],[7,{}]],
  'hello-wave':[[0,{}],[.6,{pitch:-.07}],[1.2,{roll:.16,yaw:.1}],[1.8,{roll:-.1,yaw:.1}],[2.4,{roll:.12,yaw:.1}],[3.3,{}],[6,{}]],
  'duck-spot':[[0,{}],[1,{yaw:-.34}],[2.1,{yaw:-.34}],[3.1,{yaw:.34}],[4.4,{yaw:.34,pitch:-.04}],[5.5,{}],[7,{}]],
  'balance-back':[[0,{}],[1,{}],[1.25,{roll:.14,neck:-.07}],[1.8,{roll:-.07,neck:.03}],[2.4,{roll:.025}],[3,{}],[6,{}]],
  'tiny-dance':[[0,{}],[.5,{pitch:-.05}],[1,{roll:.12,yaw:.12}],[1.5,{roll:-.12,yaw:-.12}],[2,{roll:.12,yaw:.12,neck:.035}],[2.5,{roll:-.12,yaw:-.12}],[3.2,{}],[5,{}]],
  'ball-follow':[[0,{pitch:.1}],[.8,{pitch:.1}],[2.4,{ball:7,yaw:.34,pitch:.1}],[3.2,{ball:7,yaw:.34,pitch:.1}],[5.2,{ball:-7,yaw:-.34,pitch:.1}],[6,{ball:-7,yaw:-.34,pitch:.1}],[7.5,{pitch:.1}],[8,{pitch:.1}]]
};
export function sampleMotion(name,time){
  const clip=clips[name]||clips.idle;
  const duration=clip.at(-1)[0],t=((time%duration)+duration)%duration;
  const end=clip.findIndex(([at])=>at>t),a=clip[Math.max(0,end-1)],b=clip[end];
  const x=(t-a[0])/(b[0]-a[0]),ease=x*x*x*(x*(x*6-15)+10);
  return Object.fromEntries(Object.keys(rest).map(key=>[key,(a[1][key]||0)+((b[1][key]||0)-(a[1][key]||0))*ease]));
}
