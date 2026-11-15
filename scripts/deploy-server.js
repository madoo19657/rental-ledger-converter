'use strict';
// 장부선생 사이트(대문 + 장부변환 + 환급점검)와 이용권 서버를 한 번에 Cloudflare에 배포한다 (같은 주소로 서비스).
//   JANGBU_SERVER_URL=https://jangbu.madoo.kr [JANGBU_PURCHASE_URL=...] [JANGBU_QUOTE_URL=...] node scripts/deploy-server.js
//   --dry 를 붙이면 server/public 까지만 만들고 올리지 않는다 (로컬 확인용)
// 주소 구성: /  대문(제품 메뉴) · /convert/  장부변환 · /refund/  환급점검 · /legal/  약관 · /api/*  이용권 서버
// 순서: 공개 빌드(서버 주소 포함) → 개인 값 검사 → 유료 모듈 묶기 → server/public 구성 → wrangler deploy
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dry = process.argv.includes('--dry');
const url = (process.env.JANGBU_SERVER_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+$/.test(url)) { console.error('JANGBU_SERVER_URL이 필요합니다. 예: https://jangbu.madoo.kr'); process.exit(1); }
const quoteUrl = (process.env.JANGBU_QUOTE_URL || 'https://quote-maker.madoo.workers.dev').replace(/\/+$/, '');
const OLD = 'https://jangbu-license.madoo.workers.dev'; // 원본 파일의 미리보기 태그에 적힌 주소. 배포 주소로 바꿔 넣는다
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts });
const pub = (...p) => path.join(root, 'server/public', ...p);
const src = (...p) => path.join(root, ...p);
const copy = (from, ...to) => { fs.mkdirSync(path.dirname(pub(...to)), { recursive: true }); fs.copyFileSync(src(from), pub(...to)); };
const write = (text, ...to) => { fs.mkdirSync(path.dirname(pub(...to)), { recursive: true }); fs.writeFileSync(pub(...to), text); };
const page = (file) => fs.readFileSync(src(file), 'utf8').split(OLD).join(url);
// 홈 화면에 추가했을 때 쓰는 아이콘과 매니페스트를 한 폴더에 놓는다
const icons = (dir, prefix, manifest) => {
  copy(`brand/png/${prefix}-180.png`, dir, 'apple-touch-icon.png');
  copy(`brand/png/${prefix}-192.png`, dir, 'icon-192.png');
  copy(`brand/png/${prefix}-512.png`, dir, 'icon-512.png');
  const base = dir ? `/${dir}/` : '/';
  write(JSON.stringify({ ...manifest, start_url: base, scope: base, display: 'browser',
    icons: [{ src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' }] }), dir, 'manifest.webmanifest');
};

run(process.execPath, ['scripts/build.js', '--public'], { env: { ...process.env, JANGBU_LICENSE_ENDPOINT: url } });
run(process.execPath, ['scripts/check-public.js']); // 실패하면 여기서 멈춘다
run(process.execPath, ['scripts/build-legal.js']);
run(process.execPath, ['scripts/build-server.js']);
fs.rmSync(pub(), { recursive: true, force: true });
fs.mkdirSync(pub(), { recursive: true });
fs.cpSync(src('dist-public/legal'), pub('legal'), { recursive: true });

// 대문: 제품 메뉴
write(page('src/landing.html').split('__SITE_URL__').join(url).split('__QUOTE_URL__').join(quoteUrl), 'index.html');
copy('og-image-site.png', 'og-image.png');
icons('', 'site-icon', { name: '장부선생', short_name: '장부선생', background_color: '#f4f2ed', theme_color: '#f4f2ed' });
copy('brand/png/home-icon-192.png', 'icons', 'convert.png');
copy('brand/png/refund-icon-192.png', 'icons', 'refund.png');
copy('brand/png/quote-icon-192.png', 'icons', 'quote.png');

// 장부변환: /convert/ (약관 링크가 상대 경로라 약관도 같은 폴더 아래에 둔다)
write(page('dist-public/index.html'), 'convert', 'index.html');
copy('og-image-main.png', 'convert', 'og-image.png'); // 링크 미리보기 이미지
fs.cpSync(src('dist-public/legal'), pub('convert', 'legal'), { recursive: true });
icons('convert', 'home-icon', { name: '장부선생 장부변환', short_name: '장부변환', background_color: '#1f5f5b', theme_color: '#1f5f5b' });

// 환급점검: /refund/ (단일 HTML 프로토타입). 약관 링크는 /legal/ 로, 아이콘·매니페스트는 /refund/ 아래 것으로 바꾼다
write(page('prototype/refund-check.html').split('../dist-public/legal/').join('/legal/')
  .split('href="/apple-touch-icon.png"').join('href="/refund/apple-touch-icon.png"')
  .split('href="/manifest.webmanifest"').join('href="/refund/manifest.webmanifest"'), 'refund', 'index.html');
copy('og-image.png', 'refund', 'og-image.png'); // 카카오톡·메신저 링크 미리보기 이미지
icons('refund', 'refund-icon', { name: '이월결손금 환급점검 | 장부선생', short_name: '환급점검', background_color: '#f8fafb', theme_color: '#e8753b' });

write('/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n', '_headers');
if (dry) { console.log('구성만 함(올리지 않음):', pub()); process.exit(0); }
run('npx', ['wrangler', 'deploy'], { cwd: src('server') });
console.log('배포 완료:', url);
