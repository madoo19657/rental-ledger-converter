// 로컬 모의 이용권 서버: Cloudflare 없이 server/worker.mjs를 그대로 띄워 화면·관리 스크립트를 시험한다.
//   node scripts/dev-license-server.mjs [포트=8787]
// 메모리 저장이라 끄면 모두 사라진다. http://localhost:포트/ 에서 dist-public 화면이 같이 열린다. 시험용 이용권 하나를 미리 넣어 둔다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FakeKV } from '../server/fake-kv.mjs';

// 유료 모듈 문자열 파일을 최신 소스로 다시 만든 뒤 서버 코드를 불러온다
createRequire(import.meta.url)('./build-server.js').generate();
const { handle } = await import('../server/worker.mjs');

const port = Number(process.argv[2] || 8787);
const kv = new FakeKV();
const env = { LICENSES: kv, PEPPER: 'dev-pepper', TOKEN_SECRET: 'dev-token-secret', ADMIN_TOKEN: 'dev-admin', ALLOWED_ORIGIN: '*' };

// 시험용 이용권: demo@example.com / 123456 (2099-12-31까지)
await handle(new Request('http://x/admin/put', {
  method: 'POST', headers: { Authorization: 'Bearer dev-admin', 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@example.com', code: '123456', plan: '2026', expires: '2099-12-31', note: '로컬 시험' }),
}), env);

const publicHtml = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-public', 'index.html');
http.createServer(async (req, res) => {
  // 같은 주소에서 체험 화면도 내려 준다(브라우저 보안 때문에 file:// 에서는 서버를 부르지 못할 수 있다)
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(publicHtml));
    return;
  }
  // 개인 빌드(dist/index.html)도 로컬에서 시험할 수 있게 연다(이 모의 서버는 내 PC에서만 뜬다)
  if (req.method === 'GET' && req.url === '/__private') {
    const f = path.join(path.dirname(publicHtml), '..', 'dist', 'index.html');
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f)); return; }
  }
  if (req.method === 'GET' && /^\/legal\/[a-z-]+\.html$/.test(req.url)) {
    const f = path.join(path.dirname(publicHtml), req.url);
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f)); return; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request('http://localhost:' + port + req.url, {
    method: req.method, headers: { ...req.headers, 'cf-connecting-ip': req.socket.remoteAddress || '127.0.0.1' },
    body: req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : body,
  }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('모의 이용권 서버: http://localhost:' + port + '  (시험용 이용권 demo@example.com / 123456, 관리자 토큰 dev-admin)'));
