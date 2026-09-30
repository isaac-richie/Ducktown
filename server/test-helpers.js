import Database from 'better-sqlite3';

export function readStoredState(dataFile) {
  const db=new Database(dataFile.endsWith('.sqlite')?dataFile:`${dataFile}.sqlite`,{readonly:true});
  try {return JSON.parse(db.prepare('SELECT document FROM app_state WHERE id=1').get().document);}
  finally {db.close();}
}
