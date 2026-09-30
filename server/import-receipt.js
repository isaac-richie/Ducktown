import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Deliberately a local-operator CLI, not a web endpoint. Attribution is an
// operator assignment to a Ducktown profile, not an SDK ownership proof.
export async function importReceipt({dataFile=path.join(project,'data/ducktown.json'),baseUrl=`http://127.0.0.1:${process.env.DUCKTOWN_PORT||8787}`,handle,artifactFile}) {
  if(typeof handle!=='string'||!/^[a-z][a-z0-9_]{2,23}$/.test(handle))throw new Error('Specify an exact existing account handle');
  const token=(await readFile(`${dataFile}.operator-token`,'utf8')).trim();
  const response=await fetch(`${baseUrl}/api/v1/operator/import-receipt`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({handle,artifactFile})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Import failed');
  return result.receipt;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==6||process.argv[2]!=='--handle'||process.argv[4]!=='--artifact')throw new Error('Usage: node server/import-receipt.js --handle HANDLE --artifact skill-smoke-UUID.json');
  const receipt=await importReceipt({handle:process.argv[3],artifactFile:process.argv[5]});
  console.log(JSON.stringify({receiptId:receipt.id,handle:process.argv[3],verification:receipt.verification,attribution:receipt.attribution,private:true}));
}
