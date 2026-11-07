'use strict';
// 유료 계산 모듈(src/engine-paid.js)을 서버가 내려줄 수 있게 문자열 모듈로 만든다.
//   node scripts/build-server.js   → server/paid-module.gen.mjs (저장소에 올리지 않는다)
// wrangler deploy 전에 실행한다. 이 파일에는 유료 계산 코드가 그대로 들어 있으므로 공개하면 안 된다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const out = path.join(root, 'server', 'paid-module.gen.mjs');

function generate() {
  // 서버가 내려주는 유료 모듈 = 변환 유료 계산(engine-paid) + 환급 점검(refund-check)
  const src = ['engine-paid.js', 'refund-check.js'].map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
  const version = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12);
  fs.writeFileSync(out, `// 자동 생성: node scripts/build-server.js. 직접 고치지 않는다.\nexport const PAID_VERSION = ${JSON.stringify(version)};\nexport const PAID_JS = ${JSON.stringify(src)};\n`);
  return { out, version, bytes: src.length };
}
module.exports = { generate };
if (require.main === module) { const r = generate(); console.log('wrote', r.out, r.bytes + ' bytes', 'version', r.version); }
