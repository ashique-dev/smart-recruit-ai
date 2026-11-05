import {DatabaseSync} from 'node:sqlite';
import {closeSync, openSync, lstatSync} from 'node:fs';

// Initialization is a separate, exclusive administrative action; ordinary opens never reset.
export function initializeCounter(path, authorization = null) {
  const fd = openSync(path, 'wx', 0o600);
  closeSync(fd);
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
      CREATE TABLE identity (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, authorization TEXT);
      INSERT INTO identity VALUES (1,1,NULL);
      CREATE TABLE sends (ordinal INTEGER PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 2),
        task TEXT NOT NULL UNIQUE CHECK(task IN ('job-analysis','rubric-draft')),
        operation TEXT NOT NULL UNIQUE, consumed_at TEXT NOT NULL);`);
    db.prepare('UPDATE identity SET authorization=? WHERE id=1').run(authorization);
    db.exec(`CREATE TRIGGER identity_update BEFORE UPDATE ON identity BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUTHORIZATION'); END;
      CREATE TRIGGER identity_delete BEFORE DELETE ON identity BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUTHORIZATION'); END; COMMIT;`);
  } finally { db.close(); }
}
export function consume(path, task, operation, authorization = null) {
  let db;
  try {
    if (!lstatSync(path).isFile() || !['job-analysis','rubric-draft'].includes(task) ||
        !/^[a-f0-9-]{36}$/.test(operation)) throw new Error();
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
    const identity = db.prepare('SELECT * FROM identity WHERE id=1').get();
    if(identity?.version!==1 || (identity.authorization ?? null)!==authorization)throw new Error();
    const count = db.prepare('SELECT count(*) AS n FROM sends').get().n;
    if (count >= 2 || db.prepare('SELECT 1 FROM sends WHERE task=? OR operation=?').get(task, operation)) throw new Error();
    db.prepare('INSERT INTO sends VALUES (?,?,?,?)').run(count + 1, task, operation, new Date().toISOString());
    db.exec('COMMIT'); // Commit completes BEFORE handing control to the provider transport.
    return count + 1;
  } catch {
    try { db?.exec('ROLLBACK'); } catch { /* closed transaction */ }
    throw new Error('VERIFICATION_SEND_DENIED');
  } finally { db?.close(); }
}
export function boundedTransport(path, send, denied = () => new Error('VERIFICATION_SEND_DENIED')) {
  return async (url, options) => {
    if (url !== 'https://openrouter.ai/api/v1/chat/completions' || options?.method !== 'POST' || options.redirect !== 'error') throw new Error('VERIFICATION_TRANSPORT_DENIED');
    const body = JSON.parse(options.body);
    const task = body.response_format?.json_schema?.name?.replaceAll('_', '-');
    const {correlationId} = JSON.parse(body.messages[1].content);
    try { consume(path, task, correlationId); } catch { throw denied(); }
    return send(url, options);
  };
}

export function counterState(path, authorization = null) {
  let db;
  try {
    if(!lstatSync(path).isFile())throw new Error();
    db=new DatabaseSync(path,{readOnly:true});
    const identity=db.prepare('SELECT * FROM identity WHERE id=1').get();
    if(identity?.version!==1 || (identity.authorization ?? null)!==authorization)throw new Error();
    const consumed=db.prepare('SELECT count(*) AS n FROM sends').get().n;
    if(consumed<0||consumed>2)throw new Error();
    return {consumed,limit:2};
  } catch {throw new Error('VERIFICATION_COUNTER_UNREADABLE');}
  finally {db?.close();}
}
