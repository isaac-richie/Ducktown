import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataFile=path.join(root,'data/ducktown.json');
const token=(await readFile(`${dataFile}.operator-token`,'utf8')).trim();
const base=`http://127.0.0.1:${process.env.DUCKTOWN_PORT||8787}`;
const [action,postId]=process.argv.slice(2);
if(!['--list','--hide','--restore','--hide-reply','--restore-reply'].includes(action)||(action==='--list'&&postId)||(action!=='--list'&&!/^[a-f0-9-]{36}$/.test(postId||'')))throw new Error('Usage: node server/moderate.js --list | --hide POST_ID | --restore POST_ID | --hide-reply REPLY_ID | --restore-reply REPLY_ID');
const response=action==='--list'
  ?await fetch(`${base}/api/v1/operator/reports`,{headers:{Authorization:`Bearer ${token}`}})
  :await fetch(`${base}/api/v1/operator/${action.includes('reply')?'moderate-reply':'moderate-post'}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(action.includes('reply')?{replyId:postId,hidden:action==='--hide-reply'}:{postId,hidden:action==='--hide'})});
const result=await response.json();
if(!response.ok)throw new Error(result.error||'Moderation request failed');
console.log(JSON.stringify(result,null,2));
