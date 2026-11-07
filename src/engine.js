'use strict';
/*
 * 간편장부 → 복식부기 변환 엔진 (순수 함수, 서버·DOM 의존 없음)
 * 금액은 모두 정수(원). 날짜는 'YYYY-MM-DD' 문자열.
 * Node(CommonJS)와 브라우저(전역 RentalLedger) 양쪽에서 쓴다.
 */

let PAID = null; // 유료 모듈(setPaid로 연결)
let DEMO = null; // 체험 버전: 가상 샘플의 유료 결과를 미리 계산해 둔 표(setDemo). 입력이 샘플과 같을 때만 쓴다
const VAT_RATE = 0.1; // 부가가치세율(법정 10%)

// ───────────────────────── 계정 체계 ─────────────────────────
// code = 첨부 표준재무상태표(별지 제40호의6) / 표준손익계산서(별지 제40호의7) 코드. null은 서식 확인 필요.
const ACCOUNTS = {
  cash:        { name: '현금및현금성자산', side: 'D', kind: 'asset',     code: 3 },
  land:        { name: '토지',             side: 'D', kind: 'asset',     code: 39 }, // 비상각 자산
  building:    { name: '건물',             side: 'D', kind: 'asset',     code: 40 },
  accumDep:    { name: '감가상각누계액',   side: 'C', kind: 'contra',    code: 40 },
  vatIn:       { name: '부가세대급금',     side: 'D', kind: 'asset',     code: 17 },
  deposit:     { name: '임대보증금',       side: 'C', kind: 'liability', code: 81 },
  loan:        { name: '장기차입금',       side: 'C', kind: 'liability', code: 77 },
  vatOut:      { name: '부가세예수금',     side: 'C', kind: 'liability', code: 68 },
  equity:      { name: '사업주자본(자본금)', side: 'C', kind: 'equity',  code: 88 },
  rentRev:     { name: '임대수입',         side: 'C', kind: 'revenue',   code: 6 },
  taxDues:     { name: '세금과공과',       side: 'D', kind: 'sga',       code: 34 },
  depExp:      { name: '감가상각비',       side: 'D', kind: 'sga',       code: 35 },
  fee:         { name: '지급수수료',       side: 'D', kind: 'sga',       code: 47 },
  bldgMgmt:    { name: '건물관리비',       side: 'D', kind: 'sga',       code: 38 },
  insurance:   { name: '보험료',           side: 'D', kind: 'sga',       code: 32 },
  repair:      { name: '수선비',           side: 'D', kind: 'sga',       code: 37 },
  entertain:   { name: '기업업무추진비',   side: 'D', kind: 'sga',       code: 39 },
  adv:         { name: '광고선전비',       side: 'D', kind: 'sga',       code: 42 },
  vehicle:     { name: '차량유지비',       side: 'D', kind: 'sga',       code: 45 },
  supplies:    { name: '소모품비',         side: 'D', kind: 'sga',       code: 51 },
  welfare:     { name: '복리후생비',       side: 'D', kind: 'sga',       code: 25 },
  travel:      { name: '여비교통비',       side: 'D', kind: 'sga',       code: 26 },
  freight:     { name: '운반비',           side: 'D', kind: 'sga',       code: 44 },
  rentExp:     { name: '임차료',           side: 'D', kind: 'sga',       code: 27 },
  donation:    { name: '기부금',           side: 'D', kind: 'sga',       code: null },
  otherSga:    { name: '기타(판매비와관리비)', side: 'D', kind: 'sga',   code: 58 },
  interestExp: { name: '이자비용',         side: 'D', kind: 'nonop',     code: 82 },
  interestRev: { name: '이자수익',         side: 'C', kind: 'nonopincome', code: 64 }, // 영업외수익 (보증금 예금이자 등)
};

// 82호 부표 `계정과목` 어휘 → 내부 계정. 사용자 어휘 그대로 받는다.
const ACCOUNT_VOCAB = {
  '매출액': 'rentRev', '제세공과금': 'taxDues', '임차료': 'rentExp', '지급이자': 'interestExp',
  '접대비': 'entertain', '기부금': 'donation', '감가상각비': 'depExp', '차량유지비': 'vehicle',
  '지급수수료': 'fee', '소모품비': 'supplies', '복리후생비': 'welfare', '운반비': 'freight',
  '광고선전비': 'adv', '여비교통비': 'travel', '기타': 'otherSga', '급료': 'otherSga',
  // 국세청 간편장부 서식의 계정과목 표기
  '매출': 'rentRev', '기타(비용)': 'otherSga', '기타(수입)': 'rentRev',
};

// 거래내역 키워드 재분류(제안). 첫 번째로 맞는 규칙을 쓴다.
const KEYWORD_RULES = [
  { re: /재산세|인지세|교통유발|공과금|등록세|지방세/, account: 'taxDues' },
  { re: /장기수선/, account: 'otherSga', flag: '장기수선충당금 반환: 수령 시 부채였다면 비용이 아닐 수 있음. 세무사 확인' },
  { re: /관리비/, account: 'bldgMgmt' },
  { re: /보험/, account: 'insurance' },
  { re: /수선|수리/, account: 'repair' },
];

const EVIDENCE_NONE = /증빙없음|^$/;

// ───────────────────────── 날짜·숫자 유틸 ─────────────────────────
function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).replace(/[,\s원]/g, '');
  if (s === '') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('금액 형식 오류: ' + v);
  return Math.round(n);
}

function normDate(v) {
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) { // 엑셀 날짜 일련번호
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const m = String(v == null ? '' : v).trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return null;
  return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
}

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

// ───────────────────────── 입력 파싱 ─────────────────────────
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  site: ['사업장'], date: ['날짜', '일자'], party: ['상호', '거래처'], desc: ['거래내역', '거래내용'],
  type: ['구분'], supply: ['공급가액'], vat: ['부가세'], total: ['공급대가', '공급대가(합계)', '공급대가(합계)'],
  account: ['계정과목'], evidence: ['증빙자료', '증빙'], note: ['비고'],
};

function mapHeader(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const key = String(h).replace(/\s+/g, '');
    for (const [field, names] of Object.entries(HEADER_ALIASES)) {
      if (names.some((n) => n.replace(/\s+/g, '') === key) && idx[field] === undefined) idx[field] = i;
    }
  });
  return idx;
}

// 2차원 배열(헤더 포함) → 거래[]. XLSX 시트도 같은 형태로 넘기면 된다.
function parseLedgerRows(table, defaults = {}) {
  const idx = mapHeader(table[0]);
  const missing = ['date', 'type', 'supply'].filter((k) => idx[k] === undefined);
  if (missing.length) throw new Error('필수 열을 찾지 못함: ' + missing.join(', '));
  const get = (r, f) => (idx[f] === undefined ? '' : r[idx[f]]);
  const txs = [];
  table.slice(1).forEach((r, n) => {
    if (!r.some((x) => x !== '' && x !== null && x !== undefined)) return;
    const supply = toInt(get(r, 'supply'));
    const vat = toInt(get(r, 'vat'));
    txs.push({
      row: n + 2,
      site: String(get(r, 'site') || defaults.site || ''),
      date: normDate(get(r, 'date')),
      party: defaults.keepParty ? String(get(r, 'party') || '') : '', // 거래처(상호)는 계산에 쓰이지 않아 기본적으로 가져오지 않는다
      desc: String(get(r, 'desc') || ''),
      type: String(get(r, 'type') || '').trim(),
      supply, vat,
      total: idx.total === undefined || get(r, 'total') === '' ? supply + vat : toInt(get(r, 'total')),
      account: String(get(r, 'account') || '').trim(),
      evidence: String(get(r, 'evidence') || '').trim(),
      note: String(get(r, 'note') || ''),
    });
  });
  return txs;
}

function parseLedgerCsv(text, defaults) {
  return parseLedgerRows(parseCsv(text), defaults);
}

// 거래 시트가 아닌 시트(82호 서식 등)에서 업종코드를 읽는다. 값이 하나로 모일 때만 돌려준다.
const IMPORTED_COLUMNS = ['날짜', '구분', '공급가액', '부가세', '공급대가', '계정과목', '증빙자료', '거래내역', '비고'];
function detectIndustryCode(tables) {
  const found = new Set();
  for (const t of tables) {
    for (const r of t) {
      const idx = r.findIndex((c) => typeof c === 'string' && c.replace(/\s+/g, '').includes('주업종코드'));
      if (idx < 0) continue;
      for (const c of r.slice(idx + 1)) {
        const s = String(c).trim();
        if (/^\d{6}$/.test(s)) found.add(s);
      }
    }
  }
  return found.size === 1 ? Array.from(found)[0] : null;
}

// ───────────────────────── 분류·검증 ─────────────────────────
function isDeemedRentRow(t) {
  return /간주임대료/.test(t.desc);
}

function classify(t) {
  const flags = [];
  let account = ACCOUNT_VOCAB[t.account];
  if (!account && t.account) flags.push({ code: 'V-4', level: 'warn', msg: `계정과목 '${t.account}'이(가) 어휘에 없음 → 기타로 처리` });
  if (!account) account = t.type === '매출' ? 'rentRev' : 'otherSga';
  // 구분과 계정과목이 어긋나면 구분을 따른다 (잘못 분류된 수입이 비용 계정에 대변으로 들어가는 것을 막는다)
  if (t.type === '매출' && account !== 'rentRev') {
    flags.push({ code: 'V-4', level: 'warn', msg: `구분이 매출인데 계정과목이 '${t.account}' → 임대수입으로 처리` });
    account = 'rentRev';
  } else if (t.type === '비용' && account === 'rentRev') {
    flags.push({ code: 'V-4', level: 'error', msg: `구분이 비용인데 계정과목이 '${t.account}'(수입) → 기타비용으로 처리` });
    account = 'otherSga';
  }
  if (t.account === '기타(수입)') flags.push({ code: 'REVIEW', level: 'warn', msg: '기타(수입)은 영업외수입. 임대수입으로 합산했으니 분리 필요 여부 확인' });
  if (t.type === '비용' && (account === 'taxDues' || account === 'otherSga')) {
    const rule = KEYWORD_RULES.find((r) => r.re.test(t.desc));
    if (rule) {
      account = rule.account;
      if (rule.flag) flags.push({ code: 'REVIEW', level: 'warn', msg: rule.flag });
    }
  }
  return { account, flags };
}

function validate(txs, settings) {
  const out = [];
  const year = settings.year;
  const add = (t, code, level, msg) => out.push({ row: t ? t.row : null, code, level, msg });
  for (const t of txs) {
    if (!t.date) { add(t, 'V-1', 'error', '날짜를 읽을 수 없음'); continue; }
    if (t.type !== '매출' && t.type !== '비용') add(t, 'V-2', 'error', `구분이 매출/비용이 아님: '${t.type}'`);
    if (t.supply === 0) add(t, 'V-2', 'warn', '공급가액이 0');
    if (t.supply < 0) add(t, 'V-2', 'warn', '음수 금액(환불·취소?)');
    if (t.supply + t.vat !== t.total) add(t, 'V-3', 'warn', `공급대가(${t.total}) ≠ 공급가액+부가세(${t.supply + t.vat})`);
    if (!t.date.startsWith(String(year) + '-') && !isDeemedRentRow(t)) add(t, 'V-1', 'error', `과세기간(${year}) 밖의 날짜: ${t.date}`);
    if (t.type === '비용' && EVIDENCE_NONE.test(t.evidence)) add(t, 'V-5', 'warn', '비용 증빙이 없음/비어 있음(영수증수취명세서 대상 확인)');
    if (t.account === '감가상각비') add(t, 'V-6', 'warn', '감가상각비는 도구가 계산함. 거래 입력과 중복될 수 있어 제외');
    if (isDeemedRentRow(t)) add(t, 'V-9', 'info', `간주임대료 행(${t.supply}원)은 거래에서 제외하고 재계산함`);
  }
  if (txs.some((t) => t.account === '지급이자') && !(settings.openingBalances.loans || []).length) {
    add(null, 'V-7', 'warn', '지급이자가 있는데 차입금 잔액 입력이 없음');
  }
  // 대출 원금 상환 (L-1)
  const loanOpen = ((settings.openingBalances || {}).loans || []).reduce((s, l) => s + l.principal, 0);
  const repaid = (settings.loanRepayments || []).reduce((s, r) => s + (r.amount || 0), 0);
  for (const r of settings.loanRepayments || []) {
    const d = normDate(r.date);
    if (r.amount && (!d || !d.startsWith(String(year) + '-'))) add(null, 'L-1', 'error', `대출 상환일이 과세기간(${year}) 밖이거나 읽을 수 없음: ${r.date}`);
  }
  if (repaid > loanOpen) add(null, 'L-1', 'warn', `연중 대출 원금 상환액(${repaid})이 기초 대출 잔액(${loanOpen})보다 큼. 기초 잔액이나 신규 차입 확인`);
  // 부가세 정산 (G-2)
  const pays = settings.vatPayments || [];
  const ob = settings.openingBalances || {};
  if ((settings.vatMode || 'exclude') === 'track') {
    for (const p of pays) {
      const d = normDate(p.date);
      if (!d || !d.startsWith(String(year) + '-')) add(null, 'G-2', 'error', `부가세 납부·환급일이 과세기간(${year}) 밖이거나 읽을 수 없음: ${p.date}`);
      if (!Number.isFinite(Number(p.amount))) add(null, 'G-2', 'error', `부가세 납부 금액 오류: ${p.amount}`);
    }
    const vatTotal = txs.reduce((s, t) => s + (t.vat || 0), 0);
    if (!pays.length && (vatTotal > 0 || (ob.vatOut || 0) > 0)) {
      add(null, 'G-2', 'warn', '부가세를 추적하는데 납부 내역이 없어 부가세예수금이 납부 없이 부채로 남음. 부가세 신고서의 납부 내역을 입력');
    }
  } else if (pays.length || ob.vatOut || ob.vatIn) {
    add(null, 'G-2', 'info', '부가세 제외 모드라 부가세 납부 내역과 기초 부가세 잔액은 사용하지 않음');
  }
  if ((settings.vatMode || 'exclude') !== 'track' && (settings.vatDeemedRent || 0) > 0) {
    add(null, 'G-3', 'info', '부가세 제외 모드라 부가세법상 간주임대료의 부가세는 장부에 넣지 않음(조정후 총수입금액명세서 차이 계산에만 사용)');
  }
  return out;
}

// ───────────────────────── 감가상각 ─────────────────────────
function depreciation(building, year) {
  const { cost, acquiredOn, usefulLifeYears, accumDepOpening = 0, residualRate = 0 } = building;
  if (building.noDepreciation) return { amount: 0, months: 0 }; // 감가상각비를 계상하지 않는 경우(국세청 사례 등)
  const base = cost * (1 - residualRate); // 상각 대상액 = 취득가 − 잔존가액
  let months = 12;
  if (acquiredOn && acquiredOn.startsWith(String(year))) months = 12 - Number(acquiredOn.slice(5, 7)) + 1;
  if (acquiredOn && Number(acquiredOn.slice(0, 4)) > year) months = 0;
  let amount = Math.floor((base / usefulLifeYears) * months / 12);
  const remaining = Math.floor(base - accumDepOpening);
  if (amount > remaining) amount = Math.max(remaining, 0);
  return { amount, months };
}

// ───────────────────────── 간주임대료 (별지 제53호) ─────────────────────────
// deposits: [{date, amount}] = 해당 일자부터 적용되는 보증금 잔액. 첫 항목은 기초 잔액(연초 일자).
function deemedRent({ year, deposits, building, rate, depositInterestIncome = 0 }) {
  const y = daysInYear(year);
  const start = dayNumber(`${year}-01-01`);
  const end = start + y;
  const ev = deposits.map((d) => ({ at: dayNumber(d.date), amount: d.amount })).sort((a, b) => a.at - b.at);
  let accumulated = 0;
  const lines = [];
  for (let i = 0; i < ev.length; i++) {
    const from = Math.max(ev[i].at, start);
    const to = i + 1 < ev.length ? Math.min(ev[i + 1].at, end) : end;
    const days = Math.max(to - from, 0);
    accumulated += ev[i].amount * days;
    lines.push({ from, days, amount: ev[i].amount });
  }
  const costEquivalent = building.totalArea > 0
    ? Math.round(building.cost * building.depositArea / building.totalArea) : 0;
  const costAccum = costEquivalent * y;
  const balanceDiff = accumulated - costAccum;
  const balance = balanceDiff > 0 ? Math.floor(balanceDiff / y) : 0;
  const grossEquivalent = Math.floor(balance * rate);
  const included = Math.max(grossEquivalent - depositInterestIncome, 0);
  return {
    depositAccum: accumulated, costEquivalent, costAccum, balance,
    rate, grossEquivalent, depositInterestIncome, included, segments: lines,
  };
}

// 조정 종류·소득구분 이름표(계산 로직 아님. 화면 선택지에 쓴다)
const ADJUSTMENT_KINDS = {
  addIncome:        { cell: 11, label: '총수입금액 산입' },
  disallowExpense:  { cell: 11, label: '필요경비 불산입' },
  allowExpense:     { cell: 12, label: '필요경비 산입' },
  excludeIncome:    { cell: 12, label: '총수입금액 불산입' },
};
const INCOME_TYPES = {
  '30': '부동산임대업(주택임대업 제외) 사업소득',
  '32': '주택임대업의 사업소득',
  '40': '부동산임대업 외의 사업소득',
};

// ───────────────────────── 분개 ─────────────────────────
function line(account, debit, credit) { return { account, debit: debit || 0, credit: credit || 0 }; }

function toJournal(txs, settings, derived) {
  const J = [];
  const vatMode = settings.vatMode || 'exclude';
  const year = settings.year;
  const ob = settings.openingBalances;

  // 개시 분개
  const bld = settings.building;
  const loans = (ob.loans || []).reduce((s, l) => s + l.principal, 0);
  const deposit0 = ob.deposit || 0;
  const land = bld.landCost || 0; // 토지는 감가상각하지 않고 건설비 상당액·간주임대료에도 쓰지 않는다
  // 부가세를 추적할 때만 기초 부가세예수금(미납)·대급금(미환급)을 둔다. 제외 모드에서는 쓰지 않는다
  const vatOut0 = vatMode === 'track' ? (ob.vatOut || 0) : 0;
  const vatIn0 = vatMode === 'track' ? (ob.vatIn || 0) : 0;
  const assets = ob.cash + bld.cost - bld.accumDepOpening + land + vatIn0;
  const equity0 = assets - loans - deposit0 - vatOut0;
  J.push({ date: `${year}-01-01`, desc: '기초 잔액', source: 'opening', lines: [
    line('cash', ob.cash, 0), line('vatIn', vatIn0, 0), line('land', land, 0), line('building', bld.cost, 0), line('accumDep', 0, bld.accumDepOpening),
    line('loan', 0, loans), line('deposit', 0, deposit0), line('vatOut', 0, vatOut0),
    equity0 >= 0 ? line('equity', 0, equity0) : line('equity', -equity0, 0),
  ].filter((l) => l.debit || l.credit) });

  for (const t of txs) {
    if (t.skip) continue;
    const cls = t.cls;
    if (t.type === '매출') {
      const lines = vatMode === 'track' && t.vat
        ? [line('cash', t.supply + t.vat, 0), line(cls.account, 0, t.supply), line('vatOut', 0, t.vat)]
        : [line('cash', t.supply, 0), line(cls.account, 0, t.supply)];
      J.push({ date: t.date, desc: t.desc, source: 'tx:' + t.row, lines });
    } else {
      const lines = vatMode === 'track' && t.vat
        ? [line(cls.account, t.supply, 0), line('vatIn', t.vat, 0), line('cash', 0, t.supply + t.vat)]
        : [line(cls.account, t.supply, 0), line('cash', 0, t.supply)];
      J.push({ date: t.date, desc: t.desc, source: 'tx:' + t.row, lines });
    }
  }

  // 기말 결산: 감가상각
  if (derived.dep.amount > 0) {
    J.push({ date: `${year}-12-31`, desc: '감가상각비', source: 'closing', lines: [
      line('depExp', derived.dep.amount, 0), line('accumDep', 0, derived.dep.amount)] });
  }

  // 임대보증금을 예치해 받은 이자 (G-4): 장부에는 영업외수익으로 넣고, 조정계산서 12번에서 불산입한다
  // (예금이자는 이자소득이지 부동산임대 사업소득이 아니다)
  if ((settings.depositInterestIncome || 0) > 0) {
    J.push({ date: `${year}-12-31`, desc: '임대보증금 이자수익', source: 'closing', lines: [
      line('cash', settings.depositInterestIncome, 0), line('interestRev', 0, settings.depositInterestIncome)] });
  }

  // 보증금 변동(연중). 첫 항목(기초)은 개시 분개에 있으므로 제외
  const dep = (settings.deposits || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  let prev = deposit0;
  for (const d of dep) {
    if (d.date <= `${year}-01-01`) { prev = d.amount; continue; }
    const diff = d.amount - prev;
    if (diff > 0) J.push({ date: d.date, desc: '임대보증금 수령', source: 'deposit', lines: [line('cash', diff, 0), line('deposit', 0, diff)] });
    if (diff < 0) J.push({ date: d.date, desc: '임대보증금 반환', source: 'deposit', lines: [line('deposit', -diff, 0), line('cash', 0, -diff)] });
    prev = d.amount;
  }

  // 사업주 인출·투입
  for (const w of settings.ownerFlows || []) {
    if (w.amount > 0) J.push({ date: w.date, desc: '사업주 투입', source: 'owner', lines: [line('cash', w.amount, 0), line('equity', 0, w.amount)] });
    if (w.amount < 0) J.push({ date: w.date, desc: '사업주 인출', source: 'owner', lines: [line('equity', -w.amount, 0), line('cash', 0, -w.amount)] });
  }

  // 대출 원금 상환(양수)·추가 차입(음수). 상환은 장기차입금을 줄이고 현금을 줄인다. 이자는 거래의 지급이자로 따로 들어온다.
  for (const r of settings.loanRepayments || []) {
    if (r.amount > 0) J.push({ date: r.date, desc: '대출 원금 상환', source: 'loan', lines: [line('loan', r.amount, 0), line('cash', 0, r.amount)] });
    if (r.amount < 0) J.push({ date: r.date, desc: '대출 추가 차입', source: 'loan', lines: [line('cash', -r.amount, 0), line('loan', 0, -r.amount)] });
  }

  // 부가세 정산 (G-2): 납부(+)는 부가세예수금을 줄이고 환급(−)은 부가세대급금을 줄인다.
  // 결산일에는 예수금과 대급금을 서로 상계하고, 남은 예수금은 미납 부가세로 유동부채에 둔다.
  if (vatMode === 'track') {
    // 부가세법상 간주임대료 (G-3): 임대인이 부담하는 부가세라서 임차인에게서 받는 돈이 없다.
    // 차) 세금과공과 / 대) 부가세예수금. 공급가액은 부가세 신고서의 간주임대료 값을 쓴다.
    const deemedTax = Math.floor((settings.vatDeemedRent || 0) * VAT_RATE);
    if (deemedTax > 0) {
      J.push({ date: `${year}-12-31`, desc: '부가세법상 간주임대료 부가세 (임대인 부담)', source: 'vat',
        lines: [line('taxDues', deemedTax, 0), line('vatOut', 0, deemedTax)] });
    }
    for (const p of settings.vatPayments || []) {
      if (!p.amount) continue;
      if (p.amount > 0) J.push({ date: p.date, desc: '부가세 납부', source: 'vat', lines: [line('vatOut', p.amount, 0), line('cash', 0, p.amount)] });
      else J.push({ date: p.date, desc: '부가세 환급', source: 'vat', lines: [line('cash', -p.amount, 0), line('vatIn', 0, -p.amount)] });
    }
    let outBal = 0, inBal = 0;
    for (const j of J) {
      for (const l of j.lines) {
        if (l.account === 'vatOut') outBal += l.credit - l.debit;
        if (l.account === 'vatIn') inBal += l.debit - l.credit;
      }
    }
    const offset = Math.min(outBal, inBal);
    if (offset > 0) {
      J.push({ date: `${year}-12-31`, desc: '부가세예수금·대급금 상계', source: 'closing', lines: [line('vatOut', offset, 0), line('vatIn', 0, offset)] });
    }
  }
  return J.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.source === 'opening' ? -1 : 0)));
}

function trialBalance(journal) {
  const tb = {};
  for (const j of journal) {
    const d = j.lines.reduce((s, l) => s + l.debit, 0);
    const c = j.lines.reduce((s, l) => s + l.credit, 0);
    if (d !== c) throw new Error(`분개 대차 불일치(${j.date} ${j.desc}): 차변 ${d} / 대변 ${c}`);
    for (const l of j.lines) {
      const a = (tb[l.account] = tb[l.account] || { debit: 0, credit: 0 });
      a.debit += l.debit; a.credit += l.credit;
    }
  }
  const rows = Object.entries(tb).map(([id, v]) => ({
    id, name: ACCOUNTS[id].name, kind: ACCOUNTS[id].kind, code: ACCOUNTS[id].code,
    debit: v.debit, credit: v.credit, balance: v.debit - v.credit,
  }));
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  if (totalDebit !== totalCredit) throw new Error(`시산표 불일치: ${totalDebit} / ${totalCredit}`);
  return { rows, totalDebit, totalCredit };
}

// ───────────────────────── 재무제표 ─────────────────────────
function statements(tb) {
  const bal = (id) => (tb.rows.find((r) => r.id === id) || { balance: 0 }).balance;
  const sga = tb.rows.filter((r) => r.kind === 'sga');
  const sgaTotal = sga.reduce((s, r) => s + r.balance, 0);
  const revenue = -bal('rentRev');
  const interest = bal('interestExp');
  const interestInc = 0 - bal('interestRev');
  const operatingIncome = revenue - sgaTotal;
  const netIncome = operatingIncome + interestInc - interest;

  const cash = bal('cash'), vatIn = bal('vatIn');
  const buildingNet = bal('building') + bal('accumDep'); // accumDep는 대변 잔액이라 음수
  const currentAssets = cash + vatIn;
  const land = bal('land');
  const totalAssets = currentAssets + land + buildingNet;
  const cr = (id) => 0 - bal(id); // 대변 잔액을 양수로. -0이 나오지 않게 0에서 뺀다
  const loan = cr('loan'), deposit = cr('deposit'), vatOut = cr('vatOut');
  const liabilities = loan + deposit + vatOut;
  const capital = cr('equity');
  const equityTotal = capital + netIncome;
  const check = totalAssets - (liabilities + equityTotal);

  return {
    income: {
      revenue, sga: sga.map((r) => ({ name: r.name, code: r.code, amount: r.balance })),
      sgaTotal, operatingIncome, nonOperating: [{ name: '이자비용', amount: interest }],
      nonOperatingIncome: [{ name: '이자수익', code: 64, amount: interestInc }], nonOperatingIncomeTotal: interestInc, netIncome,
      necessaryExpense: sgaTotal + interest, // 82호 부표의 필요경비 합계와 같은 개념
    },
    balance: {
      assets: { cash, vatIn, land, building: bal('building'), accumDep: bal('accumDep'), buildingNet, total: totalAssets },
      liabilities: { loan, deposit, vatOut, total: liabilities },
      equity: { capital, netIncome, total: equityTotal },
      liabilitiesAndEquity: liabilities + equityTotal,
      difference: check,
    },
  };
}

function fmtWon(n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ko-KR'); }

// ───────────────────────── 체험용 샘플 결과 열쇠 ─────────────────────────
// 유료 계산에 들어가는 값만 모아 해시한다. 입력이 샘플과 하나라도 다르면 열쇠가 달라져 체험 결과를 쓰지 않는다.
function paidKey(st, settings, deemedUsed, mode, taxParams) {
  const s = settings, ag = s.agent || {}, c = s.credit;
  const key = JSON.stringify({
    inc: st.income, bal: st.balance, deemedUsed, mode, type: s.incomeType || '30', ind: s.industryCode || '701201',
    fil: s.filingType === '12' ? '12' : '11',
    adj: (s.adjustments || []).map((a) => [a.kind, a.amount, a.reason || '', a.code || '']),
    don: [s.donationExcess || 0, s.donationCarryover || 0],
    agent: ['name', 'phone', 'kind', 'mgmtNo', 'teamNo'].map((k) => ag[k] || ''),
    vat: s.vatTaxBase != null && s.vatTaxBase !== '' ? [Number(s.vatTaxBase), Number(s.vatZeroRate || 0), Number(s.vatExempt || 0), Number(s.vatDeemedRent || 0)] : null,
    credit: c && c.computedTax ? [c.computedTax, c.bookIncome || 0, c.totalIncome] : null,
    bk: taxParams.bookkeepingCredit,
  });
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < key.length; i++) { const ch = key.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + ch) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + key.length.toString(16);
}

// ───────────────────────── 파이프라인 ─────────────────────────
function run(txsIn, settings, taxParams) {
  const warnings = validate(txsIn, settings);
  const assumptions = settings.assumptions || [];

  const txs = txsIn.map((t) => {
    const copy = Object.assign({}, t);
    copy.deemed = isDeemedRentRow(t);
    copy.skip = copy.deemed || t.account === '감가상각비' || !t.date || (t.type !== '매출' && t.type !== '비용');
    const cls = classify(t);
    copy.cls = cls;
    for (const f of cls.flags) warnings.push({ row: t.row, code: f.code, level: f.level, msg: f.msg });
    return copy;
  });

  const dep = depreciation(settings.building, settings.year);
  const dr = deemedRent({
    year: settings.year, deposits: settings.deposits, building: settings.building,
    rate: taxParams.deemedRentRate, depositInterestIncome: settings.depositInterestIncome || 0,
  });
  const enteredDeemed = txs.filter((t) => t.deemed).reduce((s, t) => s + t.supply, 0);

  const journal = toJournal(txs, settings, { dep });
  const tb = trialBalance(journal);
  const st = statements(tb);

  const mode = settings.deemedRentMode || 'recompute';
  const deemedUsed = mode === 'asEntered' ? enteredDeemed : dr.included;
  // 유료 계산(조정계산서·조정후 총수입금액명세서·소득금액조정합계표·기장세액공제)은 engine-paid.js에 있다.
  // 이 모듈이 없으면(체험 버전, 이용권 없음) 해당 결과는 null이고 locked가 true다.
  const pKey = paidKey(st, settings, deemedUsed, mode, taxParams);
  let demo = null;
  let paid = PAID ? PAID.runPaid({ st, settings, taxParams, deemedUsed, mode, warnings }) : null;
  if (!paid && DEMO && DEMO[pKey]) { demo = DEMO[pKey]; paid = demo.paid; warnings.push(...demo.warnings); }
  const adj = paid && paid.adj, adjustedRevenue = paid && paid.adjustedRevenue;
  const taxableIncome = paid ? paid.taxableIncome : null;
  if (enteredDeemed !== dr.included) {
    warnings.push({ row: null, code: 'V-9', level: 'warn',
      msg: `간주임대료 대사 불일치: 원본 입력 ${enteredDeemed}원 / 재계산 ${dr.included}원 (가정 입력 기준, 세무사 확인)` });
  }
  if (st.balance.liabilities.vatOut < 0) {
    warnings.push({ row: null, code: 'G-2', level: 'warn', msg: `부가세 납부액이 부가세예수금보다 ${fmtWon(-st.balance.liabilities.vatOut)}원 많음. 기초 미납 부가세나 신고서 납부 내역을 확인` });
  }
  if (st.balance.assets.vatIn < 0) {
    warnings.push({ row: null, code: 'G-2', level: 'warn', msg: `부가세 환급액이 부가세대급금보다 ${fmtWon(-st.balance.assets.vatIn)}원 많음` });
  }
  if (Math.abs(st.balance.difference) > 0) warnings.push({ row: null, code: 'BAL', level: 'error', msg: '재무상태표 대차 불일치 ' + st.balance.difference });

  const credit = paid ? paid.credit : null;

  // 거래 시트 합계 (82호 부표 대사용)
  const sheet = {
    revenue: txsIn.filter((t) => t.type === '매출').reduce((s, t) => s + t.supply, 0),
    expense: txsIn.filter((t) => t.type === '비용').reduce((s, t) => s + t.supply, 0),
  };

  return {
    transactions: txs, journal, trialBalance: tb, statements: st,
    depreciation: dep, deemedRent: dr, enteredDeemedRent: enteredDeemed, deemedRentUsed: deemedUsed,
    taxableIncome, adjustment: adj, adjustedRevenue, incomeAdjustment: paid ? paid.incomeAdjustment : null, locked: !paid, paidKey: pKey, demo: !!demo, demoHx: demo ? demo.hx : null,
    vatDeemedTax: (settings.vatMode === 'track') ? Math.floor((settings.vatDeemedRent || 0) * VAT_RATE) : 0,
    credit, sheet, warnings, assumptions,
  };
}

const api = {
  ACCOUNTS, ACCOUNT_VOCAB, parseCsv, parseLedgerRows, parseLedgerCsv, normDate, toInt,
  classify, validate, depreciation, deemedRent, detectIndustryCode, IMPORTED_COLUMNS,
  toJournal, trialBalance, statements, run, ADJUSTMENT_KINDS, INCOME_TYPES,
  hasPaid: () => !!PAID, paidKey,
  setDemo(map) { DEMO = map || null; },
  // 유료 모듈 연결: 서버에서 받은 engine-paid 팩토리(또는 Node의 require 결과)를 넘긴다
  setPaid(factory) {
    PAID = factory ? factory({ fmtWon, ADJUSTMENT_KINDS, INCOME_TYPES }) : null;
    for (const k of PAID_EXPORTS) { if (PAID) api[k] = PAID[k]; else delete api[k]; }
  },
};
const PAID_EXPORTS = ['bookkeepingCredit', 'adjustmentStatement', 'hometaxInputs', 'adjustedRevenueStatement', 'incomeAdjustmentTable'];
// Node(테스트·개인 빌드 도구)에서는 같은 폴더의 유료 모듈을 바로 연결한다. 브라우저에서는 화면이 연결한다.
if (typeof module !== 'undefined' && typeof require === 'function') {
  try { api.setPaid(require('./engine-paid.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}

// 전역에는 항상 등록한다. 페이지에 `module`이 정의된 환경(일부 확장·뷰어)에서도 화면이 엔진을 찾을 수 있어야 한다.
var rootObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
if (rootObj) rootObj.RentalLedger = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
