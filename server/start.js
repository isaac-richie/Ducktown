import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try { process.loadEnvFile(path.join(root,'.env')); }
catch(error) { if(error.code!=='ENOENT')throw error; }

const {createApp}=await import('./app.js');
const {server}=await createApp();
const port=Number(process.env.DUCKTOWN_PORT||8787);
server.listen(port,'127.0.0.1',()=>console.log(`Ducktown local API: http://127.0.0.1:${port}/`));
