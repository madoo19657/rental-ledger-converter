'use strict';
// 환급 점검(이월결손금 추적) 테스트: 가상 값만 쓴다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/refund-check.js')();

const root = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'config/loss-carryover-rules.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(path.join(root, 'config/refund-demo.public.json'), 'utf8'));
const y = (year, income, claimed = null, balance = null) => ({ year, income, claimed, balance });

test('결손이 나고 다음 해에 소득이 있으면 오래된 결손부터 공제하고 잔액을 이월한다', () => {
  const r = R.analyze([y(2020, -10000000), y(2021, 4000000), y(2022, 3000000)], rules);
  assert.deepEqual(r.rows.map((x) => [x.opening, x.occurred, x.computedDeduction, x.closing]), [[0, 10000000, 0, 10000000], [10000000, 0, 4000000, 6000000], [6000000, 0, 3000000, 3000000]]);
  assert.equal(r.warnings.length, 0);
});

test('공제 순서: 두 해의 결손이 있으면 먼저 생긴 것부터 줄어든다(소멸 기한 판단에 영향)', () => {
  const r = R.analyze([y(2019, -5000000), y(2020, -5000000), y(2021, 3000000)], rules);
  assert.equal(r.rows[2].closing, 7000000);
  assert.equal(r.rows[2].expiresBy, 2029); // 2019년분이 남아 있으면 그 기한(2019+10)이 가장 빠르다
});

test('공제액이 한도(그 해 소득금액)를 넘지 않는다', () => {
  const r = R.analyze([y(2020, -50000000), y(2021, 2000000)], rules);
  assert.equal(r.rows[1].computedDeduction, 2000000);
});

test('R-1: 공제할 결손이 남아 있는데 신고서 공제액이 0이면 경고한다', () => {
  const r = R.analyze([y(2020, -9000000, 0, 9000000), y(2021, 4000000, 0, 9000000)], rules);
  assert.deepEqual(r.warnings.map((w) => [w.year, w.code]), [[2021, 'R-1']]);
  assert.equal(r.summary.missedDeduction, 4000000);
});

test('R-2: 신고서 공제액이 계산과 다르면 경고한다(적은 경우·많은 경우)', () => {
  const less = R.analyze([y(2020, -9000000), y(2021, 4000000, 1000000)], rules);
  assert.equal(less.warnings[0].code, 'R-2');
  assert.match(less.warnings[0].msg, /적습니다/);
  const more = R.analyze([y(2020, -2000000), y(2021, 4000000, 3000000)], rules);
  assert.equal(more.warnings[0].code, 'R-2');
  assert.match(more.warnings[0].msg, /많습니다/);
});

test('R-3: 공제할 수 있는 기간인데 신고서 잔액이 0이면 경고한다', () => {
  const r = R.analyze([y(2020, -9000000, 0, 0)], rules);
  assert.equal(r.warnings[0].code, 'R-3');
});

test('R-5: 잔액만 다르면 R-5, 앞 해 어긋남의 영향으로 뒤 해에도 나오면 downstream으로 표시한다', () => {
  const r = R.analyze([y(2020, -9000000, 0, 9000000), y(2021, 4000000, 4000000, 4000000), y(2022, 1000000, 1000000, 3000000)], rules);
  const codes = r.warnings.map((w) => [w.year, w.code, w.downstream]);
  assert.deepEqual(codes, [[2021, 'R-5', false], [2022, 'R-5', true]]);
  assert.equal(r.summary.rootYear, 2021);
});

test('R-6: 소득이 0 이하인데 공제액이 있거나 공제액이 소득보다 크면 입력 확인을 요청한다', () => {
  const a = R.analyze([y(2020, -1000000, 500000)], rules);
  assert.equal(a.warnings.some((w) => w.code === 'R-6'), true);
  const b = R.analyze([y(2020, -9000000), y(2021, 1000000, 2000000)], rules);
  assert.equal(b.warnings.some((w) => w.code === 'R-6'), true);
});

test('값을 모르면(null) 그 해와 이후 해는 점검 불가로 표시하고 경고를 만들지 않는다', () => {
  const r = R.analyze([y(2020, -9000000), y(2021, null), y(2022, 4000000, 0)], rules);
  assert.deepEqual(r.rows.map((x) => x.status), ['ok', 'unknown', 'unchecked']);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.summary.unchecked, 2);
});

test('공제 기한이 지난 결손금은 쓸 수 없고 소멸로 표시한다(기한 규칙은 입력 규칙 파일 값)', () => {
  const short = { carryYears: [{ years: 2 }] };
  const r = R.analyze([y(2020, -9000000), y(2021, 0), y(2022, 0), y(2023, 5000000)], short);
  assert.equal(r.rows[3].expired, 9000000);
  assert.equal(r.rows[3].computedDeduction, 0);
  assert.equal(r.notes.some((n) => n.includes('소멸')), true);
});

test('규칙 파일: 2018~2019년 발생분 10년, 2020년 이후 15년(확인 필요 상태 표시)', () => {
  assert.equal(R.lastUsableYear(2019, rules), 2029);
  assert.equal(R.lastUsableYear(2020, rules), 2035);
  assert.equal(R.lastUsableYear(2017, rules), null);
  assert.equal(rules.status, '확인 필요');
});

test('체험 시나리오: 2022·2025년 공제 누락(R-1)과 이후 잔액 차이를 보여 준다', () => {
  const r = R.analyze(demo.years, rules);
  const first = r.warnings.map((w) => `${w.year}:${w.code}`);
  assert.equal(r.summary.rootYear, 2022);
  assert.ok(first.includes('2022:R-1') && first.includes('2025:R-1'));
  assert.equal(r.rows.find((x) => x.year === 2022).computedDeduction, 8000000);
  assert.equal(r.summary.checked, 7);
});

test('입력 열쇠: 값 하나만 바뀌어도 달라지고, 순서가 달라도 같다', () => {
  const a = R.inputKey(demo.years, rules);
  const reversed = R.inputKey([...demo.years].reverse(), rules);
  assert.equal(a, reversed);
  const changed = JSON.parse(JSON.stringify(demo.years)); changed[0].income = -29999999;
  assert.notEqual(a, R.inputKey(changed, rules));
});
