'use strict';
// 공개 빌드(dist-public)와 저장소 파일에 개인 값이 들어갔는지 검사한다.
//   node scripts/check-public.js           공개 빌드는 실패(종료 코드 1), 저장소 파일은 경고
//   node scripts/check-public.js --strict  저장소 파일도 실패
// 금지 목록: 내장 패턴(주민번호·전화번호) + config/forbidden.private.txt(한 줄에 하나, 저장소에 올리지 않는 파일)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const strict = process.argv.includes('--strict');

const builtin = [
  { name: '주민등록번호 형태', re: /\b\d{6}-[1-4]\d{6}\b/ },
  { name: '휴대전화 번호 형태', re: /\b01[016789]-?\d{3,4}-?\d{4}\b/ },
  { name: '계좌번호 형태', re: /\b\d{3,6}-\d{2,6}-\d{4,8}(?:-\d{1,3})?\b/ },
];
const listFile = path.join(root, 'config/forbidden.private.txt');
const words = fs.existsSync(listFile)
  ? fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : [];
if (!words.length) console.warn('! config/forbidden.private.txt가 없어 내장 패턴만 검사합니다.');

function scan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const hits = [];
  for (const w of words) {
    const idx = text.indexOf(w);
    if (idx >= 0) hits.push(`금지어 "${w}" (${text.slice(0, idx).split('\n').length}행)`);
  }
  for (const b of builtin) {
    const m = text.match(b.re);
    if (m) hits.push(`${b.name}: ${m[0].slice(0, 4)}…`);
  }
  return hits;
}

// 1) 공개 빌드: 하나라도 있으면 실패
let failed = false;
const built = path.join(root, 'dist-public/index.html');
if (!fs.existsSync(built)) {
  console.error('dist-public/index.html이 없습니다. 먼저 node scripts/build.js --public');
  process.exit(2);
}
const builtHits = scan(built);
// 공개 빌드에는 유료 계산 코드가 들어 있으면 안 된다(이용권 확인 뒤 서버에서만 받는다)
const builtText = fs.readFileSync(built, 'utf8');
for (const sig of ['function adjustmentStatement', 'function hometaxInputs', 'function adjustedRevenueStatement', 'RentalLedgerPaidFactory = ', 'function createRefund', 'lastUsableYear(']) {
  if (builtText.includes(sig)) builtHits.push('유료 계산 코드가 공개 빌드에 들어 있음: ' + sig);
}
console.log(`[공개 빌드] ${builtHits.length ? '실패' : '통과'}: dist-public/index.html`);
builtHits.forEach((h) => console.log('  - ' + h));
if (builtHits.length) failed = true;

// 2) 저장소 파일: 기본은 경고
const targets = [];
const walk = (dir, filter) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'dist-public', 'tests-private', 'scripts-private', 'docs-private', '.git'].includes(e.name)) walk(p, filter); }
    else if (filter(p)) targets.push(p);
  }
};
walk(path.join(root, 'src'), () => true);
walk(path.join(root, 'scripts'), (p) => !p.endsWith('forbidden.private.txt'));
walk(path.join(root, 'tests'), () => true);
walk(path.join(root, 'server'), () => true);
walk(path.join(root, 'brand'), (p) => /\.(svg|html)$/.test(p));
walk(path.join(root, 'docs'), (p) => p.endsWith('.md'));
for (const f of ['config/assumptions.public.json', 'config/tax-params-2025.json', 'samples/sample-ledger.csv', 'README.md', '.gitignore']) {
  const p = path.join(root, f); if (fs.existsSync(p)) targets.push(p);
}
let repoHits = 0;
for (const f of targets) {
  const hits = scan(f);
  if (hits.length) {
    repoHits += hits.length;
    console.log(`[저장소 파일] ${path.relative(root, f)}`);
    hits.forEach((h) => console.log('  - ' + h));
  }
}
console.log(`[저장소 파일] 검사 ${targets.length}개, 발견 ${repoHits}건${repoHits ? (strict ? ' (실패)' : ' (경고: --strict로 실패 처리)') : ''}`);
if (repoHits && strict) failed = true;
process.exit(failed ? 1 : 0);
