// 장부선생 이용권 확인 서버 (Cloudflare Workers + KV)
//
// 하는 일: 이메일 + 6자리 코드 확인, 단기 토큰 발급·갱신, 관리자 발급·폐기·연장·조회.
// 하지 않는 일: 장부·소득 정보를 받거나 저장하지 않는다. 이메일 원문과 코드 원문도 저장하지 않는다(해시만).
//
// 필요한 설정(wrangler):
//   KV 바인딩  LICENSES
//   비밀값     PEPPER(해시 비밀), TOKEN_SECRET(토큰 서명 비밀), ADMIN_TOKEN(관리자 호출 토큰)
//   변수       ALLOWED_ORIGIN(예: https://내도메인) — 체험 화면이 올라간 주소
//
// 표준 Web API만 쓰므로 Node 20에서도 같은 코드를 테스트할 수 있다(tests/server.test.js).

const enc = new TextEncoder();

import { PAID_JS, PAID_VERSION } from './paid-module.gen.mjs';

export const LIMITS = {
  maxDevices: 3,          // 이용권 하나당 동시 기기 수
  tokenTtlSec: 7 * 24 * 3600, // 토큰 유효기간(7일)
  failLimit: 5,           // 이메일당 연속 실패 허용 횟수
  lockSec: 15 * 60,       // 실패 한도 초과 시 잠금 시간
  ipPerHour: 30,          // 접속 주소당 시간당 요청 수
  bodyMax: 4096,          // 요청 본문 최대 바이트
};

const MSG = {
  badCred: '이메일 또는 코드를 확인해 주세요.',
  locked: '시도 횟수를 넘었습니다. 잠시 뒤 다시 시도해 주세요.',
  rate: '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
  expired: '이용권 기간이 끝났습니다. 새 이용권을 구매해 주세요.',
  devices: '사용 가능한 기기 수(3대)를 넘었습니다. 문의해 주세요.',
  bad: '요청 형식이 올바르지 않습니다.',
};

// ── 암호 도우미 ──
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function hmacHex(secret, msg) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)));
}
function safeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}
const b64 = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(p);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 120;
export const validCode = (c) => /^\d{6}$/.test(String(c || ''));
export const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
export const emailMask = (e) => { const [u, d] = e.split('@'); return (u[0] || '') + '***@' + d; };

const emailHash = (env, email) => hmacHex(env.PEPPER, 'e:' + email);
const codeHash = (env, eh, code) => hmacHex(env.PEPPER, 'c:' + eh + ':' + code);
const deviceHash = async (env, did) => (await hmacHex(env.PEPPER, 'd:' + did)).slice(0, 24);
const ipHash = async (env, ip) => (await hmacHex(env.PEPPER, 'i:' + ip)).slice(0, 24);

// KST 기준 오늘(YYYY-MM-DD)과 만료 시각
export const todayKst = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
const expiryEpoch = (date) => Math.floor(Date.parse(date + 'T23:59:59+09:00') / 1000);

export async function signToken(env, payload) {
  const body = b64(JSON.stringify(payload));
  return body + '.' + (await hmacHex(env.TOKEN_SECRET, 't:' + body));
}
export async function verifyToken(env, token, nowSec = Math.floor(Date.now() / 1000)) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmacHex(env.TOKEN_SECRET, 't:' + body))) return null;
  let p;
  try { p = JSON.parse(unb64(body)); } catch { return null; }
  if (!p || p.v !== 1 || typeof p.exp !== 'number' || p.exp < nowSec) return null;
  return p;
}

// ── KV 도우미 ──
const kvGet = (env, k) => env.LICENSES.get(k, 'json');
const kvPut = (env, k, v, ttl) => env.LICENSES.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined);

async function bumpIp(env, ip) {
  const hour = Math.floor(Date.now() / 3600000);
  const k = `rl:${await ipHash(env, ip)}:${hour}`;
  const cur = (await kvGet(env, k)) || { n: 0 };
  cur.n += 1;
  await kvPut(env, k, cur, 3700);
  return cur.n <= LIMITS.ipPerHour;
}
async function failState(env, eh) { return (await kvGet(env, `fl:${eh}`)) || { n: 0, until: 0 }; }
async function recordFail(env, eh) {
  const s = await failState(env, eh);
  s.n += 1;
  if (s.n >= LIMITS.failLimit) { s.until = Math.floor(Date.now() / 1000) + LIMITS.lockSec; s.n = 0; }
  await kvPut(env, `fl:${eh}`, s, LIMITS.lockSec + 3600);
}
const clearFail = (env, eh) => env.LICENSES.delete(`fl:${eh}`);

// ── 응답 ──
function cors(env, req) {
  const origin = req.headers.get('Origin');
  const allow = env.ALLOWED_ORIGIN || '';
  const h = { 'Vary': 'Origin' };
  if (allow === '*' || (origin && origin === allow)) h['Access-Control-Allow-Origin'] = allow === '*' ? '*' : origin;
  h['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
  h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  h['Access-Control-Max-Age'] = '600';
  return h;
}
function json(env, req, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(env, req) },
  });
}
async function readBody(req) {
  const text = await req.text();
  if (text.length > LIMITS.bodyMax) return null;
  try { const b = JSON.parse(text); return b && typeof b === 'object' ? b : null; } catch { return null; }
}
const clientIp = (req) => req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';

// ── 이용권 확인 ──
async function handleVerify(env, req) {
  const body = await readBody(req);
  if (!body) return json(env, req, 400, { ok: false, msg: MSG.bad });
  const email = normEmail(body.email), code = String(body.code || ''), did = String(body.deviceId || '');
  if (!validEmail(email) || !validCode(code) || did.length < 8 || did.length > 80) return json(env, req, 400, { ok: false, msg: MSG.bad });
  if (!(await bumpIp(env, clientIp(req)))) return json(env, req, 429, { ok: false, code: 'rate', msg: MSG.rate });

  const eh = await emailHash(env, email);
  const fs = await failState(env, eh);
  const nowSec = Math.floor(Date.now() / 1000);
  if (fs.until > nowSec) return json(env, req, 429, { ok: false, code: 'locked', retryAfter: fs.until - nowSec, msg: MSG.locked });

  const rec = await kvGet(env, `lic:${eh}`);
  const ch = await codeHash(env, eh, code); // 이메일이 없어도 같은 계산을 한다(응답 시간 차이를 줄임)
  const okCode = rec && !rec.revoked && safeEqual(ch, rec.codeHash);
  if (!okCode) { await recordFail(env, eh); return json(env, req, 401, { ok: false, msg: MSG.badCred }); }
  if (todayKst() > rec.expires) return json(env, req, 403, { ok: false, code: 'expired', msg: MSG.expired });

  const dh = await deviceHash(env, did);
  rec.devices = rec.devices || [];
  if (!rec.devices.includes(dh)) {
    if (rec.devices.length >= LIMITS.maxDevices) return json(env, req, 403, { ok: false, code: 'devices', msg: MSG.devices });
    rec.devices.push(dh);
    rec.updatedAt = nowSec;
    await kvPut(env, `lic:${eh}`, rec);
  }
  await clearFail(env, eh);
  const exp = Math.min(nowSec + LIMITS.tokenTtlSec, expiryEpoch(rec.expires));
  const token = await signToken(env, { v: 1, eh, plan: rec.plan, did: dh, iat: nowSec, exp });
  return json(env, req, 200, { ok: true, plan: rec.plan, expires: rec.expires, emailMask: emailMask(email), token, tokenExp: exp });
}

// 토큰 갱신: 클라이언트가 주기적으로 호출해 폐기·만료·기기 해제를 반영한다
// 토큰과 이용권 상태를 확인하고, 통과하면 기록과 토큰 내용을 돌려준다. 실패하면 응답(res)을 돌려준다.
async function checkSession(env, req) {
  const body = await readBody(req);
  if (!body) return { res: json(env, req, 400, { ok: false, msg: MSG.bad }) };
  if (!(await bumpIp(env, clientIp(req)))) return { res: json(env, req, 429, { ok: false, code: 'rate', msg: MSG.rate }) };
  const p = await verifyToken(env, body.token);
  if (!p) return { res: json(env, req, 401, { ok: false, code: 'token', msg: '다시 이용권을 입력해 주세요.' }) };
  const rec = await kvGet(env, `lic:${p.eh}`);
  if (!rec || rec.revoked) return { res: json(env, req, 401, { ok: false, code: 'revoked', msg: '이용권을 확인할 수 없습니다.' }) };
  if (todayKst() > rec.expires) return { res: json(env, req, 403, { ok: false, code: 'expired', msg: MSG.expired }) };
  if (!(rec.devices || []).includes(p.did)) return { res: json(env, req, 401, { ok: false, code: 'device', msg: '다시 이용권을 입력해 주세요.' }) };
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Math.min(nowSec + LIMITS.tokenTtlSec, expiryEpoch(rec.expires));
  const token = await signToken(env, { v: 1, eh: p.eh, plan: rec.plan, did: p.did, iat: nowSec, exp });
  return { rec, token, exp };
}
async function handleSession(env, req) {
  const s = await checkSession(env, req);
  if (s.res) return s.res;
  return json(env, req, 200, { ok: true, plan: s.rec.plan, expires: s.rec.expires, token: s.token, tokenExp: s.exp });
}
// 유료 계산 모듈: 유효한 이용권 토큰에만 코드를 내려준다. 화면은 받은 코드를 메모리에서만 실행한다.
async function handleModule(env, req) {
  const s = await checkSession(env, req);
  if (s.res) return s.res;
  return json(env, req, 200, { ok: true, plan: s.rec.plan, expires: s.rec.expires, token: s.token, tokenExp: s.exp, version: PAID_VERSION, code: PAID_JS });
}

// ── 관리자 ──
async function adminAuth(env, req) {
  const auth = req.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.ADMIN_TOKEN || !safeEqual(given, env.ADMIN_TOKEN)) return false;
  return true;
}
async function handleAdmin(env, req, path) {
  if (!(await adminAuth(env, req))) {
    await bumpIp(env, clientIp(req)); // 관리자 경로 추측도 제한
    return json(env, req, 401, { ok: false, msg: '권한이 없습니다.' });
  }
  const b = await readBody(req);
  if (!b) return json(env, req, 400, { ok: false, msg: MSG.bad });
  const email = normEmail(b.email);
  if (!validEmail(email)) return json(env, req, 400, { ok: false, msg: '이메일 형식이 올바르지 않습니다.' });
  const eh = await emailHash(env, email);
  const key = `lic:${eh}`;
  const rec = await kvGet(env, key);
  const nowSec = Math.floor(Date.now() / 1000);

  if (path === '/admin/put') {
    if (!validCode(b.code)) return json(env, req, 400, { ok: false, msg: '코드는 숫자 6자리입니다.' });
    if (!validDate(b.expires)) return json(env, req, 400, { ok: false, msg: '만료일은 YYYY-MM-DD 형식입니다.' });
    const plan = String(b.plan || '').slice(0, 20);
    if (!plan) return json(env, req, 400, { ok: false, msg: 'plan이 필요합니다(예: 2026).' });
    const next = {
      codeHash: await codeHash(env, eh, String(b.code)), plan, expires: b.expires, note: String(b.note || '').slice(0, 60),
      revoked: false, devices: [], createdAt: rec ? rec.createdAt : nowSec, updatedAt: nowSec,
    };
    await kvPut(env, key, next);
    await clearFail(env, eh);
    return json(env, req, 200, { ok: true, reissued: !!rec });
  }
  if (!rec) return json(env, req, 404, { ok: false, msg: '해당 이메일의 이용권이 없습니다.' });
  if (path === '/admin/revoke') { rec.revoked = true; rec.updatedAt = nowSec; await kvPut(env, key, rec); return json(env, req, 200, { ok: true }); }
  if (path === '/admin/extend') {
    if (!validDate(b.expires)) return json(env, req, 400, { ok: false, msg: '만료일은 YYYY-MM-DD 형식입니다.' });
    rec.expires = b.expires; rec.updatedAt = nowSec; await kvPut(env, key, rec); return json(env, req, 200, { ok: true, expires: rec.expires });
  }
  if (path === '/admin/devices-reset') { rec.devices = []; rec.updatedAt = nowSec; await kvPut(env, key, rec); return json(env, req, 200, { ok: true }); }
  if (path === '/admin/get') {
    return json(env, req, 200, { ok: true, plan: rec.plan, expires: rec.expires, revoked: !!rec.revoked, devices: (rec.devices || []).length, note: rec.note || '', createdAt: rec.createdAt, updatedAt: rec.updatedAt });
  }
  return json(env, req, 404, { ok: false, msg: '없는 경로입니다.' });
}

export async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });
  if (path === '/api/health' && req.method === 'GET') return json(env, req, 200, { ok: true, ts: Math.floor(Date.now() / 1000) });
  if (req.method !== 'POST') return json(env, req, 405, { ok: false, msg: '허용되지 않는 요청입니다.' });
  try {
    if (path === '/api/verify') return await handleVerify(env, req);
    if (path === '/api/session') return await handleSession(env, req);
    if (path === '/api/module') return await handleModule(env, req);
    if (path.startsWith('/admin/')) return await handleAdmin(env, req, path);
  } catch (e) {
    console.log('error', e && e.message); // 개인 정보는 로그에 남기지 않는다
    return json(env, req, 500, { ok: false, msg: '서버 오류입니다. 잠시 뒤 다시 시도해 주세요.' });
  }
  return json(env, req, 404, { ok: false, msg: '없는 경로입니다.' });
}

export default { fetch: (req, env) => handle(req, env) };
