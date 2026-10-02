import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Store } from './store.js';
import { PostgresStore } from './postgres-store.js';
import { cookieToken, hashPassword, newToken, publicUser, sessionCookie, tokenHash, verifyPassword } from './auth.js';
import { SimulatorObserver } from './simulator.js';
import { parsePolicyList } from './policies.js';
import { loadSimulatorArtifact } from './receipts.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const bundledRoot=path.resolve(here,'../dist/frontend');
const staticRoot=existsSync(path.join(bundledRoot,'index.html'))?bundledRoot:path.resolve(here,'../outputs');
const staticIndex=staticRoot===bundledRoot?'index.html':'ducktown.html';
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const securityHeaders={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"frame-ancestors 'none'"};
const send=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...securityHeaders,...headers});res.end(JSON.stringify(body));};
const behaviorCatalog=[
  {id:'ball-follow',name:'Follow the red ball',origin:'illustrative',verification:'unverified'},
  {id:'polite-bow',name:'The polite bow',origin:'illustrative',verification:'unverified'},
  {id:'balance-back',name:'Balance back',origin:'illustrative',verification:'unverified'},
  {id:'hello-wave',name:'Hello, world',origin:'illustrative',verification:'unverified'},
  {id:'tiny-dance',name:'Tiny dance break',origin:'illustrative',verification:'unverified'},
  {id:'duck-spot',name:'Spot a friend',origin:'illustrative',verification:'unverified'},
  {id:'sit-stand',name:'Sit & stand',origin:'illustrative',verification:'unverified'},
  {id:'kick',name:'Little kick',origin:'illustrative',verification:'unverified'},
  {id:'grab',name:'Beak grab',origin:'illustrative',verification:'unverified'},
  {id:'get-up',name:'Get back up',origin:'illustrative',verification:'unverified'},
  {id:'waddle',name:'Happy waddle',origin:'illustrative',verification:'unverified'}
];
function readJson(req) {
  return new Promise((resolve,reject)=>{
    let data='',size=0,tooLarge=false;
    req.on('data',chunk=>{size+=chunk.length;if(size>8192){tooLarge=true;return;}data+=chunk;});
    req.on('end',()=>{if(tooLarge)return reject(Object.assign(new Error('Body too large'),{status:413}));try{resolve(JSON.parse(data));}catch{reject(Object.assign(new Error('Invalid JSON'),{status:400}));}});
    req.on('error',reject);
  });
}
const loopback=address=>address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';
function configuredPublicOrigin(value){
  if(!value)return null;
  let url;
  try{url=new URL(value);}catch{throw new Error('DUCKTOWN_PUBLIC_ORIGIN must be an HTTPS origin');}
  if(url.protocol!=='https:'||url.origin!==value||url.username||url.password)throw new Error('DUCKTOWN_PUBLIC_ORIGIN must be an HTTPS origin without a path');
  return url;
}
export async function createApp(options={}) {
  const publicUrl=configuredPublicOrigin(options.publicOrigin??process.env.DUCKTOWN_PUBLIC_ORIGIN);
  const dataFile=options.dataFile || path.resolve(here,'../data/ducktown.json');
  const databaseUrl=options.databaseUrl??process.env.DATABASE_URL;
  const store=options.store||(databaseUrl?new PostgresStore(databaseUrl,dataFile):new Store(dataFile));
  await store.open();
  const tokenFile=`${dataFile}.operator-token`;
  await fs.mkdir(path.dirname(tokenFile),{recursive:true,mode:0o700});
  try {await fs.writeFile(tokenFile,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const operatorToken=(await fs.readFile(tokenFile,'utf8')).trim();
  if(!/^[a-f0-9]{64}$/.test(operatorToken))throw new Error('Invalid local operator token file');
  const evidenceDir=options.evidenceDir||path.resolve(here,'../work/evidence');
  const simulator=options.simulator || new SimulatorObserver();
  const sessionSeconds=7*24*60*60;
  const loginAttempts=new Map();
  const recoveryAttempts=new Map();
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      const pathname=url.pathname;
      if(publicUrl)res.setHeader('Strict-Transport-Security','max-age=31536000');
      const providedOperatorToken=(req.headers.authorization||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const operatorAuthorized=!!providedOperatorToken&&timingSafeEqual(Buffer.from(providedOperatorToken),Buffer.from(operatorToken));
      const directLoopback=loopback(req.socket.remoteAddress)&&/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host||'');
      const localOperator=pathname.startsWith('/api/v1/operator/')&&operatorAuthorized&&directLoopback;
      const localHealth=req.method==='GET'&&pathname==='/api/v1/health'&&directLoopback;
      if(pathname.startsWith('/api/v1/operator/')&&!localOperator)return send(res,403,{error:'Local operator access only'});
      if(publicUrl&&!localOperator&&!localHealth&&req.headers.host!==publicUrl.host)return send(res,403,{error:'Unexpected request host'});
      if(pathname.startsWith('/api/v1/')) {
        await store.refresh();
        if(['POST','PUT','DELETE'].includes(req.method)) {
          const origin=req.headers.origin;
          const expectedOrigin=publicUrl?.origin||`http://${req.headers.host}`;
          if(!localOperator&&((publicUrl&&!origin)||(origin&&origin!==expectedOrigin)))return send(res,403,{error:'Cross-origin writes are disabled'});
          if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')) return send(res,415,{error:'JSON content type required'});
        }
        const token=cookieToken(req);
        const user=token?store.userForTokenHash(tokenHash(token)):null;
        const forwardedIp=publicUrl&&loopback(req.socket.remoteAddress)?req.headers['x-real-ip']:null;
        const clientIp=typeof forwardedIp==='string'&&isIP(forwardedIp)?forwardedIp:req.socket.remoteAddress;
        const addressKey=tokenHash(clientIp||'unknown');
        const allowed=async(scope,actor,limit,windowMs)=>{
          const result=await store.consumeRateLimit(scope,actor,limit,windowMs);
          if(result.allowed)return true;
          send(res,429,{error:'Too many requests. Please try again later.'},{'Retry-After':String(result.retryAfter)});
          return false;
        };
        if(user&&['POST','PUT','DELETE'].includes(req.method)&&!pathname.startsWith('/api/v1/auth/')&&!localOperator&&!await allowed('write-user',user.id,240,60*60*1000))return;
        if(req.method==='GET' && pathname==='/api/v1/health') return send(res,200,{status:'ok',mode:databaseUrl?'supabase-postgres':'local-demo',hardwareConnected:false});
        if(req.method==='GET' && pathname==='/api/v1/auth/me') return send(res,200,{user:publicUser(user),robot:user?store.publicRobot(store.robot(user.robotId),user.id):null});
        if(req.method==='POST' && pathname==='/api/v1/auth/register') {
          const input=await readJson(req),handle=String(input?.handle||'').trim().toLowerCase(),password=input?.password;
          if(!/^[a-z][a-z0-9_]{2,23}$/.test(handle) || typeof password!=='string' || password.length<12 || password.length>128) return send(res,400,{error:'Use a 3–24 character handle and a password of 12–128 characters'});
          if(!await allowed('register-ip',addressKey,10,60*60*1000))return;
          const recoveryCode=newToken();
          const created=await store.createUser(handle,await hashPassword(password),tokenHash(recoveryCode));
          const session=newToken();await store.createSession(created.id,tokenHash(session),Date.now()+sessionSeconds*1000);
          return send(res,201,{user:publicUser(created),robot:store.publicRobot(store.robot(created.robotId),created.id),recoveryCode},{'Set-Cookie':sessionCookie(session,sessionSeconds,{secure:!!publicUrl})});
        }
        if(req.method==='POST' && pathname==='/api/v1/auth/login') {
          const input=await readJson(req),handle=String(input?.handle||'').trim().toLowerCase(),password=input?.password;
          if(!/^[a-z][a-z0-9_]{2,23}$/.test(handle) || typeof password!=='string' || password.length>128) return send(res,401,{error:'Invalid handle or password'});
          if(!await allowed('login-ip',addressKey,60,15*60*1000))return;
          const now=Date.now(),attempt=loginAttempts.get(handle)||{count:0,until:now+15*60*1000};
          if(attempt.until<now){attempt.count=0;attempt.until=now+15*60*1000;}
          if(attempt.count>=8)return send(res,429,{error:'Too many attempts. Try again later.'});
          const found=store.userByHandle(handle);
          if(typeof password!=='string'||!found||!(await verifyPassword(password,found.passwordHash))){attempt.count++;loginAttempts.set(handle,attempt);return send(res,401,{error:'Invalid handle or password'});}
          loginAttempts.delete(handle);
          const session=newToken();await store.createSession(found.id,tokenHash(session),Date.now()+sessionSeconds*1000);
          return send(res,200,{user:publicUser(found),robot:store.publicRobot(store.robot(found.robotId),found.id)},{'Set-Cookie':sessionCookie(session,sessionSeconds,{secure:!!publicUrl})});
        }
        if(req.method==='POST' && pathname==='/api/v1/auth/logout') {
          if(token)await store.deleteSession(tokenHash(token));
          return send(res,200,{ok:true},{'Set-Cookie':sessionCookie('',0,{secure:!!publicUrl})});
        }
        if(req.method==='POST'&&pathname==='/api/v1/auth/recovery-code'){
          if(!user)return send(res,401,{error:'Sign in to create a new recovery code'});
          const input=await readJson(req);
          if(!await allowed('recovery-code-user',user.id,10,60*60*1000))return;
          if(typeof input?.password!=='string'||!(await verifyPassword(input.password,user.passwordHash)))return send(res,401,{error:'Current password was not accepted'});
          const recoveryCode=newToken();await store.rotateRecoveryCode(user.id,tokenHash(recoveryCode));
          return send(res,200,{recoveryCode});
        }
        if(req.method==='POST'&&pathname==='/api/v1/auth/recover'){
          const input=await readJson(req),handle=String(input?.handle||'').trim().toLowerCase(),code=input?.recoveryCode,password=input?.newPassword;
          if(!/^[a-z][a-z0-9_]{2,23}$/.test(handle)||typeof code!=='string'||typeof password!=='string'||password.length<12||password.length>128)return send(res,400,{error:'Use your handle, recovery code, and a new password of 12–128 characters'});
          if(!await allowed('recover-ip',addressKey,20,15*60*1000))return;
          const now=Date.now(),attempt=recoveryAttempts.get(handle)||{count:0,until:now+15*60*1000};
          if(attempt.until<now){attempt.count=0;attempt.until=now+15*60*1000;}
          if(attempt.count>=5)return send(res,429,{error:'Too many recovery attempts. Try again later.'});
          const owner=store.userByHandle(handle),providedHash=tokenHash(code);
          const valid=!!owner?.recoveryHash&&/^[a-f0-9]{64}$/.test(owner.recoveryHash)&&timingSafeEqual(Buffer.from(providedHash),Buffer.from(owner.recoveryHash));
          if(!valid){attempt.count++;recoveryAttempts.set(handle,attempt);return send(res,401,{error:'Handle or recovery code was not accepted'});}
          const recoveryCode=newToken();await store.recoverPassword(owner.id,await hashPassword(password),tokenHash(recoveryCode));
          recoveryAttempts.delete(handle);loginAttempts.delete(handle);
          return send(res,200,{ok:true,recoveryCode},{'Set-Cookie':sessionCookie('',0,{secure:!!publicUrl})});
        }
        if(req.method==='GET' && pathname.startsWith('/api/v1/robots/')) {
          const robot=store.publicRobot(store.robot(pathname.slice('/api/v1/robots/'.length)),user?.id);
          return robot?send(res,200,{robot}):send(res,404,{error:'Robot not found'});
        }
        if(req.method==='GET'&&pathname==='/api/v1/profiles')return send(res,200,{profiles:store.listProfiles(user?.id)});
        if(req.method==='GET'&&pathname==='/api/v1/following'){
          if(!user)return send(res,401,{error:'Sign in to see who you follow'});
          return send(res,200,{following:store.listFollowing(user.id)});
        }
        if(req.method==='GET'&&pathname.startsWith('/api/v1/profiles/')){
          const handle=pathname.slice('/api/v1/profiles/'.length);
          const profile=store.profileByHandle(handle,user?.id);
          return profile?send(res,200,{profile}):send(res,404,{error:'Duck profile not found'});
        }
        if(req.method==='PUT'&&pathname==='/api/v1/profile'){
          if(!user)return send(res,401,{error:'Sign in to edit your duck'});
          const input=await readJson(req);
          if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['name','bio','colorway','publicProfile'].includes(key)))return send(res,400,{error:'Only duck name, story, color and visibility can be edited'});
          const name=typeof input.name==='string'?input.name.trim():null,bio=typeof input.bio==='string'?input.bio.trim():null;
          if(name===null||name.length<2||name.length>40||bio===null||bio.length>220||typeof input.publicProfile!=='boolean'||!['cream','graphite','lavender','sky'].includes(input.colorway)||/[\u0000-\u001f]/.test(name+bio))return send(res,400,{error:'Use a 2–40 character duck name, a story up to 220 characters, and a listed color'});
          if(!await allowed('profile-user',user.id,30,24*60*60*1000))return;
          return send(res,200,{profile:await store.updateProfile(user.id,{name,bio,colorway:input.colorway,publicProfile:input.publicProfile})});
        }
        const followMatch=pathname.match(/^\/api\/v1\/profiles\/([a-z][a-z0-9_]{2,23})\/follow$/);
        if(followMatch&&(req.method==='PUT'||req.method==='DELETE')){
          if(!user)return send(res,401,{error:'Sign in to follow a duck'});
          const target=store.userByHandle(followMatch[1]);
          if(req.method==='PUT'&&!await allowed('follow-user',user.id,30,60*60*1000))return;
          return send(res,200,await store.setFollow(user.id,target?.id,req.method==='PUT'));
        }
        if(req.method==='GET'&&pathname==='/api/v1/saves'){
          if(!user)return send(res,401,{error:'Sign in to see saved items'});
          return send(res,200,{saves:store.listSaves(user.id)});
        }
        const saveMatch=pathname.match(/^\/api\/v1\/saves\/(post|idea|challenge)\/([a-z0-9-]+)$/);
        if(saveMatch&&(req.method==='PUT'||req.method==='DELETE')){
          if(!user)return send(res,401,{error:'Sign in to save this'});
          return send(res,200,await store.setSave(user.id,saveMatch[1],saveMatch[2],req.method==='PUT'));
        }
        if(req.method==='GET'&&pathname==='/api/v1/notifications'){
          if(!user)return send(res,401,{error:'Sign in to see notifications'});
          return send(res,200,{notifications:store.listNotifications(user.id)});
        }
        if(req.method==='POST'&&pathname==='/api/v1/notifications/read'){
          if(!user)return send(res,401,{error:'Sign in to see notifications'});
          const input=await readJson(req);
          if(!input||Object.keys(input).length)return send(res,400,{error:'Use an empty request to mark notifications read'});
          return send(res,200,await store.markNotificationsRead(user.id));
        }
        if(req.method==='GET' && pathname==='/api/v1/behaviors') return send(res,200,{behaviors:behaviorCatalog});
        if(req.method==='GET' && pathname==='/api/v1/installed-policies') {
          if(!user)return send(res,401,{error:'Sign in to inspect installed simulator policies'});
          const reading=await simulator.inspect('policies');
          if(!reading.configured||!reading.ok)return send(res,503,{error:'Official simulator policy list unavailable',reason:reading.reason||'The configured simulator did not answer',checkedAt:reading.checkedAt});
          return send(res,200,{source:reading.source,checkedAt:reading.checkedAt,verification:'sdk_reported_only',isRun:false,hardwareConnected:false,...parsePolicyList(reading.output)});
        }
        if(req.method==='GET' && pathname.startsWith('/api/v1/simulator/')) {
          if(!user)return send(res,401,{error:'Sign in to inspect the local simulator'});
          const command=pathname.slice('/api/v1/simulator/'.length);
          return send(res,200,await simulator.inspect(command));
        }
        if(pathname==='/api/v1/sdk-observations') {
          if(!user)return send(res,401,{error:'Sign in to view SDK observations'});
          if(req.method==='GET')return send(res,200,{observations:store.listSnapshots(user.id)});
          if(req.method==='POST') {
            if(!await allowed('observation-user',user.id,12,60*60*1000))return;
            const result=await simulator.snapshot();
            if(!result.ready)return send(res,409,{error:'No complete official simulator observation was recorded',reason:result.reason,failedCheck:result.failedCheck});
            const observation=await store.createSnapshot(user.id,result.observation);
            return send(res,201,{observation});
          }
        }
        if(req.method==='GET' && pathname==='/api/v1/receipts') {
          if(!user)return send(res,401,{error:'Sign in to view private simulator receipts'});
          return send(res,200,{receipts:store.listReceipts(user.id)});
        }
        const shareMatch=pathname.match(/^\/api\/v1\/receipts\/([a-f0-9-]{36})\/share$/);
        if(req.method==='POST' && shareMatch) {
          if(!user)return send(res,401,{error:'Sign in to share a simulator receipt'});
          const input=await readJson(req);
          if(!input||Object.keys(input).length!==0)return send(res,400,{error:'Receipt posts are server-written; custom claims are not accepted'});
          if(!await allowed('receipt-share-user',user.id,6,24*60*60*1000))return;
          return send(res,201,await store.shareReceipt(user.id,shareMatch[1]));
        }
        if(req.method==='POST' && pathname==='/api/v1/operator/import-receipt') {
          if(!operatorAuthorized)return send(res,403,{error:'Local operator token required'});
          const input=await readJson(req);
          if(typeof input?.handle!=='string'||!/^[a-z][a-z0-9_]{2,23}$/.test(input.handle))return send(res,400,{error:'Exact existing handle required'});
          const owner=store.userByHandle(input.handle);
          if(!owner)return send(res,404,{error:'Account not found'});
          const metadata=await loadSimulatorArtifact(evidenceDir,input.artifactFile);
          const receipt=await store.attachReceipt(owner.id,metadata);
          return send(res,201,{receipt});
        }
        if(req.method==='GET'&&pathname==='/api/v1/operator/reports'){
          if(!operatorAuthorized)return send(res,403,{error:'Local operator token required'});
          return send(res,200,{reports:store.listReports()});
        }
        if(req.method==='POST'&&pathname==='/api/v1/operator/moderate-post'){
          if(!operatorAuthorized)return send(res,403,{error:'Local operator token required'});
          const input=await readJson(req);
          if(!/^[a-f0-9-]{36}$/.test(input?.postId||'')||typeof input.hidden!=='boolean'||Object.keys(input).some(key=>!['postId','hidden'].includes(key)))return send(res,400,{error:'Exact post ID and visibility required'});
          return send(res,200,await store.moderatePost(input.postId,input.hidden));
        }
        if(req.method==='POST'&&pathname==='/api/v1/operator/moderate-reply'){
          if(!operatorAuthorized)return send(res,403,{error:'Local operator token required'});
          const input=await readJson(req);
          if(!/^[a-f0-9-]{36}$/.test(input?.replyId||'')||typeof input.hidden!=='boolean'||Object.keys(input).some(key=>!['replyId','hidden'].includes(key)))return send(res,400,{error:'Exact reply ID and visibility required'});
          return send(res,200,await store.moderateReply(input.replyId,input.hidden));
        }
        const socialMatch=pathname.match(/^\/api\/v1\/posts\/([a-f0-9-]{36})\/(like|replies)$/);
        const reportMatch=pathname.match(/^\/api\/v1\/posts\/([a-f0-9-]{36})\/report$/);
        if(req.method==='POST'&&reportMatch){
          if(!user)return send(res,401,{error:'Sign in to report a post'});
          const input=await readJson(req);
          if(!input||!['spam','harassment','unsafe','other'].includes(input.reason)||Object.keys(input).some(key=>key!=='reason'))return send(res,400,{error:'Choose a report reason'});
          if(!await allowed('report-user',user.id,10,24*60*60*1000))return;
          return send(res,200,await store.reportPost(user.id,reportMatch[1],input.reason));
        }
        const replyReportMatch=pathname.match(/^\/api\/v1\/replies\/([a-f0-9-]{36})\/report$/);
        if(req.method==='POST'&&replyReportMatch){
          if(!user)return send(res,401,{error:'Sign in to report a reply'});
          const input=await readJson(req);
          if(!input||!['spam','harassment','unsafe','other'].includes(input.reason)||Object.keys(input).some(key=>key!=='reason'))return send(res,400,{error:'Choose a report reason'});
          if(!await allowed('report-user',user.id,10,24*60*60*1000))return;
          return send(res,200,await store.reportReply(user.id,replyReportMatch[1],input.reason));
        }
        if(socialMatch) {
          const [,postId,part]=socialMatch;
          if(part==='replies'&&req.method==='GET')return send(res,200,{replies:store.listReplies(postId)});
          if(!user)return send(res,401,{error:'Sign in to join the conversation'});
          if(part==='like'&&(req.method==='PUT'||req.method==='DELETE'))return send(res,200,await store.setPostLike(user.id,postId,req.method==='PUT'));
          if(part==='replies'&&req.method==='POST') {
            const input=await readJson(req);
            if(typeof input?.text!=='string')return send(res,400,{error:'Reply text is required'});
            const body=input.text.trim();
            if(!body||body.length>400||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body))return send(res,400,{error:'Reply must be 1–400 valid characters'});
            if(!await allowed('reply-user',user.id,30,60*60*1000))return;
            return send(res,201,{reply:await store.createReply(user.id,postId,body)});
          }
        }
        if(req.method==='GET' && pathname==='/api/v1/posts') return send(res,200,{posts:store.listPosts(user?.id)});
        if(req.method==='POST' && pathname==='/api/v1/posts') {
          if(!user)return send(res,401,{error:'Sign in to post'});
          const input=await readJson(req);
          if(!input || typeof input.text!=='string') return send(res,400,{error:'Text is required'});
          const body=input.text.trim();
          if(!body || body.length>800 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) return send(res,400,{error:'Text must be 1–800 valid characters'});
          if(!await allowed('post-user',user.id,6,60*60*1000))return;
          const post=await store.createPost({text:body,robotId:input.robotId||user.robotId},user);
          return send(res,201,{post:store.publicPost(post,user.id)});
        }
        return send(res,404,{error:'API route not found'});
      }
      if(req.method!=='GET' && req.method!=='HEAD') return send(res,405,{error:'Method not allowed'});
      const requested=pathname==='/'?staticIndex:decodeURIComponent(pathname).replace(/^\/+/, '');
      const relative=staticRoot===bundledRoot&&requested==='ducktown.html'?'index.html':requested;
      const file=path.resolve(staticRoot,relative);
      if(!file.startsWith(staticRoot+path.sep)) return send(res,403,{error:'Forbidden'});
      const stat=await fs.stat(file).catch(()=>null);
      if(!stat?.isFile()) return send(res,404,{error:'Not found'});
      res.writeHead(200,{'Content-Type':contentTypes[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,...securityHeaders,'Cache-Control':'no-cache'});
      if(req.method==='HEAD') return res.end();
      const stream=createReadStream(file);
      stream.on('error',()=>res.destroy());
      stream.pipe(res);
    } catch(error) { if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'Internal error'}); else res.destroy(); }
  });
  server.on('close',()=>{void store.close()?.catch?.(()=>{});});
  return {server,store};
}
