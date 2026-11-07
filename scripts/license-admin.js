'use strict';
// 이용권 발급·관리 (운영자 전용). 서버에는 해시만 저장되므로, 이메일·코드 원문은 이 PC의 장부에만 남긴다.
//
//   JANGBU_API=https://...workers.dev JANGBU_ADMIN_TOKEN=... node scripts/license-admin.js <명령> [옵션]
//
//   issue    --email a@b.co [--plan 2026] [--expires 2027-06-30] [--note 주문번호]   새 코드 발급 + 안내 메일 문구 출력
//   reissue  --email a@b.co                       새 코드로 다시 발급(분실·유출). 기기 목록은 초기화됨
//   revoke   --email a@b.co                       폐기(환불·악용)
//   extend   --email a@b.co --expires 2027-12-31  만료일 연장
//   devices-reset --email a@b.co                  등록 기기 초기화(기기 교체)
//   get      --email a@b.co                       서버 상태 조회
//   list                                          이 PC의 발급 장부 목록(서버 호출 없음)
//
// 장부 파일: scripts-private/license-ledger.json (git 제외). 관리자 토큰은 화면에 출력하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEDGER = path.join(__dirname, '..', 'scripts-private', 'license-ledger.json');
const DEFAULT_PLAN = '2026';
const DEFAULT_EXPIRES = '2027-06-30'; // 2026 귀속 신고 시즌까지

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else out._.push(argv[i]);
  }
  return out;
}
function loadLedger() { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return []; } }
function saveLedger(rows) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(rows, null, 2) + '\n');
}
const norm = (e) => String(e || '').trim().toLowerCase();
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

async function api(route, body) {
  const base = process.env.JANGBU_API, tok = process.env.JANGBU_ADMIN_TOKEN;
  if (!base || !tok) throw new Error('환경변수 JANGBU_API, JANGBU_ADMIN_TOKEN이 필요합니다.');
  const r = await fetch(base.replace(/\/+$/, '') + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error('서버 응답 ' + r.status + ': ' + (j.msg || '실패'));
  return j;
}

function mailText(email, code, plan, expires) {
  return [
    '제목: [장부선생] 이용권 코드 안내',
    '',
    '안녕하세요. 장부선생 이용권을 구매해 주셔서 감사합니다.',
    '',
    '이메일: ' + email,
    '6자리 코드: ' + code,
    '이용 기간: ' + plan + '년 귀속 신고 시즌(' + expires + '까지)',
    '',
    '사용 방법',
    '1. 장부선생 화면 위쪽의 "이용권 입력"을 누릅니다.',
    '2. 위 이메일과 6자리 코드를 입력합니다.',
    '3. 한 이용권은 본인 기기 3대까지 쓸 수 있습니다. 코드를 다른 사람과 공유하지 마세요.',
    '',
    '안내',
    '- 장부선생은 입력하신 장부를 서버로 보내지 않고 브라우저 안에서만 계산하는 참고용 계산 도구입니다.',
    '- 세무 상담이나 신고 대행이 아니며, 신고 책임은 신고인에게 있습니다. 신고 전에 세무사 확인을 권합니다.',
    '- 코드를 잃어버리셨거나 기기를 바꾸셨다면 이 메일로 회신해 주세요.',
  ].join('\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  const email = norm(a.email);
  const need = () => { if (!email) throw new Error('--email이 필요합니다.'); };
  const ledger = loadLedger();
  const find = () => ledger.find((r) => r.email === email);

  if (cmd === 'issue' || cmd === 'reissue') {
    need();
    const prev = find();
    if (cmd === 'issue' && prev && !a.force) throw new Error('이미 발급된 이메일입니다. 분실·유출이면 reissue, 정말 새로 발급하려면 --force');
    const plan = String(a.plan || (prev && prev.plan) || DEFAULT_PLAN);
    const expires = String(a.expires || (prev && prev.expires) || DEFAULT_EXPIRES);
    const code = newCode();
    await api('/admin/put', { email, code, plan, expires, note: String(a.note || (prev && prev.note) || '') });
    const row = { email, code, plan, expires, note: String(a.note || (prev && prev.note) || ''), issuedAt: new Date().toISOString(), status: 'active' };
    saveLedger(prev ? ledger.map((r) => (r.email === email ? row : r)) : ledger.concat(row));
    console.log('발급 완료. 아래 안내문을 구매자에게 보내세요.\n');
    console.log(mailText(email, code, plan, expires));
    return;
  }
  if (cmd === 'revoke') { need(); await api('/admin/revoke', { email }); const p = find(); if (p) { p.status = 'revoked'; saveLedger(ledger); } console.log('폐기했습니다.'); return; }
  if (cmd === 'extend') {
    need(); if (!a.expires) throw new Error('--expires가 필요합니다.');
    const j = await api('/admin/extend', { email, expires: String(a.expires) }); const p = find(); if (p) { p.expires = j.expires; saveLedger(ledger); }
    console.log('만료일을 ' + j.expires + '로 바꿨습니다.'); return;
  }
  if (cmd === 'devices-reset') { need(); await api('/admin/devices-reset', { email }); console.log('등록 기기를 초기화했습니다.'); return; }
  if (cmd === 'get') { need(); const j = await api('/admin/get', { email }); console.log(JSON.stringify(j, null, 2)); return; }
  if (cmd === 'list') {
    if (!ledger.length) { console.log('발급 장부가 비어 있습니다.'); return; }
    ledger.forEach((r) => console.log([r.email, r.plan, r.expires, r.status, r.issuedAt.slice(0, 10), r.note || ''].join('\t')));
    return;
  }
  console.log('명령: issue | reissue | revoke | extend | devices-reset | get | list  (파일 맨 위 설명 참고)');
}
main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
