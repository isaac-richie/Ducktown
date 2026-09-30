import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt=promisify(scryptCallback);
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export const newToken=()=>randomBytes(32).toString('base64url');
export const publicUser=user=>user?{id:user.id,handle:user.handle,robotId:user.robotId}:null;
export async function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  const hash=await scrypt(password,salt,64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password,stored) {
  const [scheme,salt,hex]=String(stored||'').split(':');
  if(scheme!=='scrypt'||!salt||!hex)return false;
  const expected=Buffer.from(hex,'hex');
  if(expected.length!==64)return false;
  const actual=await scrypt(password,salt,64);
  return timingSafeEqual(actual,expected);
}
export function cookieToken(req) {
  const value=(req.headers.cookie||'').split(';').map(item=>item.trim()).find(item=>item.startsWith('duck_session='));
  return value?.slice('duck_session='.length)||null;
}
export const sessionCookie=(token,maxAge,{secure=false}={})=>`duck_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;
