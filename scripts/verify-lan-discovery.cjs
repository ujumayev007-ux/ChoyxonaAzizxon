const { spawn } = require('child_process');
const d = require(require('path').join(__dirname, '..', 'desktop', 'discovery.js'));
const assert = require('assert');
(async () => {
  const env = { ...process.env, PORT: '3917', DISCOVERY_PORT: '41999', DATA_DIR: '/tmp/cx-data', RESTAURANT_NAME: 'Test', DATABASE_URL: process.env.DATABASE_URL || 'postgresql://x:y@127.0.0.1:1/x' };
  const srv = spawn('node', ['-e', `
    const dgram=require('./dist/utils/lan-discovery.js');
    const s=dgram.startLanDiscovery(3917);
    const http=require('http');
    http.createServer((q,r)=>r.end(JSON.stringify(dgram.getServerIdentity(3917)))).listen(3917);
  `], { cwd: require('path').resolve(__dirname, '..'), env });
  await new Promise(r => setTimeout(r, 1500));
  const udp = await d.discoverUdp(1200, 41999, ['127.0.0.1']);
  assert.strictEqual(udp.length, 1); assert.strictEqual(udp[0].port, 3917);
  const id = udp[0].serverId;
  const http = await d.probeHttp('http://127.0.0.1:3917');
  assert.strictEqual(http.serverId, id);
  let r = await d.findServer({ pinnedServerId: id, udpPort: 41999, udpTargets: ['127.0.0.1'], timeoutMs: 1000 });
  assert.strictEqual(r.server.serverId, id);
  r = await d.findServer({ pinnedServerId: 'other-restaurant', udpPort: 41999, udpTargets: ['127.0.0.1'], timeoutMs: 1000 });
  assert.strictEqual(r.server, null);
  assert.strictEqual((await d.probeHttp('http://127.0.0.1:1')), null);
  console.log('DISCOVERY TESTS OK', udp[0].url);
  srv.kill();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
