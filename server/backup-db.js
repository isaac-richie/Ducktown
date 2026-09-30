import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'data/ducktown.json');
const database=`${source}.sqlite`;
if(!existsSync(database))throw new Error('No Ducktown database to back up yet. Start the app first.');
const destination=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'data/backups',`ducktown-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
if(destination===database)throw new Error('Backup destination must differ from the live database');
await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
const store=new Store(source);
try {await store.open();await store.backup(destination);await chmod(destination,0o600);}
finally {store.close();}
console.log(`Ducktown backup saved: ${destination}`);
