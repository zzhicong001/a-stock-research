/**
 * 全部A股日K线批量拉取 - 优化版
 * 高并发 + HTTP连接复用 + 断点续传
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CRED_PATH = path.join(process.env.USERPROFILE,
  '.workbuddy/connectors/4e33476c-21c7-41b8-8cd1-aafe35dcae68/.credentials.json');
const DIR = path.join(__dirname, 'kline_data');
const OUT = path.join(DIR, 'all_klines.ndjson');
const CODES = path.join(DIR, 'all_codes.json');
const PROG = path.join(DIR, 'progress.json');
const SUM = path.join(DIR, 'summary.json');

const CONC = 20;       // 并发数
const WANT = 250;       // K线数量
const TIMEOUT = 20000;  // 单次请求超时

function token() {
  return JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'))
    .mcpOAuth['tdx-connector|e84038daa8bb14a9'].accessToken;
}

// 复用 Agent
const agent = new https.Agent({ keepAlive: true, maxSockets: CONC * 2, rejectUnauthorized: false });

function call(tk, sid, tool, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: { name: tool, arguments: args }
    });
    const req = https.request({
      hostname: 'txmcp.tdx.com.cn', port: 3001, path: '/txmcp', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + tk,
        'mcp-session-id': sid
      },
      agent, timeout: TIMEOUT
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        for (const line of d.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const j = JSON.parse(line.substring(6));
              if (j.error) reject(new Error(j.error.message || 'err'));
              else resolve(j.result);
              return;
            } catch (_) {}
          }
        }
        try { resolve(JSON.parse(d).result); }
        catch (e) { reject(new Error('Parse: ' + d.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body); req.end();
  });
}

async function initSession(tk) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'k', version: '1' } }
    });
    const req = https.request({
      hostname: 'txmcp.tdx.com.cn', port: 3001, path: '/txmcp', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + tk
      },
      agent, timeout: 15000
    }, (res) => {
      let sid = res.headers['mcp-session-id'];
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (!sid) reject(new Error('No session'));
        else resolve(sid);
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function parseKline(r) {
  const sc = r.structuredContent;
  if (!sc?.ListItem) return null;
  return sc.ListItem.map(item => {
    const it = item.Item;
    return [it[0], +it[2], +it[3], +it[4], +it[5], +it[8]];
  });
}

async function batch(tk, sid, stocks) {
  const tasks = stocks.map(s => {
    const m = { '0': '0', '1': '1', '2': '2' };
    return call(tk, sid, 'tdx_kline', {
      code: s.code, setcode: m[s.market] || '0',
      period: '4', wantNum: String(WANT), tqFlag: '11', hasAttachInfo: '0'
    }).then(r => {
      const k = parseKline(r);
      return k ? { ...s, klines: k, count: k.length } : { ...s, error: 'parse' };
    }).catch(e => ({ ...s, error: 'call' }));
  });
  return Promise.all(tasks);
}

async function main() {
  console.log('=== 批量拉取K线 (优化版) ===');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const stocks = JSON.parse(fs.readFileSync(CODES, 'utf8')).stocks;
  
  let done = 0;
  if (fs.existsSync(PROG)) done = JSON.parse(fs.readFileSync(PROG, 'utf8')).done || 0;
  if (done > 0) console.log(`续传: 已完成 ${done}/${stocks.length}`);

  const tk = token();
  let sid = await initSession(tk);
  console.log(`会话: ${sid}`);

  const stream = fs.createWriteStream(OUT, done === 0 ? {} : { flags: 'a' });
  let ok = 0, err = 0;
  const t0 = Date.now();

  for (let i = done; i < stocks.length; i += CONC) {
    const chunk = stocks.slice(i, i + CONC);
    let results;
    
    try {
      results = await batch(tk, sid, chunk);
    } catch (e) {
      if (e.message.includes('session') || e.message.includes('err')) {
        console.log('  重建会话...');
        sid = await initSession(tk);
        try { results = await batch(tk, sid, chunk); }
        catch (e2) { results = chunk.map(s => ({ ...s, error: 'fail' })); }
      } else {
        results = chunk.map(s => ({ ...s, error: 'fail' }));
      }
    }

    for (const r of results) {
      stream.write(JSON.stringify(r) + '\n');
      r.error ? err++ : ok++;
    }

    const cur = Math.min(i + CONC, stocks.length);
    fs.writeFileSync(PROG, JSON.stringify({ done: cur, ok, err, time: new Date().toISOString() }));

    const pct = Math.round(cur / stocks.length * 100);
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    const eta = cur > 0 ? (el / cur * (stocks.length - cur)).toFixed(0) : '?';
    console.log(`  [${pct}%] ${cur}/${stocks.length} ✓${ok} ✗${err} ${el}s ETA:${eta}s`);
  }

  stream.end();
  
  const total = ((Date.now() - t0) / 1000).toFixed(0);
  fs.writeFileSync(SUM, JSON.stringify({
    time: new Date().toISOString(), total: stocks.length, ok, err,
    period: 'daily', count: WANT, adjust: '前复权', elapsed: total + 's'
  }, null, 2));
  
  console.log(`\n✅ 完成! ${ok}/${stocks.length} | 耗时 ${total}s | ${OUT}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
