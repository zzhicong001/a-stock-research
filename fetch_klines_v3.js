/**
 * K线批量拉取 v3 - 会话自动刷新 + 重试
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const CRED = path.join(process.env.USERPROFILE, '.workbuddy/connectors/4e33476c-21c7-41b8-8cd1-aafe35dcae68/.credentials.json');
const DIR = path.join(__dirname, 'kline_data');
const OUT = path.join(DIR, 'all_klines.ndjson');
const CODES = path.join(DIR, 'all_codes.json');

const CONC = 15;
const WANT = 250;
const SESSION_REFRESH = 200; // 每200只刷新会话
const agent = new https.Agent({ keepAlive: true, maxSockets: CONC * 2, rejectUnauthorized: false });

function tk() { return JSON.parse(fs.readFileSync(CRED, 'utf8')).mcpOAuth['tdx-connector|e84038daa8bb14a9'].accessToken; }

function req(sid, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + tk() };
    if (sid) h['mcp-session-id'] = sid;
    const r = https.request({ hostname: 'txmcp.tdx.com.cn', port: 3001, path: '/txmcp', method: 'POST', headers: h, agent, timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        for (const l of d.split('\n')) {
          if (l.startsWith('data: ')) {
            try { const j = JSON.parse(l.substring(6)); resolve({ result: j.result, sid: res.headers['mcp-session-id'] }); return; }
            catch (_) {}
          }
        }
        try { resolve({ result: JSON.parse(d).result, sid: res.headers['mcp-session-id'] }); }
        catch (e) { reject(new Error('Parse')); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
    r.write(b); r.end();
  });
}

async function newSession() {
  const { result, sid } = await req(null, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'v3', version: '1' } }
  });
  return sid;
}

async function kline(sid, code, setcode) {
  const { result } = await req(sid, {
    jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
    params: { name: 'tdx_kline', arguments: { code, setcode, period: '4', wantNum: String(WANT), tqFlag: '11', hasAttachInfo: '0' } }
  });
  const sc = result.structuredContent;
  if (!sc?.ListItem) return null;
  return sc.ListItem.map(item => [item.Item[0], +item.Item[2], +item.Item[3], +item.Item[4], +item.Item[5], +item.Item[8]]);
}

async function main() {
  console.log('=== K线拉取 v3 ===');
  const stocks = JSON.parse(fs.readFileSync(CODES, 'utf8')).stocks;
  console.log(`总计: ${stocks.length} 只`);

  // 已完成的代码
  const done = new Set();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (!j.error && j.klines && j.klines.length > 0) done.add(j.code);
      } catch (_) {}
    }
  }
  console.log(`已完成: ${done.size} 只`);

  const todo = stocks.filter(s => !done.has(s.code));
  console.log(`待拉取: ${todo.length} 只\n`);

  if (todo.length === 0) { console.log('全部完成!'); return; }

  let sid = await newSession();
  console.log(`初始会话: ${sid}`);
  
  const stream = fs.createWriteStream(OUT, done.size > 0 ? { flags: 'a' } : {});
  let ok = 0, err = 0;
  const t0 = Date.now();

  for (let i = 0; i < todo.length; i += CONC) {
    // 每200只刷新会话
    if (i > 0 && i % SESSION_REFRESH === 0) {
      console.log(`  刷新会话...`);
      sid = await newSession();
    }

    const chunk = todo.slice(i, i + CONC);
    const tasks = chunk.map(s => {
      const m = { '0': '0', '1': '1', '2': '2' };
      return kline(sid, s.code, m[s.market] || '0')
        .then(k => k ? { ...s, klines: k, count: k.length } : { ...s, error: 'empty' })
        .catch(e => ({ ...s, error: 'fail' }));
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      stream.write(JSON.stringify(r) + '\n');
      r.error ? err++ : ok++;
    }

    const cur = Math.min(i + CONC, todo.length);
    const pct = Math.round(cur / todo.length * 100);
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    const eta = cur > 0 ? (el / cur * (todo.length - cur)).toFixed(0) : '?';
    if (i % (CONC * 5) === 0 || cur === todo.length) {
      console.log(`  [${pct}%] ${cur}/${todo.length} ✓${ok} ✗${err} ${el}s ETA:${eta}s`);
    }
  }

  stream.end();
  const el = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✅ 完成! ${ok + done.size}/${stocks.length} | ${el}s`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
