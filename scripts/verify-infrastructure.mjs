import assert from 'node:assert/strict';
import { expectedServices, expectPostgresPermissionDenied, expectS3AccessDenied, assertCompleteServices, isNewHeartbeat, pollUntil } from './infrastructure-assertions.mjs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const base = process.env.APP_URL || 'http://localhost:8080';
const compose = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 150000 });
const remote = (service, program) => execFileSync('docker', ['compose', 'exec', '-T', service, 'node', '-e', program], { encoding: 'utf8', timeout: 10000 });
const pass = name => console.log(`PASS ${name}`);
const config = JSON.parse(compose('config', '--format', 'json'));
assert.deepEqual(Object.keys(config.services).sort(), expectedServices);
for (const [name, service] of Object.entries(config.services)) {
  if (name !== 'nginx') assert.equal(service.ports, undefined, `${name} must be private`);
  for (const port of service.ports || []) assert.equal(port.host_ip, '127.0.0.1');
}
assert.equal(config.networks.data.internal, true);
pass('nine services, private data network and loopback-only edge');
for (const path of ['/', '/unknown-spa-route', '/api/docs', '/api/docs-json', '/api/docs-yaml', '/api/health/live', '/api/health/ready']) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  if (path === '/api/docs-yaml') assert.match(await response.text(), /^openapi: 3\./m);
  if (path === '/api/docs-json') assert.ok((await response.json()).paths['/health/live']);
  if (path === '/api/health/ready') {
    const health = await response.json(); assert.equal(health.status, 'ok');
    assert.deepEqual(Object.keys(health.components).sort(), ['postgres', 'redis', 'smtp', 'storage']);
    for (const value of Object.values(health.components)) assert.equal(value, 'up');
  }
}
assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
pass('Nginx SPA, Swagger, API live/ready, API 404');
await new Promise((resolve, reject) => {
  const socket = io(base, { transports: ['polling', 'websocket'], extraHeaders: { Origin: base }, reconnection: false });
  const timer = setTimeout(() => finish(new Error('Socket upgrade timeout')), 10000);
  function finish(error) { clearTimeout(timer); socket.close(); if (error) reject(error); else resolve(); }
  socket.on('connect_error', finish);
  socket.io.engine.on('upgrade', transport => { if (transport.name === 'websocket') finish(); });
});
pass('Socket.IO polling upgraded to WebSocket through Nginx');
await new Promise((resolve, reject) => {
  const socket = io(base, { transports: ['websocket'], extraHeaders: { Origin: 'https://untrusted.invalid' }, reconnection: false, timeout: 3000 });
  socket.on('connect', () => { socket.close(); reject(new Error('Untrusted socket origin accepted')); });
  socket.on('connect_error', () => { socket.close(); resolve(); });
});
const deniedHandshake = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: 'https://untrusted.invalid' } });
assert.equal(deniedHandshake.status, 403);
assert.equal((await deniedHandshake.json()).code, 4);
pass('untrusted WebSocket origin rejected with explicit Engine.IO forbidden response');
compose('exec', '-T', 'worker', 'pnpm', 'smoke');
pass('independent BullMQ worker completed smoke job');
for (const service of ['api', 'worker']) {
  const module = service === 'api' ? './dist/common/infrastructure' : '@smart-recruit/api/infrastructure';
  remote(service, `const {Infrastructure}=require('${module}'); const i=new Infrastructure(); (async()=>{try{const h=await i.health();if(h.status!=='ok')throw Error('DEPENDENCY_DOWN');}finally{await i.onModuleDestroy()}})().catch(()=>process.exit(1));`);
}
pass('API and worker reach PostgreSQL, Redis, private bucket and SMTP');
compose('run', '--rm', '--no-deps', 'minio-init');
compose('run', '--rm', '--no-deps', 'minio-init');
pass('bucket/policy bootstrap succeeds twice');
const marker = `phase1-${randomUUID()}`;
const program = body => `${expectPostgresPermissionDenied.toString()}; ${expectS3AccessDenied.toString()}; const {Infrastructure}=require('./dist/common/infrastructure'); const i=new Infrastructure(); const marker=${JSON.stringify(marker)}; (async()=>{try{${body}}finally{await i.onModuleDestroy()}})().catch(()=>process.exit(1));`;
remote('api', program(`
  await i.prisma.workerHeartbeat.create({data:{id:marker,updatedAt:new Date()}});
  await i.redis.set(marker,marker);
  await i.storage.putObject(i.env.S3_BUCKET,marker,Buffer.from(marker));
  await i.prisma.$transaction(async tx => {
    await expectPostgresPermissionDenied(() => tx.$executeRawUnsafe('CREATE TABLE public.unauthorized_probe (id int)'));
  });
  await expectPostgresPermissionDenied(() => i.prisma.$executeRawUnsafe('UPDATE "InfrastructureState" SET version = version'));
  await expectPostgresPermissionDenied(() => i.prisma.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"'));
  await expectS3AccessDenied(() => i.storage.makeBucket(marker));
  const anonymous=await fetch(i.env.S3_ENDPOINT+'/'+i.env.S3_BUCKET+'/'+marker);
  if(anonymous.status!==403 || !(await anonymous.text()).includes('<Code>AccessDenied</Code>'))throw Error('EXPECTED_ANONYMOUS_ACCESS_DENIED');
`));
pass('runtime DDL and bucket administration denied; anonymous object read denied');
const readHeartbeat = () => remote('api', program(`const h=await i.prisma.workerHeartbeat.findUnique({where:{id:'worker'}});if(!h)throw Error('MISSING_HEARTBEAT');console.log(h.updatedAt.toISOString());`)).trim();
const heartbeatBeforeRestart = readHeartbeat();
assert.ok(Number.isFinite(Date.parse(heartbeatBeforeRestart)), 'valid pre-restart heartbeat required');
compose('restart', 'postgres', 'redis', 'minio', 'mailpit');
compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis', 'minio', 'mailpit');
// A second baseline prevents a write in the pre-restart capture/stop gap from passing.
const heartbeatAtRecoveryStart = readHeartbeat();
assert.ok(Number.isFinite(Date.parse(heartbeatAtRecoveryStart)), 'valid recovery baseline required');
remote('api', program(`
  if(!await i.prisma.workerHeartbeat.findUnique({where:{id:marker}}))throw Error('DB_MARKER_LOST');
  if(await i.redis.get(marker)!==marker)throw Error('REDIS_MARKER_LOST');
  const stream=await i.storage.getObject(i.env.S3_BUCKET,marker);const chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  if(Buffer.concat(chunks).toString()!==marker)throw Error('OBJECT_MARKER_LOST');
  await i.prisma.workerHeartbeat.delete({where:{id:marker}});
  await i.redis.del(marker);await i.storage.removeObject(i.env.S3_BUCKET,marker);
`));
pass('PostgreSQL, Redis and object contents survive restart; synthetic probes removed');
// Require an actual post-restart write, not a merely recent old timestamp.
await pollUntil(async () => {
  const current = readHeartbeat();
  return isNewHeartbeat(heartbeatBeforeRestart, current) && isNewHeartbeat(heartbeatAtRecoveryStart, current);
}, {
  timeoutMs: 30000, intervalMs: 1000, label: 'a persisted heartbeat newer than both pre-restart and post-restart baselines',
});
remote('worker', "fetch('http://localhost:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");
pass('worker persists a strictly newer heartbeat after restart');
await pollUntil(async () => {
  const states = compose('ps', '-a', '--format', 'json').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  // A missing/extra service is a hard failure; only health transitions may be polled.
  assert.deepEqual(states.map(state => state.Service).sort(), expectedServices);
  if (states.some(state => state.Service !== 'minio-init' && (state.State !== 'running' || state.Health !== 'healthy'))) return false;
  assertCompleteServices(states);
  return true;
}, { timeoutMs: 30000, label: 'all eight running services healthy and minio-init exited zero' });
pass('exactly nine services present; eight healthy and initializer exited zero');
