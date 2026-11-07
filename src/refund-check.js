'use strict';
/*
 * 환급 점검: 부동산임대업 이월결손금 추적 (순수 함수, DOM·서버 의존 없음)
 * 금액은 정수(원). 유료 계산 모듈이라 체험 버전에는 들어 있지 않고(이용권 확인 뒤 서버에서 받는다),
 * 체험은 빌드 때 가상 시나리오 결과를 미리 계산해 쓴다. 규칙 값은 config/loss-carryover-rules.json이며 확인 전 값이다.
 *
 * 입력(연도별): { year, income, claimed, balance }
 *   income  그 해 부동산임대업 소득금액(이월결손금 공제 전). 결손이면 음수. 모르면 null
 *   claimed 신고서에 적힌 이월결손금 공제액(임대업 줄). 모르면 null
 *   balance 신고서에 적힌 이월결손금 잔액(선택). 모르면 null
 * 경고 종류는 docs/PRD-refund-check.md §3.3. R-4(공제 순서 위반)는 발생연도별 공제 내역 입력이 필요해 후속이다.
 */
function createRefund() {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // 발생 연도 y의 결손금을 마지막으로 공제할 수 있는 해. 규칙에 없는 해는 null(확인 필요)
  function lastUsableYear(y, rules) {
    for (const r of rules.carryYears || []) {
      if ((r.fromYear == null || y >= r.fromYear) && (r.toYear == null || y <= r.toYear)) return y + r.years;
    }
    return null;
  }

  function normalize(years) {
    return (years || []).map((r) => ({
      year: Number(r.year),
      income: isNum(r.income) ? Math.round(r.income) : null,
      claimed: isNum(r.claimed) ? Math.round(r.claimed) : null,
      balance: isNum(r.balance) ? Math.round(r.balance) : null,
    })).sort((a, b) => a.year - b.year);
  }

  // 체험 결과를 입력과 맞춰 볼 때 쓰는 열쇠(입력이 하나라도 다르면 달라진다)
  function inputKey(years, rules) {
    const key = JSON.stringify([normalize(years).map((r) => [r.year, r.income, r.claimed, r.balance]), rules && rules.carryYears]);
    let h1 = 0x811c9dc5, h2 = 5381;
    for (let i = 0; i < key.length; i++) { const ch = key.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + ch) >>> 0; }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + key.length.toString(16);
  }

  function analyze(yearsIn, rules) {
    const years = normalize(yearsIn);
    const rows = [], warnings = [], notes = [];
    let pools = [];            // [{ year, remaining }] 오래된 것부터
    let chainBroken = false;   // 앞 해 값을 몰라 이후를 계산할 수 없음
    let rootYear = null;       // 처음 어긋난 해

    const warn = (year, code, msg, detail) => {
      warnings.push({ year, code, msg, detail: detail || '', downstream: rootYear != null && year > rootYear });
      if (rootYear == null) rootYear = year;
    };
    const sum = (ps) => ps.reduce((s, p) => s + p.remaining, 0);

    for (const y of years) {
      const row = { year: y.year, income: y.income, claimed: y.claimed, reportedBalance: y.balance,
        status: 'ok', opening: null, occurred: 0, computedDeduction: null, diff: null, expired: 0, closing: null, expiresBy: null, flags: [] };
      rows.push(row);

      if (y.income == null) {
        row.status = 'unknown';
        row.note = '소득금액을 몰라 이 해와 이후 해를 점검하지 못합니다.';
        chainBroken = true;
        continue;
      }
      if (chainBroken) {
        row.status = 'unchecked';
        row.note = '앞 해의 값을 몰라 이 해의 이월 잔액을 계산하지 못합니다.';
        continue;
      }

      // 공제 가능 기한이 지난 결손금은 이 해부터 쓸 수 없다
      row.opening = sum(pools);
      const kept = [];
      for (const p of pools) {
        const last = lastUsableYear(p.year, rules);
        if (last != null && y.year > last) row.expired += p.remaining; else kept.push(p);
      }
      pools = kept;
      const usable = sum(pools);

      // 이월결손금 공제: 오래된 것부터, 그 해 소득금액 범위 안에서
      let want = y.income > 0 ? Math.min(usable, y.income) : 0, deducted = 0;
      for (const p of pools) {
        if (want <= 0) break;
        const take = Math.min(p.remaining, want);
        p.remaining -= take; want -= take; deducted += take;
      }
      pools = pools.filter((p) => p.remaining > 0);
      row.computedDeduction = deducted;

      // 이 해에 새로 생긴 결손금
      if (y.income < 0) { row.occurred = -y.income; pools.push({ year: y.year, remaining: -y.income }); }
      row.closing = sum(pools);
      const ends = pools.map((p) => lastUsableYear(p.year, rules)).filter((v) => v != null);
      row.expiresBy = ends.length ? Math.min(...ends) : null;
      if (y.year < (rules.unverifiedBeforeYear || 0)) notes.push(`${y.year}년 이전 결손금의 공제 기한 규칙은 확인되지 않았습니다.`);

      // 신고서 값과 비교
      if (y.claimed != null) row.diff = y.claimed - deducted;
      const before = warnings.length;
      if (row.opening > 0 && y.income > 0 && y.claimed === 0 && deducted > 0) {
        warn(y.year, 'R-1', '공제할 이월결손금이 남아 있는데 신고서의 공제액이 0원입니다(공제 누락 가능).',
          `계산상 공제 가능 ${deducted.toLocaleString('ko-KR')}원`);
      } else if (y.claimed != null && y.claimed !== deducted) {
        warn(y.year, 'R-2', y.claimed < deducted ? '신고서 공제액이 계산한 공제 가능액보다 적습니다.' : '신고서 공제액이 계산한 공제 가능액보다 많습니다.',
          `신고서 ${y.claimed.toLocaleString('ko-KR')}원 / 계산 ${deducted.toLocaleString('ko-KR')}원`);
      }
      if (row.expired > 0) {
        row.flags.push('expired');
        notes.push(`${y.year}년: 공제 기한이 지나 소멸하는 결손금 ${row.expired.toLocaleString('ko-KR')}원이 있습니다(기한 규칙 확인 필요).`);
      }
      if (y.balance != null && y.balance !== row.closing) {
        if (y.balance === 0 && row.closing > 0) {
          warn(y.year, 'R-3', '공제할 수 있는 기간인데 신고서의 이월결손금 잔액이 0원입니다(소멸 처리 오류 가능).',
            `신고서 0원 / 계산 ${row.closing.toLocaleString('ko-KR')}원`);
        } else if (warnings.length === before) {
          warn(y.year, 'R-5', '신고서의 이월결손금 잔액이 계산한 잔액과 다릅니다.',
            `신고서 ${y.balance.toLocaleString('ko-KR')}원 / 계산 ${row.closing.toLocaleString('ko-KR')}원`);
        }
      }
      if (y.claimed != null && y.claimed > 0 && y.income <= 0) {
        warn(y.year, 'R-6', '소득금액이 0 이하인데 공제액이 있습니다. 입력한 값(부호, 연도)을 확인해 주세요.');
      }
      if (y.claimed != null && y.income > 0 && y.claimed > y.income) {
        warn(y.year, 'R-6', '공제액이 그 해 소득금액보다 큽니다. 입력한 값을 확인해 주세요.');
      }
      if (warnings.length > before) { row.status = 'warn'; row.flags.push(...warnings.slice(before).map((w) => w.code)); }
    }

    // 계산상 더 공제할 수 있었던 금액의 합(참고. 환급액이 아니다)
    const missed = rows.reduce((s, r) => s + (r.diff != null && r.diff < 0 ? -r.diff : 0), 0);
    const checked = rows.filter((r) => r.status === 'ok' || r.status === 'warn').length;
    return {
      rows, warnings, notes: [...new Set(notes)],
      summary: { years: rows.length, checked, unchecked: rows.length - checked, warned: new Set(warnings.map((w) => w.year)).size, rootYear, missedDeduction: missed },
    };
  }

  return { analyze, inputKey, normalize, lastUsableYear };
}

if (typeof globalThis !== 'undefined') globalThis.RentalLedgerRefundFactory = createRefund;
if (typeof module !== 'undefined' && module.exports) module.exports = createRefund;
