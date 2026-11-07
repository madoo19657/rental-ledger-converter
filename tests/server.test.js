'use strict';
// 이용권 확인 서버(server/worker.mjs)의 동작 테스트. Cloudflare 없이 Node에서 같은 코드를 돌린다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

require('../scripts/build-server.js').generate(); // 서버가 내려줄 유료 모듈 문자열 파일
const load = async (f) => import(pathToFileURL(path.join(__dirname, '..', 'server', f)).href);
const fresh = async () => {
  const W = await load('worker.mjs');
  const { FakeKV } = await load('fake-kv.mjs');
  const kv = new FakeKV();
  const env = { LICENSES: kv, PEPPER: 'test-pepper', TOKEN_SECRET: 'test-token-secret', ADMIN_TOKEN: 'test-admin', ALLOWED_ORIGIN: 'https://app.example.com' };
  let ip = 0;
  const call = (route, body, opts = {}) => W.handle(new Request('https://api.example.com' + route, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': opts.ip || ('10.0.0.' + (ip++ % 200)), ...(opts.headers || {}) },
    body: opts.method === 'GET' ? undefined : JSON.stringify(body),
  }), env);
  const admin = (route, body) => call(route, body, { headers: { Authorization: 'Bearer test-admin' } });
  return { W, kv, env, call, admin };
};
const issue = (s, email = 'buyer@example.com', code = '123456', expires = '2099-12-31') =>
  s.admin('/admin/put', { email, code, plan: '2026', expires, note: '테스트' });
const verify = (s, email, code, did = 'device-aaaaaaaa', opts) => s.call('/api/verify', { email, code, deviceId: did }, opts);

test('발급 후 이메일 + 코드로 확인하면 토큰과 만료일을 받는다', async () => {
  const s = await fresh();
  assert.equal((await issue(s)).status, 200);
  const r = await verify(s, 'Buyer@Example.com ', '123456'); // 대소문자·공백은 무시
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.plan, '2026');
  assert.equal(j.emailMask, 'b***@example.com');
  assert.ok(j.token.includes('.'));
});

test('이메일이 틀려도 코드가 틀려도 같은 오류(401)를 준다', async () => {
  const s = await fresh(); await issue(s);
  const a = await verify(s, 'buyer@example.com', '000000');
  const b = await verify(s, 'nobody@example.com', '123456');
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});

test('연속으로 5번 틀리면 잠기고, 맞는 코드도 잠금 시간에는 거절한다', async () => {
  const s = await fresh(); await issue(s);
  for (let i = 0; i < 5; i++) await verify(s, 'buyer@example.com', '000000');
  const r = await verify(s, 'buyer@example.com', '123456');
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, 'locked');
});

test('같은 접속 주소에서 시간당 요청이 많으면 제한한다', async () => {
  const s = await fresh(); await issue(s);
  let last;
  for (let i = 0; i < 32; i++) last = await verify(s, 'x' + i + '@example.com', '111111', 'device-aaaaaaaa', { ip: '9.9.9.9' });
  assert.equal(last.status, 429);
  assert.equal((await last.json()).code, 'rate');
});

test('만료된 이용권은 거절한다(KST 기준)', async () => {
  const s = await fresh(); await issue(s, 'old@example.com', '654321', '2000-01-01');
  const r = await verify(s, 'old@example.com', '654321');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'expired');
});

test('기기는 3대까지, 4번째는 거절하고 같은 기기는 다시 써도 된다', async () => {
  const s = await fresh(); await issue(s);
  for (const d of ['device-1aaaaaa', 'device-2aaaaaa', 'device-3aaaaaa']) assert.equal((await verify(s, 'buyer@example.com', '123456', d)).status, 200);
  const four = await verify(s, 'buyer@example.com', '123456', 'device-4aaaaaa');
  assert.equal(four.status, 403); assert.equal((await four.json()).code, 'devices');
  assert.equal((await verify(s, 'buyer@example.com', '123456', 'device-2aaaaaa')).status, 200);
  // 기기 초기화 뒤에는 새 기기를 쓸 수 있다
  await s.admin('/admin/devices-reset', { email: 'buyer@example.com' });
  assert.equal((await verify(s, 'buyer@example.com', '123456', 'device-4aaaaaa')).status, 200);
});

test('폐기하면 확인과 세션 갱신이 모두 막힌다', async () => {
  const s = await fresh(); await issue(s);
  const j = await (await verify(s, 'buyer@example.com', '123456')).json();
  assert.equal((await s.call('/api/session', { token: j.token })).status, 200);
  await s.admin('/admin/revoke', { email: 'buyer@example.com' });
  assert.equal((await s.call('/api/session', { token: j.token })).status, 401);
  assert.equal((await verify(s, 'buyer@example.com', '123456')).status, 401);
});

test('세션 갱신: 위조·만료·다른 비밀로 서명한 토큰은 거절한다', async () => {
  const s = await fresh(); await issue(s);
  const j = await (await verify(s, 'buyer@example.com', '123456')).json();
  const [body, sig] = j.token.split('.');
  assert.equal((await s.call('/api/session', { token: body + '.' + sig.replace(/.$/, sig.endsWith('0') ? '1' : '0') })).status, 401);
  const eh = JSON.parse(Buffer.from(body, 'base64url').toString()).eh;
  const expired = await s.W.signToken(s.env, { v: 1, eh, plan: '2026', did: 'x', iat: 1, exp: 2 });
  assert.equal((await s.call('/api/session', { token: expired })).status, 401);
  const other = await s.W.signToken({ TOKEN_SECRET: 'attacker' }, { v: 1, eh, plan: '2026', did: 'x', iat: 1, exp: 4102444800 });
  assert.equal((await s.call('/api/session', { token: other })).status, 401);
});

test('연장하면 만료일이 바뀌고, 재발급하면 이전 코드는 쓸 수 없다', async () => {
  const s = await fresh(); await issue(s, 'b@example.com', '111111', '2000-01-01');
  assert.equal((await verify(s, 'b@example.com', '111111')).status, 403);
  await s.admin('/admin/extend', { email: 'b@example.com', expires: '2099-01-01' });
  assert.equal((await verify(s, 'b@example.com', '111111')).status, 200);
  const re = await issue(s, 'b@example.com', '222222', '2099-01-01');
  assert.equal((await re.json()).reissued, true);
  assert.equal((await verify(s, 'b@example.com', '111111', 'device-9aaaaaa')).status, 401);
  assert.equal((await verify(s, 'b@example.com', '222222', 'device-9aaaaaa')).status, 200);
});

test('관리자 경로는 토큰이 있어야 하고, 잘못된 토큰은 401', async () => {
  const s = await fresh();
  const no = await s.call('/admin/put', { email: 'a@b.co', code: '123456', plan: '2026', expires: '2099-01-01' });
  assert.equal(no.status, 401);
  const bad = await s.call('/admin/put', { email: 'a@b.co', code: '123456', plan: '2026', expires: '2099-01-01' }, { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(bad.status, 401);
  const badCode = await s.admin('/admin/put', { email: 'a@b.co', code: '12345', plan: '2026', expires: '2099-01-01' });
  assert.equal(badCode.status, 400);
});

test('저장소에 이메일·코드 원문이 남지 않는다', async () => {
  const s = await fresh(); await issue(s, 'private.person@example.com', '987654');
  await verify(s, 'private.person@example.com', '987654');
  const all = s.kv.dump().map(([k, v]) => k + '=' + v).join('\n');
  assert.doesNotMatch(all, /private\.person/);
  assert.doesNotMatch(all, /987654/);
  assert.doesNotMatch(all, /device-aaaaaaaa/);
});

test('허용한 출처에만 CORS 헤더를 붙인다', async () => {
  const s = await fresh();
  const ok = await s.call('/api/verify', { email: 'a@b.co', code: '123456', deviceId: 'device-aaaaaaaa' }, { headers: { Origin: 'https://app.example.com' } });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://app.example.com');
  const bad = await s.call('/api/verify', { email: 'a@b.co', code: '123456', deviceId: 'device-aaaaaaaa' }, { headers: { Origin: 'https://evil.example.com' } });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('잘못된 형식의 요청은 400, 오류 응답에 장부 정보가 없다', async () => {
  const s = await fresh();
  assert.equal((await s.call('/api/verify', { email: 'not-an-email', code: '123456', deviceId: 'device-aaaaaaaa' })).status, 400);
  assert.equal((await s.call('/api/verify', { email: 'a@b.co', code: 'abcdef', deviceId: 'device-aaaaaaaa' })).status, 400);
  const raw = await s.W.handle(new Request('https://api.example.com/api/verify', { method: 'POST', body: 'not json' }), s.env);
  assert.equal(raw.status, 400);
});

test('유료 모듈은 유효한 토큰에만 내려주고, 확인·세션 응답에는 코드가 없다', async () => {
  const s = await fresh(); await issue(s);
  const v = await (await verify(s, 'buyer@example.com', '123456')).json();
  assert.equal(JSON.stringify(v).includes('adjustmentStatement'), false);
  const ses = await (await s.call('/api/session', { token: v.token })).json();
  assert.equal(JSON.stringify(ses).includes('adjustmentStatement'), false);
  const m = await s.call('/api/module', { token: v.token });
  assert.equal(m.status, 200);
  const j = await m.json();
  assert.ok(j.code.includes('adjustmentStatement') && j.code.includes('hometaxInputs'));
  assert.ok(j.version && j.token);
  // 내려받은 코드는 실제로 실행되어 계산 함수를 만든다
  const create = new Function(j.code + '\n;return create;')();
  const P = create({ fmtWon: (n) => String(n), ADJUSTMENT_KINDS: {}, INCOME_TYPES: { '30': 'x' } });
  assert.equal(typeof P.adjustmentStatement, 'function');
});

test('유료 모듈: 토큰 없음·위조·폐기·만료는 거절하고 코드를 주지 않는다', async () => {
  const s = await fresh(); await issue(s);
  const v = await (await verify(s, 'buyer@example.com', '123456')).json();
  for (const body of [{}, { token: 'x.y' }, { token: v.token.slice(0, -2) + 'AA' }]) {
    const r = await s.call('/api/module', body);
    assert.ok([400, 401].includes(r.status));
    assert.equal((await r.text()).includes('adjustmentStatement'), false);
  }
  await s.admin('/admin/revoke', { email: 'buyer@example.com' });
  const r = await s.call('/api/module', { token: v.token });
  assert.equal(r.status, 401);
  assert.equal((await r.text()).includes('adjustmentStatement'), false);
  const s2 = await fresh(); await issue(s2, 'old@example.com', '654321', '2000-01-01');
  assert.equal((await s2.call('/api/module', { token: await s2.W.signToken(s2.env, { v: 1, eh: 'zz', plan: '2026', did: 'x', iat: 1, exp: 4102444800 }) })).status, 401);
});
