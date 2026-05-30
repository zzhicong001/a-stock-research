#!/usr/bin/env node
/**
 * 扫描目录下所有研报 .md/.html 文件，自动生成 files.json 清单
 * 用法：node gen_files.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// 不纳入清单的文件（配置类）
const SKIP = new Set([
  'README.md', 'CLOUDFLARE_SETUP.md', 'DEPLOY.md', 'index.html',
  '_headers', '.gitignore', 'gen_files.js', 'gen_files.py', 'files.json'
]);

// 关键词 → 标签映射
const TAG_MAP = [
  { keywords: ['戴尔', 'DELL', 'dell'], tag: '戴尔' },
  { keywords: ['Anthropic', 'anthropic', 'ANTHROPIC'], tag: 'Anthropic' },
  { keywords: ['卖方', '券商', '晨会'], tag: '券商晨会' },
  { keywords: ['特朗普', 'trump', 'Trump'], tag: '特朗普' },
  { keywords: ['AI', '算力', '服务器', 'GPU', 'TPU', '光模块', 'PCB'], tag: 'AI算力' },
  { keywords: ['持仓', '盈亏'], tag: '持仓分析' },
  { keywords: ['概念', '受益', '产业链'], tag: '概念股' },
  { keywords: ['个股', '梳理'], tag: '个股梳理' },
];

function extractTitle(filepath, content) {
  // MD: 找第一个 # 标题
  let m = content.match(/^#\s+(.+)/m);
  if (m) return m[1].trim();
  // HTML: <title> 或 <h1>
  m = content.match(/<title>(.+?)<\/title>/i);
  if (m) return m[1].trim();
  m = content.match(/<h1[^>]*>(.+?)<\/h1>/i);
  if (m) return m[1].trim();
  return path.basename(filepath, path.extname(filepath));
}

function extractDate(filepath) {
  const filename = path.basename(filepath);
  // 标准日期 YYYY-MM-DD
  let m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // 兜底：文件修改时间
  const stat = fs.statSync(filepath);
  const d = new Date(stat.mtime);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function extractDesc(filepath, content) {
  const ext = path.extname(filepath).toLowerCase();
  try {
    if (ext === '.md') {
      const lines = content.split('\n');
      for (const line of lines) {
        const s = line.trim();
        if (!s || s.startsWith('#') || s.startsWith('>') || s.startsWith('---')) continue;
        if (s.startsWith('|')) continue;
        if (s.length > 20) return cutText(s, 100);
        if (s.length > 10) return cutText(s, 100);
      }
    } else if (ext === '.html') {
      let m = content.match(/<meta\s+name="description"\s+content="(.+?)"/i);
      if (m) return m[1].slice(0, 100);
      m = content.match(/<p[^>]*>(.+?)<\/p>/i);
      if (m) {
        const text = m[1].replace(/<[^>]+>/g, '').trim();
        if (text.length > 20) return cutText(text, 100);
      }
    }
  } catch (e) { /* ignore */ }
  return '';
}

function cutText(text, maxLen) {
  text = text.replace(/\*\*/g, '');
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/[，,。、；;：:！!？?]+$/, '') + '…';
}

function autoTags(title, desc, filename) {
  const combined = (title + ' ' + desc + ' ' + filename).toLowerCase();
  const tags = [];
  for (const { keywords, tag } of TAG_MAP) {
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) {
        if (!tags.includes(tag)) tags.push(tag);
        break;
      }
    }
  }
  return tags;
}

function scan() {
  const items = [];
  const files = fs.readdirSync(ROOT);

  for (const name of files.sort()) {
    if (SKIP.has(name)) continue;
    const ext = path.extname(name).toLowerCase();
    if (ext !== '.md' && ext !== '.html') continue;

    const filepath = path.join(ROOT, name);
    const content = fs.readFileSync(filepath, 'utf-8');
    const title = extractTitle(filepath, content);
    const date = extractDate(filepath);
    const desc = extractDesc(filepath, content);
    const tags = autoTags(title, desc, name);
    const ftype = ext.slice(1); // 'md' or 'html'

    items.push({
      filename: name,
      title,
      date,
      desc: desc || title,
      tags,
      type: ftype,
      href: name
    });
  }

  return items;
}

function merge(items) {
  const merged = {};
  for (const item of items) {
    const base = item.filename.replace(/\.(md|html)$/i, '');
    if (!merged[base]) {
      merged[base] = {
        title: item.title,
        date: item.date,
        desc: item.desc,
        tags: item.tags,
        files: []
      };
    }
    const m = merged[base];
    merged[base].files.push({
      name: item.type.toUpperCase(),
      href: item.href,
      type: item.type
    });
    // 取更优的字段
    if (item.title.length > m.title.length) m.title = item.title;
    if (item.desc.length > m.desc.length) m.desc = item.desc;
    if (item.tags.length > m.tags.length) m.tags = item.tags;
    if (item.date && !m.date) m.date = item.date;
  }
  const result = Object.values(merged);
  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}

function main() {
  const items = scan();
  const result = merge(items);

  const outputPath = path.join(ROOT, 'files.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`[OK] 扫描完成，共 ${result.length} 个文档条目 → ${outputPath}`);
  for (const item of result) {
    const ftypes = item.files.map(f => f.name).join('/');
    console.log(`  📄 ${item.title}  [${ftypes}]  ${item.date}`);
  }
}

main();
