'use strict';
// 공개 저장소에 포함되는 테스트: 가상 샘플과 일반 예시값만 쓴다. 실제 신고서 값을 쓰는 사례 테스트는 tests-private/에 있다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/engine.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const params = JSON.parse(read('config/tax-params-2025.json'));
const base = () => JSON.parse(read('config/assumptions.public.json'));
const sampleTxs = () => E.parseLedgerCsv(read('samples/sample-ledger.csv'));

test('가상 샘플: 모든 분개가 대차 균형이고 재무상태표 차이가 0이다', () => {
  const r = E.run(sampleTxs(), base(), params);
  assert.equal(r.statements.balance.difference, 0);
});

test('간주임대료: 건설비 상당액이 보증금보다 크면 소득세 간주임대료는 0원', () => {
  const x = E.deemedRent({
    year: 2025,
    deposits: [{ date: '2025-01-01', amount: 20000000 }],
    building: { cost: 300000000, totalArea: 1, depositArea: 1 },
    rate: 0.031,
    depositInterestIncome: 0,
  });
  assert.equal(x.included, 0);
});

test('간주임대료: 건설비를 넘는 보증금은 초과분에만 이자율을 곱한다', () => {
  const x = E.deemedRent({
    year: 2025,
    deposits: [{ date: '2025-01-01', amount: 400000000 }],
    building: { cost: 300000000, totalArea: 1, depositArea: 1 },
    rate: 0.03,
    depositInterestIncome: 0,
  });
  assert.equal(x.included, 3000000); // (4억 − 3억) × 3%
});

test('기장세액공제: 산출세액 × 기장소득 비율 × 20%, 한도 100만 원', () => {
  const a = E.bookkeepingCredit({ computedTax: 2000000, bookIncome: 10000000, totalIncome: 20000000, rate: 0.2, cap: 1000000 });
  assert.equal(a.amount, 200000);
  const b = E.bookkeepingCredit({ computedTax: 50000000, bookIncome: 10000000, totalIncome: 10000000, rate: 0.2, cap: 1000000 });
  assert.equal(b.amount, 1000000);
  assert.equal(b.capped, true);
});

test('대출 원금 상환: 장기차입금과 현금이 같이 줄고 대차가 맞는다', () => {
  const csv = ['날짜,구분,공급가액,부가세,계정과목,증빙자료,거래내역', '2025-12-31,매출,10000000,0,매출액,계좌이체,임대료'].join('\n');
  const s = base();
  s.openingBalances.cash = 5000000;
  const a = E.run(E.parseLedgerCsv(csv), s, params);
  const s2 = Object.assign(base(), { loanRepayments: [{ date: '2025-06-30', amount: 20000000 }] });
  s2.openingBalances.cash = 5000000;
  const b = E.run(E.parseLedgerCsv(csv), s2, params);
  assert.equal(b.statements.balance.liabilities.loan, a.statements.balance.liabilities.loan - 20000000);
  assert.equal(b.statements.balance.assets.cash, a.statements.balance.assets.cash - 20000000);
  assert.equal(b.statements.balance.difference, 0);
});

test('날짜·금액 파싱: 쉼표 금액과 여러 날짜 형식을 읽는다', () => {
  assert.equal(E.toInt('1,234,567'), 1234567);
  assert.equal(E.normDate('2025.3.5'), '2025-03-05');
});

test('공개 설정에 개인 식별 값이 없다(주민번호·전화번호 형태)', () => {
  const text = read('config/assumptions.public.json') + read('samples/sample-ledger.csv');
  assert.doesNotMatch(text, /\b\d{6}-[1-4]\d{6}\b/);
  assert.doesNotMatch(text, /\b01[016789]-?\d{3,4}-?\d{4}\b/);
});
