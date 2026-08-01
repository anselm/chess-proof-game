// static server + /api/vision (board screenshot → FEN, via a vision model)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8000);
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.SA_MODEL || 'claude-fable-5';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png' };

const PROMPT = `Read this chess diagram and reply with ONLY a FEN board field (the piece placement part,
ranks 8→1 separated by /, uppercase = white, lowercase = black, digits for empty runs), then a space and
"w" or "b" for side to move if the image indicates it, else "w". No explanation, no code fence.
Work square by square from a8 to h1. Be exact about which squares are occupied.`;

async function vision(buf, mime) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 300,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = j.content.map((c) => c.text || '').join('').trim();
  const m = text.match(/([rnbqkpRNBQKP1-8]+(?:\/[rnbqkpRNBQKP1-8]+){7})(\s+[wb])?/);
  if (!m) throw new Error('no FEN in reply: ' + text.slice(0, 120));
  return `${m[1]}${m[2] ?? ' w'} - -`;
}

// minimal multipart parse: we only ever get one image part
function extractImage(body, contentType) {
  const b = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!b) return null;
  const boundary = Buffer.from('--' + (b[1] ?? b[2]).trim());
  let start = body.indexOf(boundary);
  while (start >= 0) {
    const headEnd = body.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const head = body.slice(start, headEnd).toString();
    const next = body.indexOf(boundary, headEnd);
    if (/filename="/.test(head)) {
      const mime = (head.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] ?? 'image/png').trim();
      return { data: body.slice(headEnd + 4, next - 2), mime };
    }
    start = next;
  }
  return null;
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (code, body, type) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache' }); res.end(body); };

  if (path === '/api/vision' && req.method === 'POST') {
    try {
      if (!KEY) return send(500, JSON.stringify({ error: 'no ANTHROPIC_API_KEY on the server' }), 'application/json');
      const chunks = []; for await (const c of req) chunks.push(c);
      const part = extractImage(Buffer.concat(chunks), req.headers['content-type'] ?? '');
      if (!part) return send(400, JSON.stringify({ error: 'no image found in upload' }), 'application/json');
      const fen = await vision(part.data, part.mime);
      return send(200, JSON.stringify({ fen }), 'application/json');
    } catch (e) { return send(500, JSON.stringify({ error: String(e.message).slice(0, 200) }), 'application/json'); }
  }

  let file = path === '/' ? '/web/index.html' : path;
  if (file.startsWith('/web/') || file.startsWith('/src/') || file === '/version.json') { /* ok */ }
  else file = '/web' + file;
  const full = normalize(join(ROOT, file));
  if (!full.startsWith(ROOT) || !existsSync(full) || extname(full) === '') return send(404, 'not found', 'text/plain');
  send(200, readFileSync(full), MIME[extname(full)] ?? 'application/octet-stream');
}).listen(PORT, () => console.log(`proofgame on :${PORT}${KEY ? '' : ' (no vision key)'}`));
