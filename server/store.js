import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const initial = () => ({version:1, robots:[{id:'pepper',name:'Pepper',mode:'simulation',hardwareConnected:false,owner:'local-demo'}], posts:[],users:[],sessions:[],snapshots:[],receipts:[],postLikes:[],postReplies:[],follows:[],saves:[],notifications:[],reports:[]});
const missing=(message,status=404)=>Object.assign(new Error(message),{status});

export class Store {
  constructor(file) { this.legacyFile=file.endsWith('.sqlite')?null:file;this.file=file.endsWith('.sqlite')?file:`${file}.sqlite`; this.state=null; this.pending=Promise.resolve();this.db=null; }
  async open() {
    await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    this.db=new Database(this.file,{timeout:5000});
    await fs.chmod(this.file,0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)');
    this.db.exec('CREATE TABLE IF NOT EXISTS rate_events (scope TEXT NOT NULL, actor TEXT NOT NULL, at_ms INTEGER NOT NULL)');
    this.db.exec('CREATE INDEX IF NOT EXISTS rate_events_lookup ON rate_events(scope, actor, at_ms)');
    if(!this.db.pragma('table_info(app_state)').some(column=>column.name==='revision'))this.db.exec('ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    const record=this.db.prepare('SELECT document FROM app_state WHERE id=1').get();
    if(record)this.state=JSON.parse(record.document);
    else {
      let imported=null;
      if(this.legacyFile){try{imported=JSON.parse(await fs.readFile(this.legacyFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
      this.state=imported||initial();
      if(this.state.version!==1||!Array.isArray(this.state.posts)||!Array.isArray(this.state.robots))throw new Error('Unsupported or invalid Ducktown data file');
      this.db.prepare('INSERT OR IGNORE INTO app_state(id,document) VALUES(1,?)').run(JSON.stringify(this.state));
      this.refresh();
    }
    if(this.state.version!==1 || !Array.isArray(this.state.posts) || !Array.isArray(this.state.robots)) throw new Error('Unsupported or invalid Ducktown data file');
    const collections=['users','sessions','snapshots','receipts','postLikes','postReplies','follows','saves','notifications','reports'];
    if(collections.some(key=>!Array.isArray(this.state[key]))) {
      this.state={...this.state};
      for(const key of collections)if(!Array.isArray(this.state[key]))this.state[key]=[];
      this.write(this.state);
    }
  }
  close(){this.db?.close();this.db=null;}
  async backup(destination){await this.db.backup(destination);}
  consumeRateLimit(scope,actor,limit,windowMs,now=Date.now()){
    const transaction=this.db.transaction(()=>{
      this.db.prepare('DELETE FROM rate_events WHERE at_ms <= ?').run(now-24*60*60*1000);
      const start=now-windowMs;
      const recent=this.db.prepare('SELECT COUNT(*) AS count, MIN(at_ms) AS oldest FROM rate_events WHERE scope=? AND actor=? AND at_ms>?').get(scope,actor,start);
      if(recent.count>=limit)return {allowed:false,retryAfter:Math.max(1,Math.ceil((recent.oldest+windowMs-now)/1000))};
      this.db.prepare('INSERT INTO rate_events(scope,actor,at_ms) VALUES(?,?,?)').run(scope,actor,now);
      return {allowed:true};
    });
    return transaction.immediate();
  }
  refresh(){const record=this.db.prepare('SELECT document FROM app_state WHERE id=1').get();if(record)this.state=JSON.parse(record.document);}
  publicPost(post,viewerId=null,state=this.state) {
    return {...post,likes:(post.likes||0)+state.postLikes.filter(item=>item.postId===post.id).length,replies:(post.replies||0)+state.postReplies.filter(item=>item.postId===post.id&&!item.hidden).length,viewerLiked:!!viewerId&&state.postLikes.some(item=>item.postId===post.id&&item.userId===viewerId)};
  }
  listPosts(viewerId=null) { return this.state.posts.filter(post=>!post.hidden).slice().reverse().map(post=>this.publicPost(post,viewerId)); }
  listReplies(postId) {
    if(!this.state.posts.some(post=>post.id===postId&&!post.hidden))throw Object.assign(new Error('Post not found'),{status:404});
    return this.state.postReplies.filter(item=>item.postId===postId&&!item.hidden).map(item=>({id:item.id,postId:item.postId,handle:item.handle,text:item.text,origin:'human_reply',createdAt:item.createdAt}));
  }
  setPostLike(userId,postId,liked) { return this.mutate(state=>{
    const post=state.posts.find(item=>item.id===postId);
    if(!post||post.hidden)throw Object.assign(new Error('Post not found'),{status:404});
    const existing=state.postLikes.findIndex(item=>item.postId===postId&&item.userId===userId);
    if(liked&&existing<0)state.postLikes.push({postId,userId});
    if(!liked&&existing>=0)state.postLikes.splice(existing,1);
    return {liked,likes:(post.likes||0)+state.postLikes.filter(item=>item.postId===postId).length};
  }); }
  createReply(userId,postId,text) { return this.mutate(state=>{
    if(!state.posts.some(item=>item.id===postId&&!item.hidden))throw Object.assign(new Error('Post not found'),{status:404});
    const user=state.users.find(item=>item.id===userId);
    if(!user)throw Object.assign(new Error('Account not found'),{status:403});
    if(state.postReplies.filter(item=>item.postId===postId).length>=200)throw Object.assign(new Error('This conversation is full'),{status:409});
    const reply={id:randomUUID(),postId,userId,handle:user.handle,text,createdAt:new Date().toISOString()};
    state.postReplies.push(reply);
    const post=state.posts.find(item=>item.id===postId);
    if(post?.userId)this.addNotification(state,post.userId,userId,'reply',postId);
    return {id:reply.id,postId,handle:reply.handle,text,origin:'human_reply',createdAt:reply.createdAt};
  }); }
  robot(id) { return this.state.robots.find(robot=>robot.id===id) || null; }
  userByHandle(handle) { return this.state.users.find(user=>user.handle===handle) || null; }
  userById(id) { return this.state.users.find(user=>user.id===id) || null; }
  userForTokenHash(hash) {
    const session=this.state.sessions.find(item=>item.tokenHash===hash && item.expiresAt>Date.now());
    return session?this.userById(session.userId):null;
  }
  listSnapshots(userId) { return this.state.snapshots.filter(item=>item.userId===userId).slice().reverse(); }
  listReceipts(userId) { return this.state.receipts.filter(item=>item.userId===userId).slice().reverse(); }
  publicRobot(robot,viewerId=null,state=this.state) {
    if(!robot||robot.owner==='local-demo')return robot;
    if(robot.publicProfile===false&&robot.ownerId!==viewerId)return null;
    const {ownerId,name,id,mode,hardwareConnected,bio='',colorway='cream'}=robot;
    const owner=state.users.find(item=>item.id===ownerId);
    return {id,ownerId,handle:owner?.handle||null,name,mode,hardwareConnected,bio,colorway,publicProfile:robot.publicProfile!==false,
      followers:state.follows.filter(item=>item.targetId===ownerId).length,
      following:state.follows.filter(item=>item.userId===ownerId).length,
      viewerFollowing:!!viewerId&&state.follows.some(item=>item.userId===viewerId&&item.targetId===ownerId)};
  }
  listProfiles(viewerId=null){return this.state.robots.filter(robot=>robot.ownerId&&(robot.publicProfile!==false||robot.ownerId===viewerId)).map(robot=>this.publicRobot(robot,viewerId));}
  listFollowing(userId){return this.state.follows.filter(item=>item.userId===userId).map(item=>{
    const user=this.userById(item.targetId),robot=this.robot(user?.robotId);
    return robot?.publicProfile===false?{handle:user.handle,name:'Private duck',private:true,viewerFollowing:true}:this.publicRobot(robot,userId);
  }).filter(Boolean);}
  profileByHandle(handle,viewerId=null){const owner=this.userByHandle(handle);return owner?this.publicRobot(this.robot(owner.robotId),viewerId):null;}
  updateProfile(userId,input){return this.mutate(state=>{
    const user=state.users.find(item=>item.id===userId),robot=state.robots.find(item=>item.id===user?.robotId&&item.ownerId===userId);
    if(!robot)throw missing('Duck profile not found');
    Object.assign(robot,input);return this.publicRobot(robot,userId,state);
  });}
  setFollow(userId,targetId,following){return this.mutate(state=>{
    if(userId===targetId)throw missing('You cannot follow yourself',400);
    const target=state.users.find(item=>item.id===targetId),robot=state.robots.find(item=>item.ownerId===targetId);
    if(!target||!robot||(following&&robot.publicProfile===false))throw missing('Duck profile not found');
    const index=state.follows.findIndex(item=>item.userId===userId&&item.targetId===targetId);
    if(following&&index<0){state.follows.push({userId,targetId,createdAt:new Date().toISOString()});this.addNotification(state,targetId,userId,'follow',null);}
    if(!following&&index>=0)state.follows.splice(index,1);
    return {following,followers:state.follows.filter(item=>item.targetId===targetId).length};
  });}
  listSaves(userId){return this.state.saves.filter(item=>item.userId===userId).map(item=>({kind:item.kind,id:item.id}));}
  setSave(userId,kind,id,saved){return this.mutate(state=>{
    if(kind==='post'&&!state.posts.some(item=>item.id===id&&!item.hidden))throw missing('Post not found');
    if(kind==='idea'&&!['ball-follow','polite-bow','balance-back','hello-wave','tiny-dance','duck-spot','sit-stand','kick','grab'].includes(id))throw missing('Idea not found');
    if(kind==='challenge'&&!['greeting','red-ball','balance','dance'].includes(id))throw missing('Challenge not found');
    const index=state.saves.findIndex(item=>item.userId===userId&&item.kind===kind&&item.id===id);
    if(saved&&index<0)state.saves.push({userId,kind,id,createdAt:new Date().toISOString()});
    if(!saved&&index>=0)state.saves.splice(index,1);
    return {kind,id,saved};
  });}
  addNotification(state,userId,actorId,kind,postId){
    if(userId===actorId)return;
    state.notifications.push({id:randomUUID(),userId,actorId,kind,postId,read:false,createdAt:new Date().toISOString()});
    const own=state.notifications.filter(item=>item.userId===userId);
    if(own.length>100){const old=new Set(own.slice(0,-100).map(item=>item.id));state.notifications=state.notifications.filter(item=>!old.has(item.id));}
  }
  listNotifications(userId){return this.state.notifications.filter(item=>item.userId===userId).slice().reverse().map(item=>({...item,actorHandle:this.userById(item.actorId)?.handle||'A neighbor'}));}
  markNotificationsRead(userId){return this.mutate(state=>{for(const item of state.notifications)if(item.userId===userId)item.read=true;return {ok:true};});}
  reportPost(userId,postId,reason){return this.mutate(state=>{
    if(!state.posts.some(item=>item.id===postId&&!item.hidden))throw missing('Post not found');
    if(state.reports.some(item=>item.userId===userId&&item.postId===postId))return {reported:true};
    state.reports.push({id:randomUUID(),userId,postId,reason,createdAt:new Date().toISOString()});
    return {reported:true};
  });}
  reportReply(userId,replyId,reason){return this.mutate(state=>{
    const reply=state.postReplies.find(item=>item.id===replyId&&!item.hidden);
    if(!reply||!state.posts.some(item=>item.id===reply.postId&&!item.hidden))throw missing('Reply not found');
    if(state.reports.some(item=>item.userId===userId&&item.replyId===replyId))return {reported:true};
    state.reports.push({id:randomUUID(),userId,postId:reply.postId,replyId,reason,createdAt:new Date().toISOString()});
    return {reported:true};
  });}
  listReports(){return this.state.reports.map(item=>({id:item.id,postId:item.postId,replyId:item.replyId||null,reason:item.reason,createdAt:item.createdAt,reporter:this.userById(item.userId)?.handle||'unknown',post:this.state.posts.find(post=>post.id===item.postId)||null,reply:item.replyId?this.state.postReplies.find(reply=>reply.id===item.replyId)||null:null}));}
  moderatePost(postId,hidden){return this.mutate(state=>{
    const post=state.posts.find(item=>item.id===postId);if(!post)throw missing('Post not found');
    post.hidden=hidden;post.moderatedAt=new Date().toISOString();return {postId,hidden};
  });}
  moderateReply(replyId,hidden){return this.mutate(state=>{
    const reply=state.postReplies.find(item=>item.id===replyId);if(!reply)throw missing('Reply not found');
    reply.hidden=hidden;reply.moderatedAt=new Date().toISOString();return {replyId,hidden};
  });}
  mutate(callback) {
    this.pending=this.pending.catch(()=>{}).then(()=>{
      const transaction=this.db.transaction(()=>{
        const record=this.db.prepare('SELECT document FROM app_state WHERE id=1').get();
        const next=structuredClone(JSON.parse(record.document));
        const result=callback(next);
        this.db.prepare('UPDATE app_state SET document=?, revision=revision+1 WHERE id=1').run(JSON.stringify(next));
        return {next,result};
      });
      const {next,result}=transaction.immediate();
      this.state=next;
      return result;
    });
    return this.pending;
  }
  createUser(handle,passwordHash,recoveryHash=null) { return this.mutate(state=>{
    if(state.users.some(user=>user.handle===handle)) throw Object.assign(new Error('Handle already in use'),{status:409});
    const user={id:randomUUID(),handle,passwordHash,recoveryHash,robotId:`duck-${randomUUID()}`,createdAt:new Date().toISOString()};
    const robot={id:user.robotId,name:`${handle}'s Duck`,bio:'A little duck with a story still unfolding.',colorway:'cream',publicProfile:true,mode:'simulation',hardwareConnected:false,ownerId:user.id};
    state.users.push(user);state.robots.push(robot);return user;
  }); }
  createSession(userId,tokenHash,expiresAt) { return this.mutate(state=>{
    state.sessions=state.sessions.filter(item=>item.expiresAt>Date.now());
    state.sessions.push({userId,tokenHash,expiresAt});return true;
  }); }
  deleteSession(tokenHash) { return this.mutate(state=>{state.sessions=state.sessions.filter(item=>item.tokenHash!==tokenHash);return true;}); }
  rotateRecoveryCode(userId,recoveryHash){return this.mutate(state=>{
    const user=state.users.find(item=>item.id===userId);if(!user)throw missing('Account not found');
    user.recoveryHash=recoveryHash;return true;
  });}
  recoverPassword(userId,passwordHash,recoveryHash){return this.mutate(state=>{
    const user=state.users.find(item=>item.id===userId);if(!user)throw missing('Account not found');
    user.passwordHash=passwordHash;user.recoveryHash=recoveryHash;
    state.sessions=state.sessions.filter(item=>item.userId!==userId);
    return true;
  });}
  createPost(input,user) { return this.mutate(state=>{
    const robot=state.robots.find(item=>item.id===input.robotId);
    if(!robot || robot.ownerId!==user.id) throw Object.assign(new Error('Robot not owned by this account'),{status:403});
    const post={id:randomUUID(),userId:user.id,robotId:robot.id,name:user.handle,handle:`@${user.handle}`,room:'The Pond',kind:'owner',origin:'owner_note',text:input.text,receipt:'Owner note · not robot evidence',likes:0,replies:0,createdAt:new Date().toISOString()};
    state.posts.push(post);return post;
  }); }
  createSnapshot(userId,observation) { return this.mutate(state=>{
    const snapshot={id:randomUUID(),userId,...observation};
    state.snapshots.push(snapshot);
    const excess=state.snapshots.filter(item=>item.userId===userId).slice(0,-20);
    if(excess.length){const old=new Set(excess.map(item=>item.id));state.snapshots=state.snapshots.filter(item=>!old.has(item.id));}
    return snapshot;
  }); }
  attachReceipt(userId,metadata) { return this.mutate(state=>{
    const user=state.users.find(item=>item.id===userId);
    if(!user||!state.robots.some(item=>item.id===user.robotId&&item.ownerId===userId&&item.mode==='simulation'))throw Object.assign(new Error('Account has no owned simulation profile'),{status:403});
    if(state.receipts.some(item=>item.recordSha256===metadata.recordSha256))throw Object.assign(new Error('Evidence artifact already attached'),{status:409});
    const receipt={id:randomUUID(),userId,robotId:user.robotId,...metadata,private:true,importedAt:new Date().toISOString()};
    state.receipts.push(receipt);
    return receipt;
  }); }
  shareReceipt(userId,receiptId) { return this.mutate(state=>{
    const receipt=state.receipts.find(item=>item.id===receiptId);
    if(!receipt||receipt.userId!==userId)throw Object.assign(new Error('Private receipt not found for this account'),{status:404});
    if(receipt.publishedPostId)throw Object.assign(new Error('Receipt already shared'),{status:409});
    const user=state.users.find(item=>item.id===userId);
    if(!user||receipt.robotId!==user.robotId)throw Object.assign(new Error('Receipt profile mismatch'),{status:403});
    if(receipt.verification!=='telemetry_observed'||receipt.attribution!=='local_operator_assigned_unverified'||receipt.completionVerified!==false||receipt.performanceMeasured!==false||receipt.hardwareConnected!==false)throw Object.assign(new Error('Receipt is not publishable'),{status:422});
    const moveName=String(receipt.skill).replace(/[_-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
    const post={id:randomUUID(),userId,robotId:receipt.robotId,name:user.handle,handle:`@${user.handle}`,room:'The Pond',kind:'robot',origin:'simulator_telemetry_observed',text:`The simulator showed ${moveName} starting and returning to stand. A local operator linked this moment to my account, but we cannot confirm who controlled the simulator or whether the task succeeded. No physical robot was tested.`,receipt:`Seen in simulation · ${receipt.frameCount} snapshots · no score`,evidence:{receiptId:receipt.id,skill:receipt.skill,verification:receipt.verification,attribution:receipt.attribution,traceSha256:receipt.traceSha256,policySha256:receipt.policySha256,sceneSha256:receipt.sceneSha256,frameCount:receipt.frameCount,observedSeconds:receipt.observedSeconds,timeline:receipt.timeline,hardwareConnected:false,completionVerified:false,performanceMeasured:false},likes:0,replies:0,createdAt:new Date().toISOString()};
    state.posts.push(post);
    receipt.publishedPostId=post.id;
    receipt.publishedAt=post.createdAt;
    return {post,receipt};
  }); }
  write(data=this.state) {this.db.prepare('INSERT INTO app_state(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,revision=revision+1').run(JSON.stringify(data));}
}
