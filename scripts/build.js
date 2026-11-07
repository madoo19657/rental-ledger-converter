'use strict';
// 엔진·설정·샘플·브랜드를 하나의 HTML로 합친다.
//   node scripts/build.js            개인 빌드 → dist/index.html  (개인 설정·사업장 기본값 포함, 잠금 없음, 저장소에 올리지 않는다)
//   node scripts/build.js --public   공개 빌드 → dist-public/index.html  (체험 버전: 일반 예시값만, 이용권 잠금)
// 공개 빌드는 개인 값이 들어갔는지 scripts/check-public.js로 검사한다.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const args = process.argv.slice(2);
const isPublic = args.includes('--public');

const VERSION = '0.1.0';
// 이용권 확인 서버(Phase 1)와 구매 안내 주소. 아직 없으면 비워 둔다.
const LICENSE_ENDPOINT = process.env.JANGBU_LICENSE_ENDPOINT || '';
const PURCHASE_URL = process.env.JANGBU_PURCHASE_URL || '#';

// <script> 안에 JSON을 넣을 때 '<'(</script> 방지)와 줄 구분 문자 U+2028/2029를 이스케이프한다
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

let html = read('src/template.html');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
// 유료 계산 모듈(조정계산서 등 + 환급 점검): 개인 빌드에는 넣고, 공개(체험) 빌드에는 넣지 않는다(이용권 확인 뒤 서버에서 받는다)
const engine = esc(read('src/engine.js')) + (isPublic ? '' : '\n' + esc(read('src/engine-paid.js')) + '\n' + esc(read('src/refund-check.js')));
const refundUi = esc(read('src/refund-wizard.js'));

// 설정: 공개 빌드는 항상 공개용 예시값. 개인 빌드는 개인 설정이 있으면 그것을 쓴다.
const defaultsFile = !isPublic && exists('config/assumptions.private.json') ? 'config/assumptions.private.json' : 'config/assumptions.public.json';
const defaults = JSON.parse(read(defaultsFile));
const siteDefaults = !isPublic && exists('config/site-defaults.private.json') ? JSON.parse(read('config/site-defaults.private.json')) : [];
const params = JSON.parse(read('config/tax-params-2025.json'));
const sample = read('samples/sample-ledger.csv'); // 가상 샘플만 포함. 실제 금액이 든 case-b-site1.csv는 넣지 않는다

// 가상 샘플 설정(화면의 "가상 샘플로 체험" 버튼과 같은 값). 체험 결과도 이 값으로 미리 계산한다
const sampleSettings = JSON.parse(JSON.stringify(defaults));
Object.assign(sampleSettings.building, { cost: 300000000, landCost: 0, accumDepOpening: 15000000, residualRate: 0 });
sampleSettings.openingBalances.deposit = 0;
sampleSettings.deposits = [{ date: '2025-01-01', amount: 0 }];
sampleSettings.openingBalances.loans = [{ lender: '은행', principal: 200000000 }];
sampleSettings.assumptions = ['샘플용 가정값입니다.'];

// 체험 버전에는 유료 계산 코드가 없으므로, 가상 샘플의 유료 결과(조정계산서·홈택스 입력값 등)를 여기서 미리 계산해 넣는다.
// 화면에서 값을 하나라도 바꾸면 열쇠(paidKey)가 달라져 이 결과를 쓰지 않는다(잠금).
let demo = null;
if (isPublic) {
  const E = require('../src/engine.js');
  const bySite = {};
  E.parseLedgerCsv(sample).forEach((t) => { (bySite[t.site || '샘플'] = bySite[t.site || '샘플'] || []).push(t); });
  demo = {};
  for (const [site, txs] of Object.entries(bySite)) {
    // 화면(readForm)이 만드는 값과 같은 모양으로 맞춘다
    const s = JSON.parse(JSON.stringify(sampleSettings));
    Object.assign(s, { site, incomeType: '30', adjustments: [], filingType: '11', vatTaxBase: null, vatZeroRate: 0, vatExempt: 0, vatDeemedRent: 0,
      donationExcess: 0, donationCarryover: 0, agent: { name: '', phone: '', kind: '', mgmtNo: '', teamNo: '' }, credit: null,
      assumptions: defaults.assumptions });
    s.openingBalances.vatOut = 0; s.openingBalances.vatIn = 0;
    const r = E.run(txs, s, params);
    demo[r.paidKey] = {
      paid: { adj: r.adjustment, adjustedRevenue: r.adjustedRevenue, taxableIncome: r.taxableIncome, credit: r.credit, incomeAdjustment: r.incomeAdjustment },
      hx: E.hometaxInputs(r, s, params),
      warnings: r.warnings.filter((w) => w.code === 'F-30'),
    };
  }
}

// 환급 점검(이월결손금): 규칙 값과 체험 시나리오. 체험 결과는 빌드 때 미리 계산한다(공개 빌드에는 계산 코드가 없다)
const refundRules = JSON.parse(read('config/loss-carryover-rules.json'));
const refundScenario = JSON.parse(read('config/refund-demo.public.json'));
const R = require('../src/refund-check.js')();
const refundDemo = { scenario: refundScenario, key: R.inputKey(refundScenario.years, refundRules), result: R.analyze(refundScenario.years, refundRules) };

// 브랜드: 파비콘(데이터 주소)과 헤더 로고(인라인 SVG)
const faviconSvg = read('brand/favicon.svg').trim();
const favicon = 'data:image/svg+xml,' + encodeURIComponent(faviconSvg).replace(/'/g, '%27');
const logo = read('brand/logo-mark.svg').trim().replace(/ width="\d+" height="\d+"/, '');

// 함수 형태로 치환해 문자열 안의 `$` 패턴이 해석되지 않게 한다
const inject = (marker, value) => {
  if (!html.includes(marker)) throw new Error('마커 없음: ' + marker);
  html = html.split(marker).join(value);
};
inject('/*__ENGINE__*/', engine);
inject('/*__DEFAULTS__*/null', safeJson(defaults));
inject('/*__PARAMS__*/null', safeJson(params));
inject('/*__SAMPLE__*/null', safeJson(sample));
inject('/*__SAMPLE_SETTINGS__*/null', safeJson(sampleSettings));
inject('/*__DEMO__*/null', safeJson(demo));
inject('/*__REFUND_RULES__*/null', safeJson(refundRules));
inject('/*__REFUND_DEMO__*/null', safeJson(refundDemo));
inject('/*__REFUND_UI__*/', refundUi);
inject('/*__SITE_DEFAULTS__*/[]', safeJson(siteDefaults));
inject("/*__EDITION__*/'public'", safeJson(isPublic ? 'public' : 'private'));
inject("/*__VERSION__*/'dev'", safeJson(VERSION));
inject("/*__LICENSE_ENDPOINT__*/''", safeJson(LICENSE_ENDPOINT));
inject("/*__PURCHASE_URL__*/'#'", safeJson(PURCHASE_URL));
inject('/*__FAVICON__*/', favicon);
inject('<!--__LOGO__-->', logo);

const outDir = isPublic ? 'dist-public' : 'dist';
fs.mkdirSync(path.join(root, outDir), { recursive: true });
const out = path.join(root, outDir, 'index.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(1) + ' KB', isPublic ? '(공개 빌드: 체험 버전)' : '(개인 빌드)', '설정:', defaultsFile);
