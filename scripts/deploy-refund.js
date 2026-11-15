'use strict';
// 이월결손금 환급점검을 새 Worker(jangbu-refund)에 배포한다. 라이선스 서버와 별개 프로젝트.
//   JANGBU_REFUND_URL=https://jangbu-refund.<계정>.workers.dev node scripts/deploy-refund.js
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const url = (process.env.JANGBU_REFUND_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+$/.test(url)) { console.error('JANGBU_REFUND_URL이 필요합니다. 예: https://jangbu-refund.<계정>.workers.dev'); process.exit(1); }
const pub = path.join(root, 'refund-site/public');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts });

run(process.execPath, ['scripts/build-legal.js']);
fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(pub, { recursive: true });
// 페이지: 링크 미리보기 주소를 새 주소로, 이용약관 링크를 같은 사이트의 /legal/ 로 바꾼다
const html = fs.readFileSync(path.join(root, 'prototype/refund-check.html'), 'utf8')
  .split('https://jangbu-license.madoo.workers.dev/refund/').join(url + '/')
  .split('../dist-public/legal/').join('/legal/');
fs.writeFileSync(path.join(pub, 'index.html'), html);
fs.copyFileSync(path.join(root, 'og-image.png'), path.join(pub, 'og-image.png'));
fs.cpSync(path.join(root, 'dist-public/legal'), path.join(pub, 'legal'), { recursive: true });
fs.copyFileSync(path.join(root, 'brand/png/home-icon-180.png'), path.join(pub, 'apple-touch-icon.png'));
fs.copyFileSync(path.join(root, 'brand/png/home-icon-192.png'), path.join(pub, 'icon-192.png'));
fs.copyFileSync(path.join(root, 'brand/png/home-icon-512.png'), path.join(pub, 'icon-512.png'));
fs.writeFileSync(path.join(pub, 'manifest.webmanifest'), JSON.stringify({
  name: '이월결손금 환급점검 | 장부선생', short_name: '환급점검', start_url: '/', display: 'browser', background_color: '#f8fafb', theme_color: '#0f9488',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
}));
fs.writeFileSync(path.join(pub, '_headers'), '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
run('npx', ['wrangler', 'deploy'], { cwd: path.join(root, 'refund-site') });
console.log('배포 완료:', url);
