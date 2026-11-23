// 零依赖静态服务器：本地预览 & Playwright webServer 使用
// 同时提供一组 /v1/* 的假模型接口，供端到端用例验证「本地模型」接入，
// 不需要真的跑 llama.cpp / Ollama。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 4180);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-private-network': 'true'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS));
  res.end(body);
}
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

/* ---------- 假模型服务（OpenAI 兼容） ---------- */
async function fakeModel(req, res, path) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return true; }
  if (path === '/v1/models') {
    json(res, 200, { object: 'list', data: [{ id: 'mock-llama', object: 'model' }, { id: 'mock-translator', object: 'model' }] });
    return true;
  }
  if (path === '/v1/chat/completions' && req.method === 'POST') {
    const raw = (await readBody(req)).toString('utf8');
    let payload = [];
    try {
      const body = JSON.parse(raw);
      const userMsg = (body.messages || []).filter(m => m.role === 'user').pop();
      payload = JSON.parse(userMsg.content);
    } catch (e) { }
    const items = (Array.isArray(payload) ? payload : []).map((row, i) => ({ i, tr: 'MOCK:' + String(row.t || '').slice(0, 8) }));
    json(res, 200, {
      id: 'mock', object: 'chat.completion', model: 'mock-llama',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ items }) } }]
    });
    return true;
  }
  if (path === '/v1/audio/transcriptions' && req.method === 'POST') {
    await readBody(req);
    json(res, 200, {
      task: 'transcribe', language: 'zh', duration: 3.02,
      text: '转写一。转写二。',
      segments: [{ id: 0, start: 0, end: 1.4, text: '转写一' }, { id: 1, start: 1.4, end: 3.0, text: '转写二' }]
    });
    return true;
  }
  return false;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/v1/') && await fakeModel(req, res, path)) return;

    const rel = decodeURIComponent(path === '/' ? '/index.html' : path);
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(file);
    if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/index.html (with mock /v1 model API)`);
});
