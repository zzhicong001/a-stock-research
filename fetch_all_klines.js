/**
 * 批量获取全部A股近1年日K线数据 - 分阶段执行
 * 阶段1: 获取代码列表 (fetch_codes)
 * 阶段2: 批量拉取K线 (fetch_klines, 支持断点续传)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CRED_PATH = path.join(process.env.USERPROFILE,
  '.workbuddy/connectors/4e33476c-21c7-41b8-8cd1-aafe35dcae68/.credentials.json');
const OUTPUT_DIR = path.join(__dirname, 'kline_data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'all_klines.ndjson');
const CODES_FILE = path.join(OUTPUT_DIR, 'all_codes.json');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'progress.json');
const SUMMARY_FILE = path.join(OUTPUT_DIR, 'summary.json');

const MCP_URL = 'https://txmcp.tdx.com.cn:3001/txmcp';
const CONCURRENCY = 5;
const WANT_NUM = 250;
const BATCH_DELAY = 200;

// ========== 工具函数 ==========

function readToken() {
  return JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'))
    .mcpOAuth['tdx-connector|e84038daa8bb14a9'].accessToken;
}

function httpReq(token, sessionId, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const u = new URL(MCP_URL);
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': 'Bearer ' + token,
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const opts = { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers, rejectUnauthorized: false, timeout: 30000 };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // 解析 SSE
        for (const line of data.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.substring(6));
              resolve({ json, sessionId: res.headers['mcp-session-id'] });
              return;
            } catch (_) {}
          }
        }
        // 纯 JSON 格式
        try { resolve({ json: JSON.parse(data), sessionId: res.headers['mcp-session-id'] }); }
        catch (e) { reject(new Error('Parse: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(b); req.end();
  });
}

async function createSession(token) {
  const { json, sessionId } = await httpReq(token, null, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'klines', version: '1.0' } }
  });
  if (!sessionId) throw new Error('No session');
  return sessionId;
}

async function toolCall(token, sessionId, name, args) {
  const { json } = await httpReq(token, sessionId, {
    jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
    params: { name, arguments: args }
  });
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

// ========== 阶段1: 获取代码 ==========

async function fetchCodes() {
  console.log('=== [阶段1] 获取全部A股代码 ===');
  const token = readToken();
  const sessionId = await createSession(token);
  console.log(`会话: ${sessionId}`);

  if (fs.existsSync(CODES_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    if (cached.total >= 5000) {
      console.log(`使用缓存: ${cached.total} 只`);
      return cached.stocks;
    }
  }

  const stocks = [];
  for (let page = 1; page <= 56; page++) {
    const result = await toolCall(token, sessionId, 'tdx_screener', {
      message: '全部A股', rang: 'AG', pageNo: String(page), pageSize: '100'
    });
    
    const data = result.structuredContent?.data;
    if (!data || data.length === 0) break;
    
    for (const r of data) stocks.push({ code: r.sec_code, name: r.sec_name, market: r.market });
    
    if (page % 10 === 0 || data.length < 100) {
      console.log(`  进度: ${page}/56 页, 累计 ${stocks.length} 只`);
    }
    if (data.length < 100) break;
    await new Promise(r => setTimeout(r, 200));
  }

  fs.writeFileSync(CODES_FILE, JSON.stringify({ total: stocks.length, stocks }));
  console.log(`完成: ${stocks.length} 只 -> ${CODES_FILE}\n`);
  return stocks;
}

// ========== 阶段2: 拉取K线 ==========

async function parseKline(result) {
  const sc = result.structuredContent;
  if (!sc?.ListItem) return null;
  return sc.ListItem.map(item => {
    const it = item.Item;
    return [it[0], parseFloat(it[2]), parseFloat(it[3]), parseFloat(it[4]), parseFloat(it[5]), parseFloat(it[8])];
  });
}

async function fetchBatch(token, sessionId, batch) {
  const results = await Promise.allSettled(
    batch.map(s => {
      const m = { '0': '0', '1': '1', '2': '2' };
      return toolCall(token, sessionId, 'tdx_kline', {
        code: s.code, setcode: m[s.market] || '0',
        period: '4', wantNum: String(WANT_NUM), tqFlag: '11', hasAttachInfo: '0'
      });
    })
  );

  return batch.map((s, i) => {
    if (results[i].status === 'rejected') return { ...s, error: 'fetch' };
    try {
      const k = parseKline(results[i].value);
      return k ? { ...s, klines: k, count: k.length } : { ...s, error: 'parse' };
    } catch (_) {
      return { ...s, error: 'parse' };
    }
  });
}

async function fetchKlines() {
  console.log('=== [阶段2] 批量拉取K线 ===');

  const codes = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  const stocks = codes.stocks;
  
  // 读取进度
  let startIdx = 0;
  if (fs.existsSync(PROGRESS_FILE)) {
    startIdx = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')).done || 0;
    console.log(`从第 ${startIdx + 1} 只续传 (已完成 ${startIdx})`);
  }

  const token = readToken();
  let sessionId = await createSession(token);
  const stream = fs.createWriteStream(OUTPUT_FILE, startIdx === 0 ? {} : { flags: 'a' });

  let completed = 0, errors = 0;
  const t0 = Date.now();

  for (let i = startIdx; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    
    try {
      const results = await fetchBatch(token, sessionId, batch);
      for (const item of results) {
        stream.write(JSON.stringify(item) + '\n');
        item.error ? errors++ : completed++;
      }
    } catch (e) {
      // Session 可能过期，重建
      if (e.message.includes('session') || e.message.includes('401') || e.message.includes('Unauthorized')) {
        console.log(`  重建会话...`);
        sessionId = await createSession(token);
        // 重试
        try {
          const results = await fetchBatch(token, sessionId, batch);
          for (const item of results) {
            stream.write(JSON.stringify(item) + '\n');
            item.error ? errors++ : completed++;
          }
        } catch (e2) {
          console.error(`  批次 ${i}-${i + CONCURRENCY} 失败: ${e2.message}`);
          for (const s of batch) {
            stream.write(JSON.stringify({ ...s, error: 'batch_fail' }) + '\n');
            errors++;
          }
        }
      } else {
        console.error(`  批次错误: ${e.message}`);
        for (const s of batch) {
          stream.write(JSON.stringify({ ...s, error: 'batch_fail' }) + '\n');
          errors++;
        }
      }
    }

    // 保存进度
    const done = Math.min(i + CONCURRENCY, stocks.length);
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ done, completed, errors, updatedAt: new Date().toISOString() }));

    const pct = Math.round(done / stocks.length * 100);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const rate = done > 0 ? (elapsed / done * (stocks.length - done)).toFixed(0) : '?';
    console.log(`  [${pct}%] ${done}/${stocks.length} ✓${completed} ✗${errors} ${elapsed}s | ETA:${rate}s`);

    await new Promise(r => setTimeout(r, BATCH_DELAY));
  }

  stream.end();
  return { completed, errors, time: ((Date.now() - t0) / 1000).toFixed(0) };
}

// ========== 主流程 ==========

const phase = process.argv[2] || 'all';

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (phase === 'codes' || phase === 'all') {
    await fetchCodes();
  }

  if (phase === 'klines' || phase === 'all') {
    const result = await fetchKlines();
    
    const summary = {
      generatedAt: new Date().toISOString(),
      totalStocks: JSON.parse(fs.readFileSync(CODES_FILE, 'utf8')).total,
      success: result.completed, errors: result.errors,
      period: 'daily', count: WANT_NUM, adjust: '前复权',
      file: path.basename(OUTPUT_FILE), time: result.time + 's'
    };
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
    console.log(`\n✅ 完成! 成功:${result.completed} 失败:${result.errors}`);
    console.log(`文件: ${OUTPUT_FILE}`);
    console.log(`汇总: ${SUMMARY_FILE}`);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
