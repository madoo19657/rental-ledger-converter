'use strict';
/*
 * 장부선생 유료 계산 모듈: 조정계산서(별지 제46호), 조정후 총수입금액명세서, 소득금액조정합계표,
 * 홈택스 입력값, 기장세액공제. 체험 버전에는 이 파일이 들어 있지 않고, 이용권 확인 뒤 서버에서 받는다.
 * 팩토리 형태: create({ fmtWon }) → { runPaid, ...함수들 }
 */
function create({ fmtWon, ADJUSTMENT_KINDS, INCOME_TYPES }) {
// ───────────────────────── 기장세액공제 ─────────────────────────
function bookkeepingCredit({ computedTax, bookIncome, totalIncome, rate = 0.2, cap = 1000000 }) {
  if (!(totalIncome > 0) || !(bookIncome > 0)) return { amount: 0, uncapped: 0, capped: false };
  const uncapped = Math.floor(computedTax * (bookIncome / totalIncome) * rate);
  const amount = Math.min(uncapped, cap);
  return { amount, uncapped, capped: uncapped > cap };
}

// ───────────────────────── 조정계산서 (별지 제46호) ─────────────────────────
// ⑩ 결산서상 당기순이익 + ⑪ − ⑫ = ⑬,  ⑬ + ⑭ − ⑮ = ⑯
function adjustmentStatement({ netIncome, deemedRent = 0, deemedMode = 'recompute', adjustments = [],
  donationExcess = 0, donationCarryover = 0, incomeType = '30', agent = {}, interestIncome = 0 }) {
  if (!INCOME_TYPES[incomeType]) throw new Error('소득구분 코드 오류: ' + incomeType);
  const items11 = [], items12 = [], byKind = {};
  if (deemedRent) {
    items11.push({
      label: '임대보증금 간주임대료 (' + (deemedMode === 'asEntered' ? '원본 입력값' : '별지 제53호 재계산') + ')',
      amount: deemedRent, source: 'auto', kind: 'addIncome', kindLabel: ADJUSTMENT_KINDS.addIncome.label,
      subject: '임대보증금 간주임대료', code: '', reason: '', autoNote: '자동 반영(간주임대료)',
    });
  }
  if (interestIncome) {
    // 결산서상 당기순이익에 들어 있는 보증금 예금이자는 이자소득이라 사업소득금액에서 뺀다
    items12.push({
      label: '보증금 이자수익 불산입 (이자소득, 사업소득 아님)', amount: interestIncome, source: 'auto', kind: 'excludeIncome',
      kindLabel: ADJUSTMENT_KINDS.excludeIncome.label, subject: '보증금 이자수익', code: '', reason: '',
      autoNote: '자동 반영(영업외수익 이자수익은 사업소득에서 제외)',
    });
    byKind.excludeIncome = (byKind.excludeIncome || 0) + interestIncome;
  }
  for (const a of adjustments) {
    const kind = ADJUSTMENT_KINDS[a.kind];
    if (!kind) throw new Error('조정 종류 오류: ' + a.kind);
    if (!Number.isFinite(a.amount) || a.amount < 0) throw new Error(`조정 금액은 0 이상이어야 함: ${a.amount}`);
    if (a.amount === 0) continue;
    const item = {
      label: kind.label + (a.reason ? ': ' + a.reason : ''), amount: Math.round(a.amount), source: 'user',
      kind: a.kind, kindLabel: kind.label, subject: a.reason || kind.label, code: a.code || '', reason: a.reason || '',
    };
    (kind.cell === 11 ? items11 : items12).push(item);
    byKind[a.kind] = (byKind[a.kind] || 0) + item.amount;
  }
  const sum = (xs) => xs.reduce((s, x) => s + x.amount, 0);
  const c10 = netIncome, c11 = sum(items11), c12 = sum(items12);
  const c13 = c10 + c11 - c12;
  const c14 = Math.round(donationExcess), c15 = Math.round(donationCarryover);
  const c16 = c13 + c14 - c15;
  return {
    incomeType, incomeTypeLabel: INCOME_TYPES[incomeType],
    c10, c11, c12, c13, c14, c15, c16, items11, items12, agent,
    // 홈택스 간편장부소득금액계산서(별지 제82호)의 입력칸과 대응: 46호 ⑪ = 82호 13 + 16, 46호 ⑫ = 82호 12 + 17
    form82: {
      c12: byKind.excludeIncome || 0,                     // 수입금액에서 제외할 금액
      c13: deemedRent + (byKind.addIncome || 0),          // 수입금액에 가산할 금액 (간주임대료 포함)
      c16: byKind.disallowExpense || 0,                   // 필요경비에서 제외할 금액
      c17: byKind.allowExpense || 0,                      // 필요경비에 가산할 금액
    },
  };
}

// ───────────────────────── 조정후 총수입금액명세서 (F-30) ─────────────────────────
// 소득세 총수입금액(4번)을 부가가치세 과세표준 + 조정(증가·감소)과 맞춰 보는 서식. 화면 번호는 홈택스 기준(S12).
// vat: { taxBase, zeroRate, exempt, deemedRent } = 부가세 신고서 값. null이면 8~12번과 16번을 비운다.
function adjustedRevenueStatement({ revenue, industryCode = '701201', deemedRent = 0, addItems = [], vat = null }) {
  const increases = addItems.map((x) => ({ subject: x.subject || x.label, amount: x.amount, note: x.reason || '' }));
  const decreases = [];
  let v = null;
  if (vat && vat.taxBase != null) {
    const c8 = vat.taxBase, c9 = vat.zeroRate || 0, c10 = c8 + c9, c11 = vat.exempt || 0;
    v = { c8, c9, c10, c11, c12: c10 + c11 };
    // 소득세 간주임대료와 부가세법 간주임대료는 다르다. 부가세 과세표준에는 후자가 들어 있다.
    const diff = deemedRent - (vat.deemedRent || 0);
    if (diff > 0) increases.unshift({ subject: '간주임대료 차이 (소득세 − 부가세법)', amount: diff, note: '부가세법상 간주임대료를 입력하지 않았으면 0원으로 계산' });
    if (diff < 0) decreases.unshift({ subject: '간주임대료 차이 (소득세 − 부가세법)', amount: -diff, note: '부가세법상 간주임대료가 더 큼' });
  }
  const sum = (xs) => xs.reduce((s, x) => s + x.amount, 0);
  const c13 = sum(increases), c14 = sum(decreases);
  const c16 = v ? v.c12 + c13 - c14 : null;
  return {
    industryCode, c4: revenue, c5: revenue, c6: 0, c7: 0, vat: v, increases, decreases, c13, c14, c16,
    residual: c16 == null ? null : revenue - c16, // 0이어야 한다. 아니면 설명되지 않은 차액
  };
}

// ───────────────────────── 소득금액조정합계표 (별지 제47호, F-31) ─────────────────────────
// 서식 원본의 칸 배치는 확인하지 못했다(과목, 과목코드, 금액 열만 확인). 값을 구역별로 정리한 작성 자료다.
function incomeAdjustmentTable(a) {
  const mk = (items) => items.map((x) => ({
    subject: x.subject, code: x.code || '', amount: x.amount, kind: x.kindLabel,
    note: x.source === 'auto' ? (x.autoNote || '자동 반영') : (x.reason || ''),
  }));
  return {
    required: a.c11 + a.c12 > 0,
    sections: [
      { id: 'add', title: '총수입금액산입 및 필요경비불산입', cell: 11, items: mk(a.items11), total: a.c11 },
      { id: 'sub', title: '필요경비산입 및 총수입금액불산입', cell: 12, items: mk(a.items12), total: a.c12 },
    ],
  };
}

// ───────────────────────── 홈택스 입력값 (복식부기 자기조정 화면 순서) ─────────────────────────
// 화면 흐름과 값의 근거: docs/hometax-double-entry-flow.md (S12). 값이 null이면 사용자 입력이 더 필요한 칸이다.
function hometaxInputs(r, settings, params) {
  const inc = r.statements.income, bal = r.statements.balance, a = r.adjustment, f = a.form82;
  const row = (no, code, label, value, note) => ({ no: no || '', code: code == null ? '' : String(code), label, value, note: note || '' });
  const filing = settings.filingType === '12' ? '12' : '11';
  const industry = settings.industryCode || '701201';
  // 사업소득명세서: 필요경비는 조정 후 값, 총수입금액은 소득금액 + 필요경비로 역산한다
  const expense = inc.necessaryExpense - f.c16 + f.c17;
  const revenue = a.c16 + expense;
  const screens = [];

  screens.push({
    id: 'basic', menu: '01 기본사항 › 소득종류 · 사업장 명세', title: '기본사항',
    rows: [
      row('', '', '귀속연도', String(settings.year)),
      row('', '', '소득종류', '부동산임대업의 사업소득', '[나의 소득종류 찾기]에서 해당 소득만 체크하고 [적용하기]'),
      row('', '', '업종코드', industry, '사업자등록번호를 [조회]하면 채워지는 값과 같은지 확인'),
      row('', '', '소득구분', a.incomeType + ' ' + a.incomeTypeLabel),
      row('', '', '기장의무', '간편장부대상자', '실제 기장의무는 본인이 직접 판단. 복식부기의무자면 기장세액공제를 받을 수 없음'),
      row('', '', '신고유형', filing === '12' ? '12 복식부기-외부조정' : '11 복식부기-자기조정', filing === '12' ? '세무대리인 정보 입력, 부속서류는 세무대리인이 제출' : '[등록하기] 후 사업장 명세에 11로 표시됨'),
      row('', '', '소재지 / 공동사업자 여부', '국내 / 부', '공동사업이면 여'),
    ],
  });

  const adjNotes11 = a.items11.map((x) => x.label + ' ' + fmtWon(x.amount)).join(' + ');
  const adjNotes12 = a.items12.map((x) => x.label + ' ' + fmtWon(x.amount)).join(' + ');
  screens.push({
    id: 'adj', menu: '02 소득금액명세서 › 조정신고 › 조정계산서', title: '조정계산서 (별지 제46호)',
    rows: [
      row('10', '', '결산서상 당기순이익', a.c10, '표준손익계산서의 당기순이익'),
      row('11', '', '총수입금액산입 및 필요경비불산입', a.c11, adjNotes11 || '해당 없음'),
      row('12', '', '필요경비산입 및 총수입금액불산입', a.c12, adjNotes12 || '해당 없음'),
      row('13', '', '차가감소득 (10+11−12)', a.c13, '자동 계산'),
      row('14', '', '기부금한도초과액', a.c14),
      row('15', '', '기부금이월액 중 필요경비 산입액', a.c15),
      row('16', '', '당해과세기간 소득 (13+14−15)', a.c16, '자동 계산'),
    ],
    notes: [filing === '11' ? '자기조정이고 세무조정(11·12번에 금액)이 있으면 별지 제47호 소득금액조정합계표와 제53호 조정명세서를 PDF 부속서류로 직접 첨부해야 한다 (아직 도구에서 출력하지 못함).' : '외부조정이면 세무대리인이 조정 서류를 제출한다.'],
  });

  const a_ = bal.assets, l_ = bal.liabilities, e_ = bal.equity;
  const ar = r.adjustedRevenue;
  const arRows = [
    row('', '', '업종코드', ar.industryCode, '[코드조회] 클릭'),
    row('4', '', '총수입금액 계 (5+6+7)', ar.c4, '사업소득명세서 수입금액과 같은 값'),
    row('5', '', '내수 › 국내생산품', ar.c5),
    row('6', '', '내수 › 수입상품', ar.c6),
    row('7', '', '수출', ar.c7),
    row('8', '', '부가가치세 과세표준 일반', ar.vat ? ar.vat.c8 : null, '부가세 1기·2기 신고서 과세표준 합계. 이 도구의 "부가세 신고서 값"에 넣으면 채워짐'),
    row('9', '', '부가가치세 과세표준 영세율', ar.vat ? ar.vat.c9 : null),
    row('10', '', '과세표준 계 (8+9, 자동)', ar.vat ? ar.vat.c10 : null),
    row('11', '', '면세사업 수입금액', ar.vat ? ar.vat.c11 : null),
    row('12', '', '합계 (10+11, 자동)', ar.vat ? ar.vat.c12 : null),
  ];
  ar.increases.forEach((x) => arRows.push(row('13', '', '총수입금액 조정 증가 › 과목: ' + x.subject, x.amount, x.note)));
  arRows.push(row('13', '', '총수입금액 조정 증가 합계', ar.c13, ar.increases.length ? '[작성] 팝업에서 과목·금액·적요를 입력하고 [등록하기] → [적용하기]' : '해당 없음'));
  ar.decreases.forEach((x) => arRows.push(row('14', '', '총수입금액 조정 감소 › 과목: ' + x.subject, x.amount, x.note)));
  arRows.push(row('14', '', '총수입금액 조정 감소 합계', ar.c14, ar.decreases.length ? '[작성] 팝업에서 입력' : '해당 없음'));
  arRows.push(row('16', '', '조정후 총수입금액 (12+13−14)', ar.c16,
    ar.residual == null ? '부가세 신고서 값을 넣으면 계산됨' : (ar.residual === 0 ? '4번과 같음' : `4번과 ${fmtWon(ar.residual)}원 차이 — 설명되지 않은 차액`)));
  screens.push({
    id: 'adjrev', menu: '02 소득금액명세서 › 조정신고 › 조정후 총수입금액명세서', title: '조정후 총수입금액명세서',
    rows: arRows,
    notes: ['12+13−14가 4번과 같아야 한다. 같지 않으면 부가세 신고서의 간주임대료·면세·영세율 수입을 확인한다.',
      '8번 과세표준에는 부가세법상 간주임대료가 들어 있다. 소득세 간주임대료(별지 제53호)와 다르면 그 차이가 13·14번 항목으로 나온다.'],
  });

  const bsRows = [row('', '03', '현금 및 현금성자산', a_.cash)];
  if (a_.vatIn) bsRows.push(row('', '17', '기타 당좌자산 (부가세대급금)', a_.vatIn));
  if (a_.land) bsRows.push(row('', '39', '토지 (취득가액, 감가상각 안 함)', a_.land));
  bsRows.push(row('', '40', '건물 (장부가액 = 취득가 − 감가상각누계액)', a_.buildingNet, `취득가 ${fmtWon(a_.building)}원, 감가상각누계액 ${fmtWon(a_.accumDep)}원`));
  if (l_.vatOut) bsRows.push(row('', '68', '예수금 (부가세예수금)', l_.vatOut));
  if (l_.loan) bsRows.push(row('', '77', '장기차입금 ③기타', l_.loan, '74 장기차입금은 자동 합계. 단기 상환 예정이면 64 단기차입금'));
  bsRows.push(row('', '81', '임대보증금', l_.deposit));
  bsRows.push(row('', '88', '자본금', e_.capital, '개시 자본. 사업주 인출·투입이 반영된 값'));
  bsRows.push(row('', '89', '당기순이익', e_.netIncome));
  bsRows.push(row('', '62', '자산총계 (자동)', a_.total));
  bsRows.push(row('', '87', '부채총계 (자동)', l_.total));
  bsRows.push(row('', '90', '자본총계 (자동)', e_.total));
  bsRows.push(row('', '91', '부채및자본총계 (자동)', bal.liabilitiesAndEquity, `자산총계 − 부채및자본총계 = ${fmtWon(bal.difference)}`));
  screens.push({
    id: 'bs', menu: '02 소득금액명세서 › 조정신고 › 표준재무상태표', title: '표준재무상태표',
    rows: bsRows,
    notes: [a_.land ? '토지(코드 39)는 취득가액을 그대로 입력한다. 감가상각하지 않는다.'
      : '임대 건물의 토지분 취득가액을 입력하지 않았다. 토지가 있으면 코드 39에 취득가액을 직접 입력해야 하며, 자산총계와 자본금이 그만큼 달라진다.',
      '사업장이 둘 이상이면 사업장을 선택해 사업장별로 입력하고 [등록하기]를 누른다.'],
  });

  const isRows = [
    row('', '01', '매출액', inc.revenue, '자동 합계'),
    row('', '06', '5. 임대수입', inc.revenue),
    row('', '21', '판매비와관리비 합계', inc.sgaTotal, '항목별 입력 후 자동'),
  ];
  inc.sga.forEach((s) => isRows.push(row('', s.code, s.name, s.amount)));
  isRows.push(row('', '62', '영업손익 (매출액 − 판매비와관리비, 자동)', inc.operatingIncome));
  isRows.push(row('', '63', '영업외수익 (자동)', inc.nonOperatingIncomeTotal));
  isRows.push(row('', '64', '영업외수익 › 1. 이자수익', inc.nonOperatingIncome[0].amount, inc.nonOperatingIncomeTotal ? '보증금 예금이자. 조정계산서 12번에서 총수입금액불산입' : ''));
  isRows.push(row('', '81', '영업외비용 (자동)', inc.nonOperating[0].amount));
  isRows.push(row('', '82', '영업외비용 › 1. 이자비용', inc.nonOperating[0].amount));
  isRows.push(row('', '99', '당기순손익 (62+63−81)', inc.netIncome, '조정계산서 10번에 들어가는 값'));
  screens.push({
    id: 'is', menu: '02 소득금액명세서 › 조정신고 › 표준손익계산서', title: '표준손익계산서',
    rows: isRows,
    notes: [r.vatDeemedTax ? `세금과공과(34)에 부가세법상 간주임대료의 부가세 ${fmtWon(r.vatDeemedTax)}원이 들어 있다(임대인 부담, 부가세예수금으로 대응).` : null,
      inc.nonOperatingIncomeTotal
      ? '보증금 이자수익은 영업외수익(코드 64)으로 장부에 들어 있고, 조정계산서 12번에 같은 금액이 총수입금액불산입으로 자동 들어갔다.'
      : '보증금 이자수익이 없다. 있으면 "보증금 이자수익" 입력란에 넣으면 영업외수익으로 반영되고 조정계산서 12번에도 자동으로 들어간다.'].filter(Boolean),
  });

  screens.push({
    id: 'cost', menu: '02 소득금액명세서 › 조정신고 › 표준원가명세서', title: '표준원가명세서',
    rows: [row('', '', '제조·공사·분양·기타원가', '해당 없음', '임대업은 입력 없이 [저장 후 다음이동]')],
  });

  const rentLabel = a.incomeType === '32' ? '주택임대소득' : '주택 외 임대소득 (상가, 토지 등)';
  screens.push({
    id: 'biz', menu: '02 소득금액명세서 › 사업소득명세서 및 원천징수세액 › 부동산 임대소득 명세', title: '사업소득명세서',
    rows: [
      row('', '', rentLabel + ' › 수입금액', revenue, '소득금액 + 필요경비로 역산한 조정 후 총수입금액'),
      row('', '', rentLabel + ' › 필요경비', expense, '판매비와관리비 + 이자비용 ± 필요경비 조정'),
      row('', '', rentLabel + ' › 소득금액', a.c16, '조정계산서 16번과 같아야 함'),
    ],
    notes: ['사업소득명세서 위쪽 표(총수입금액, 필요경비, 소득금액)와 이 부동산 임대소득 명세에 같은 금액을 입력한다.'],
  });

  const cr = settings.credit && settings.credit.computedTax ? settings.credit : null;
  const cap = params.bookkeepingCredit.cap;
  const rate = params.bookkeepingCredit.rate;
  const bookIncome = cr && cr.bookIncome ? cr.bookIncome : a.c16;
  const known = !!(cr && cr.totalIncome > 0 && r.credit);
  screens.push({
    id: 'credit', menu: '08 세액공제·감면·준비금 › 기장세액공제신청서', title: '기장세액공제신청서 (별지 제10호의3)',
    rows: [
      row('8', '', '총수입금액', revenue, '사업소득명세서 수입금액과 같은 값'),
      row('9', '', '종합소득금액', cr ? cr.totalIncome : null, '세액공제신청서 화면 위쪽에 표시된 값을 메모해 입력 (이 도구에 신고서 값을 넣으면 채워짐)'),
      row('10', '', '기장소득금액', bookIncome, '부동산임대소득 외 다른 소득이 없으면 9번과 같은 금액'),
      row('11', '', '종합소득산출세액', cr ? cr.computedTax : null, '세액공제신청서 화면 위쪽에 표시된 값을 메모해 입력'),
      row('12', '', `공제대상세액 (10÷9×11×${Math.round(rate * 100)}%, 자동)`, known ? r.credit.uncapped : null),
      row('13', '', '공제한도 (자동)', cap),
      row('14', '', '공제할세액 (12와 13 중 작은 금액, 자동)', known ? r.credit.amount : null, known && r.credit.capped ? '한도 적용됨' : ''),
    ],
    notes: ['9번과 11번은 홈택스가 03~05 화면까지 입력한 뒤 계산해 보여 주는 값이다. 먼저 홈택스에서 그 값을 확인해 이 도구에 넣으면 공제액을 미리 계산할 수 있다.'],
  });

  screens.push({
    id: 'credit2', menu: '08 세액공제·감면·준비금 › 세액감면·공제·준비금 명세서', title: '세액공제 명세서',
    rows: [
      row('', '', '표준세액공제', params.standardTaxCredit, '사업소득만 있고 근로소득이 없는 경우의 금액(사례 A, 사례 D). 근로소득·성실사업자 여부에 따라 달라지니 화면 도움말 확인'),
      row('', '', '기장세액공제', known ? r.credit.amount : null, '기장세액공제신청서 등록 후 자동 입력'),
      row('', '', '종합소득세 전자신고세액공제', '자동 입력', '직접 전자신고하면 자동 입력됨 (2020년 사례 20,000원). 세무대리인이 신고하면 해당 없을 수 있음'),
    ],
  });

  const hasDeposit = (settings.openingBalances.deposit || 0) > 0 || (settings.deposits || []).some((d) => d.amount > 0);
  screens.push({
    id: 'attach', menu: '신고서 접수 후 › 증빙서류제출 › 신고 부속서류 제출', title: '부속서류',
    rows: [
      row('', '', '별지 제47호 소득금액조정합계표', r.incomeAdjustment.required ? '첨부 필요' : '해당 없음',
        filing === '11' ? '자기조정 + 세무조정이 있으면 PDF로 직접 첨부 ("소득금액조정합계표" 탭)' : '외부조정은 세무대리인이 제출'),
      row('', '', '별지 제53호 임대보증금 등의 총수입금액 조정명세서', hasDeposit || r.enteredDeemedRent > 0 ? '첨부 필요' : '해당 없음',
        '계산은 "대사·계산근거" 탭. 서식 출력은 아직 없음'),
      row('', '', '제출 방법', 'PDF', 'PDF만 가능(이미지는 자동 변환), 한 번에 50MB 이하, 육안으로 식별 가능해야 함. 신고서를 수정해 다시 내면 부속서류도 다시 제출'),
    ],
  });

  return { screens, revenue, expense, income: a.c16 };
}


// run()에서 호출하는 유료 파이프라인 구간
function runPaid({ st, settings, taxParams, deemedUsed, mode, warnings }) {
  const adj = adjustmentStatement({
    netIncome: st.income.netIncome, deemedRent: deemedUsed, deemedMode: mode,
    adjustments: settings.adjustments || [], donationExcess: settings.donationExcess || 0,
    donationCarryover: settings.donationCarryover || 0, incomeType: settings.incomeType || '30',
    agent: settings.agent || {}, interestIncome: st.income.nonOperatingIncomeTotal,
  });
  const taxableIncome = adj.c16; // 조정계산서 ⑯ 해당 과세기간 소득
  const expenseAdj = st.income.necessaryExpense - adj.form82.c16 + adj.form82.c17;
  const vatSet = settings.vatTaxBase != null && settings.vatTaxBase !== ''
    ? { taxBase: Number(settings.vatTaxBase), zeroRate: Number(settings.vatZeroRate || 0), exempt: Number(settings.vatExempt || 0), deemedRent: Number(settings.vatDeemedRent || 0) }
    : null;
  const adjustedRevenue = adjustedRevenueStatement({
    revenue: adj.c16 + expenseAdj, industryCode: settings.industryCode || '701201', deemedRent: deemedUsed,
    addItems: adj.items11.filter((x) => x.source === 'user' && x.kind === 'addIncome'), vat: vatSet,
  });
  if (adjustedRevenue.residual) {
    warnings.push({ row: null, code: 'F-30', level: 'warn',
      msg: `조정후 총수입금액명세서 차액 ${adjustedRevenue.residual}원: 4번 총수입금액과 16번(12+13−14)이 다름. 부가세 신고서 값과 조정 항목을 확인` });
  }
  const credit = settings.credit && settings.credit.computedTax
    ? bookkeepingCredit({
        computedTax: settings.credit.computedTax,
        bookIncome: settings.credit.bookIncome || taxableIncome,
        totalIncome: settings.credit.totalIncome,
        rate: taxParams.bookkeepingCredit.rate, cap: taxParams.bookkeepingCredit.cap,
      })
    : null;
  return { adj, adjustedRevenue, taxableIncome, credit, incomeAdjustment: incomeAdjustmentTable(adj) };
}

  return { runPaid, bookkeepingCredit, adjustmentStatement, ADJUSTMENT_KINDS, INCOME_TYPES, hometaxInputs, adjustedRevenueStatement, incomeAdjustmentTable };
}

if (typeof globalThis !== 'undefined') globalThis.RentalLedgerPaidFactory = create;
if (typeof module !== 'undefined' && module.exports) module.exports = create;
