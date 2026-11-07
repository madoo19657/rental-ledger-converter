'use strict';
// 체험 화면과 이용권 서버를 한 번에 Cloudflare에 배포한다 (같은 주소로 서비스).
//   JANGBU_SERVER_URL=https://jangbu-license.<계정>.workers.dev [JANGBU_PURCHASE_URL=...] node scripts/deploy-server.js
// 순서: 공개 빌드(서버 주소 포함) → 개인 값 검사 → 유료 모듈 묶기 → server/public 으로 복사 → wrangler deploy
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const url = (process.env.JANGBU_SERVER_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+$/.test(url)) { console.error('JANGBU_SERVER_URL이 필요합니다. 예: https://jangbu-license.<계정>.workers.dev'); process.exit(1); }
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts });

run(process.execPath, ['scripts/build.js', '--public'], { env: { ...process.env, JANGBU_LICENSE_ENDPOINT: url } });
run(process.execPath, ['scripts/check-public.js']); // 실패하면 여기서 멈춘다
run(process.execPath, ['scripts/build-legal.js']);
run(process.execPath, ['scripts/build-server.js']);
fs.mkdirSync(path.join(root, 'server/public'), { recursive: true });
fs.copyFileSync(path.join(root, 'dist-public/index.html'), path.join(root, 'server/public/index.html'));
fs.cpSync(path.join(root, 'dist-public/legal'), path.join(root, 'server/public/legal'), { recursive: true });
// 이월결손금 환급점검(단일 HTML 프로토타입)은 /refund/ 에서 열린다. 이용약관 링크는 같은 사이트의 /legal/ 을 가리키게 바꾼다.
fs.mkdirSync(path.join(root, 'server/public/refund'), { recursive: true });
fs.writeFileSync(path.join(root, 'server/public/refund/index.html'), fs.readFileSync(path.join(root, 'prototype/refund-check.html'), 'utf8').split('../dist-public/legal/').join('/legal/'));
fs.writeFileSync(path.join(root, 'server/public/_headers'), '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
run('npx', ['wrangler', 'deploy'], { cwd: path.join(root, 'server') });
console.log('배포 완료:', url);
