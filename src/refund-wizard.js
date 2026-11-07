// ── 환급 점검: 단계별 마법사 (docs/PRD-refund-check.md §3.0, §3.1-1) ──
// template.html의 닫힌 범위 안에 들어가는 조각이다. $, $$, esc, fmt, toast, openLic, locked, license, E, RR, REFUND_RULES, REFUND_DEMO를 쓴다.
// 한 화면에 한 가지 일만 시키고, 끝나는 조건을 채워야 "다음"이 열린다. 값은 브라우저 안에서만 쓴다.
var RC_LATEST = (DEFAULTS && DEFAULTS.year) || 2025;
var rc = { open: false, mode: null, step: 0, start: RC_LATEST - 6, end: RC_LATEST, years: [], ack: false, ok: false };

var RC_WARN_TIP = {
  'R-1': '그 해 신고서의 "결손금·이월결손금공제명세서"에서 부동산임대업(주택임대업 제외) 줄의 공제금액이 비어 있는지 확인하세요.',
  'R-2': '신고서 공제액과 계산한 공제 가능액의 차이가 어디서 생겼는지 명세서의 발생연도별 공제 내역을 확인하세요.',
  'R-3': '신고서의 이월결손금 잔액이 0으로 적혔는지, 소멸 처리가 맞는지 확인하세요(기한 규칙은 확인 전 값입니다).',
  'R-5': '신고서의 잔액과 계산한 잔액이 다릅니다. 앞 해부터 공제액·잔액을 차례로 맞춰 보세요.',
  'R-6': '입력한 값의 부호(결손이면 -)와 연도, 공제 명세서의 줄(임대업/임대업 외)을 다시 확인하세요.',
};

function rcFmtIn(v) { return v == null ? '' : v.toLocaleString('ko-KR'); }
function rcParse(s) {
  var t = String(s == null ? '' : s).replace(/[,\s원]/g, '').replace(/[−–]/g, '-');
  if (t === '') return { empty: true, v: null };
  return /^-?\d+$/.test(t) ? { empty: false, v: Number(t) } : { empty: false, v: null, bad: true };
}
function rcYearsFromRange() {
  var old = {};
  rc.years.forEach(function (y) { old[y.year] = y; });
  rc.years = [];
  for (var yr = rc.start; yr <= rc.end; yr++) rc.years.push(old[yr] || { year: yr, income: null, claimed: null, balance: null, unk: {} });
}
function rcInputs() {
  return rc.years.map(function (y) {
    return { year: y.year, income: y.unk.income ? null : y.income, claimed: y.unk.claimed ? null : y.claimed, balance: y.unk.balance ? null : y.balance };
  });
}
function rcAnalyze() {
  if (rc.mode === 'demo') return REFUND_DEMO.result;
  if (RR) return RR.analyze(rcInputs(), REFUND_RULES);
  return null;
}

function rcSteps() {
  var n = rc.years.length || (rc.end - rc.start + 1);
  var s = [{ t: 'intro', label: '시작' }, { t: 'range', label: '점검할 해' }, { t: 'open', label: '신고서 열기' }];
  for (var i = 0; i < n; i++) s.push({ t: 'year', i: i, label: ((rc.years[i] && rc.years[i].year) || (rc.start + i)) + '년 입력' });
  s.push({ t: 'confirm', label: '입력 확인' }, { t: 'result', label: '결과' });
  s.push({ t: 'guide', label: '확인 방법' }, { t: 'summary', label: '요약' });
  return s;
}

function rcCanNext(st) {
  if (st.t === 'intro') return !!rc.mode;
  if (st.t === 'range') return rc.mode === 'demo' || (rc.end >= rc.start && rc.end - rc.start <= 11);
  if (st.t === 'open') return rc.ack;
  if (st.t === 'year') {
    if (rc.mode === 'demo') return true;
    var y = rc.years[st.i];
    return !!y && (y.unk.income || y.income != null) && (y.unk.claimed || (y.claimed != null && y.claimed >= 0)) && (y.balance == null || y.balance >= 0);
  }
  if (st.t === 'confirm') return rc.ok;
  return true;
}

function rcNextLabel(steps, idx) {
  var nx = steps[idx + 1];
  if (!nx) return '';
  return '다음: ' + nx.label;
}

// ── 화면 조각 ──
function rcDiagram() {
  return '<svg class="rc-diagram" viewBox="0 0 560 110" role="img" aria-label="결손이 난 해의 금액이 소득이 있는 해에 공제되고 남은 금액은 다음 해로 넘어가는 그림">' +
    '<rect x="6" y="20" width="150" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="81" y="50" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">결손이 난 해</text><text x="81" y="72" text-anchor="middle" font-size="12" fill="currentColor">예) -3,000만 원</text>' +
    '<path d="M160 55h46m0 0-8-6m8 6-8 6" stroke="currentColor" stroke-width="2" fill="none"/>' +
    '<rect x="210" y="20" width="150" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="285" y="50" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">소득이 있는 해</text><text x="285" y="72" text-anchor="middle" font-size="12" fill="currentColor">그만큼 소득에서 뺌</text>' +
    '<path d="M364 55h46m0 0-8-6m8 6-8 6" stroke="currentColor" stroke-width="2" fill="none"/>' +
    '<rect x="414" y="20" width="140" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/><text x="484" y="50" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">남은 금액</text><text x="484" y="72" text-anchor="middle" font-size="12" fill="currentColor">다음 해로, 기한까지</text></svg>';
}
function rcFormFigure() {
  return '<table class="rc-fig" aria-label="가상 서식 그림"><thead><tr><th>소득 구분</th><th>이월결손금 공제금액</th></tr></thead><tbody>' +
    '<tr><td>사업소득 (그 외)</td><td class="n">…</td></tr>' +
    '<tr class="hl"><td>부동산임대업 (주택임대업 제외)</td><td class="n">여기 금액 <span class="rc-arrow">← 이 줄</span></td></tr></tbody></table>' +
    '<p class="rc-small">가상 서식 그림입니다. 실제 화면과 모양이 다를 수 있으니 줄 이름을 기준으로 찾으세요.</p>';
}
function rcHelp(summary, body) { return '<details class="rc-help"><summary>' + esc(summary) + '</summary><div>' + body + '</div></details>'; }
function rcRulesBadge() {
  return REFUND_RULES && REFUND_RULES.status === '확인 필요' ? '<p class="rc-badge" role="note">세법 규칙(공제 순서·기한)은 아직 확인 전 값입니다. 결과는 참고용입니다.</p>' : '';
}

function rcStepIntro() {
  return '<h2 tabindex="-1">이월결손금, 놓치고 있지 않은지 점검해 보세요</h2>' +
    '<p>임대 사업에서 <b>손해(결손)</b>가 난 해가 있으면, 그 금액은 사라지지 않고 <b>다음 해들의 임대 소득에서 빼 줍니다</b>. 이것이 이월결손금입니다. 한 해라도 신고서에 빠지거나 틀리면 뒤 해들이 모두 어긋납니다.</p>' +
    rcDiagram() +
    '<ul class="rc-list"><li>부동산임대업(주택임대업 제외)의 결손만 다룹니다. 임대 소득이 있는 해에만 빠집니다.</li>' +
    '<li>오래된 결손부터 공제하고, 정해진 기간이 지나면 소멸합니다(기간 규칙은 확인 전 값입니다).</li></ul>' +
    '<div class="rc-two"><div><b>이 점검이 하는 일</b><ul><li>연도별 흐름을 계산해 신고서 값과 비교</li><li>어긋난 해를 짚고 확인할 곳 안내</li></ul></div>' +
    '<div><b>하지 않는 일</b><ul><li>청구 여부나 환급액을 정해 주는 것</li><li>신고·청구 대행, 세무 상담</li></ul></div></div>' +
    rcRulesBadge() +
    '<div class="rc-choose"><button type="button" class="primary" data-rc="pick-demo">가상 예시로 둘러보기</button>' +
    '<button type="button" data-rc="pick-mine">내 값으로 점검하기</button></div>' +
    (rc.mode ? '<p class="rc-small">선택: <b>' + (rc.mode === 'demo' ? '가상 예시' : '내 값') + '</b></p>' : '');
}
function rcStepRange() {
  if (rc.mode === 'demo') {
    var ys = REFUND_DEMO.scenario.years;
    return '<h2 tabindex="-1">점검할 해</h2><p>가상 예시는 <b>' + ys[0].year + '년부터 ' + ys[ys.length - 1].year + '년</b>까지입니다. 값은 예시이며 바꿀 수 없습니다.</p><p class="rc-small">' + esc(REFUND_DEMO.scenario.title) + '</p>';
  }
  var opts = function (sel) {
    var o = '';
    for (var y = RC_LATEST; y >= RC_LATEST - 12; y--) o += '<option value="' + y + '"' + (y === sel ? ' selected' : '') + '>' + y + '년</option>';
    return o;
  };
  return '<h2 tabindex="-1">어느 해부터 어느 해까지 볼까요?</h2>' +
    '<div class="rc-row"><label>시작 해<select data-rc-range="start">' + opts(rc.start) + '</select></label><label>끝 해<select data-rc-range="end">' + opts(rc.end) + '</select></label></div>' +
    '<p id="rcRangeMsg" class="rc-small" role="status"></p>' +
    rcHelp('어느 해를 봐야 하나요?', '<p>결손이 난 <b>가장 오래된 해부터 최근 해까지</b> 고르세요. 언제 결손이 났는지 모르면 최근 6~7년을 고르고 신고서를 차례로 열어 보세요. 이월결손금이 있었다면 신고서의 "결손금·이월결손금공제명세서"에 금액이 보입니다.</p><p>홈택스의 신고 내역은 한 번에 최대 1년 단위로 조회됩니다. 오래된 해는 기간을 나눠 여러 번 조회하세요.</p>');
}
function rcStepOpen() {
  return '<h2 tabindex="-1">홈택스에서 해당 해의 신고서를 여세요</h2>' +
    '<ol class="rc-steps"><li>홈택스에 로그인합니다.</li>' +
    '<li><b>세금신고 &gt; 신고서 조회/삭제/부속서류 &gt; 전자신고 접수증·납부서 출력</b>으로 들어갑니다.</li>' +
    '<li>세목은 <b>종합소득세</b>, 신고일자 기간을 넣어 조회합니다(한 번에 최대 1년).</li>' +
    '<li>목록의 <b>접수번호(신고서보기)</b>를 눌러 그 해 신고서를 엽니다.</li>' +
    '<li>세무서가 결정을 바꾼 해는 <b>나의 홈택스 &gt; 세금신고내역</b>의 경정청구 탭도 확인하세요.</li></ol>' +
    '<p class="rc-small">화면 이름은 홈택스 개편으로 바뀔 수 있습니다. 이름이 다르면 "신고서 조회"와 비슷한 메뉴를 찾아보세요.</p>' +
    '<label class="rc-check"><input type="checkbox" data-rc-ack ' + (rc.ack ? 'checked' : '') + '> 신고서를 열었어요(또는 값을 이미 알고 있어요)</label>';
}
function rcField(key, label, hint, helpBody, y, ro) {
  var unk = !!y.unk[key], val = y[key];
  return '<div class="rc-field"><label for="rc-' + key + '"><b>' + label + '</b>' + (hint ? '<span class="rc-small"> ' + hint + '</span>' : '') + '</label>' +
    '<input id="rc-' + key + '" type="text" inputmode="numeric" autocomplete="off" data-rc-in="' + key + '" value="' + esc(unk ? '' : rcFmtIn(val)) + '"' + (unk || ro ? ' disabled' : '') + ' placeholder="원 단위로 입력">' +
    (ro ? '' : '<label class="rc-check"><input type="checkbox" data-rc-unk="' + key + '" ' + (unk ? 'checked' : '') + '> 값을 못 찾았어요</label>') +
    '<span class="rc-small" id="rc-h-' + key + '" role="status"></span>' + rcHelp('어디서 찾나요?', helpBody) + '</div>';
}
function rcStepYear(i) {
  var y = rc.years[i], ro = rc.mode === 'demo';
  if (!y) return '';
  return '<h2 tabindex="-1">' + y.year + '년 신고서에서 값 찾기 <span class="rc-count">(' + (i + 1) + '/' + rc.years.length + '년)</span></h2>' +
    (ro ? '<p class="rc-badge">가상 값입니다(읽기 전용).</p>' : '<p>' + y.year + '년 귀속 종합소득세 신고서를 열고 아래 값을 찾아 적으세요. 모르면 "값을 못 찾았어요"를 체크하고 넘어가도 됩니다.</p>') +
    rcField('income', '① 부동산임대업 소득금액', '(이월결손금 공제 전. 결손이면 앞에 -를 붙입니다)',
      '<p>신고서의 <b>조정계산서</b> 또는 <b>사업소득명세서</b>에서 부동산임대업(주택임대업 제외)의 <b>소득금액</b>입니다. 이월결손금을 빼기 <b>전</b> 금액이어야 합니다.</p><p>손해가 난 해라면 음수입니다. 예) 결손 3,000만 원 → <b>-30,000,000</b></p>', y, ro) +
    rcField('claimed', '② 신고서의 이월결손금 공제액', '(없거나 0이면 0)',
      '<p>신고서의 <b>결손금·이월결손금공제명세서</b>에서 <b>부동산임대업(주택임대업 제외)</b> 줄의 공제금액입니다. 임대업 외 줄과 헷갈리지 마세요.</p>' + rcFormFigure() + '<p>명세서 자체가 없으면 0으로 적고, 이전에 결손이 있었다면 그 점이 점검 대상입니다.</p>', y, ro) +
    rcField('balance', '③ 신고서의 이월결손금 잔액 (선택)', '(모르면 비워 두세요)',
      '<p>같은 명세서에서 <b>공제 후 남은 금액(차기이월)</b>이 적혀 있으면 입력하세요. 없으면 비워 둬도 됩니다. 있으면 계산과 대조할 수 있습니다.</p>', y, ro);
}
function rcStepConfirm() {
  var rows = rc.years.map(function (y) {
    var cell = function (k) { return y.unk[k] ? '<span class="rc-unk">모름</span>' : (y[k] == null ? '—' : fmt(y[k])); };
    return '<tr><td>' + y.year + '</td><td class="n">' + cell('income') + '</td><td class="n">' + cell('claimed') + '</td><td class="n">' + cell('balance') + '</td></tr>';
  }).join('');
  return '<h2 tabindex="-1">입력한 값이 맞는지 확인하세요</h2>' +
    '<div class="scroll"><table class="rc-table"><thead><tr><th>해</th><th>소득금액</th><th>신고서 공제액</th><th>신고서 잔액</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p>결손이 난 해의 소득금액에 <b>-</b>가 붙어 있고, 연도가 맞는지 한 번 더 보세요.</p>' +
    '<label class="rc-check"><input type="checkbox" data-rc-ok ' + (rc.ok ? 'checked' : '') + '> 맞아요</label>';
}
function rcStatusChip(r) {
  var m = { ok: ['rc-chip ok', '어긋남 없음'], warn: ['rc-chip warn', '확인 필요'], unknown: ['rc-chip', '점검 불가'], unchecked: ['rc-chip', '점검 불가'] }[r.status] || ['rc-chip', ''];
  return '<span class="' + m[0] + '">' + m[1] + '</span>';
}
function rcResultHtml(a) {
  var n = function (v) { return v == null ? '—' : fmt(v); };
  var rows = a.rows.map(function (r) {
    return '<tr class="' + (r.status === 'warn' ? 'rc-warnrow' : '') + '"><td>' + r.year + '</td><td class="n">' + n(r.income) + '</td><td class="n">' + n(r.claimed) + '</td><td class="n">' + n(r.computedDeduction) +
      '</td><td class="n">' + n(r.reportedBalance) + '</td><td class="n">' + n(r.closing) + '</td><td>' + rcStatusChip(r) + '</td></tr>' + (r.note ? '<tr><td></td><td colspan="6" class="rc-small">' + esc(r.note) + '</td></tr>' : '');
  }).join('');
  var s = a.summary, out = '';
  out += '<p class="rc-sum">점검한 해 <b>' + s.checked + '</b>개 · 확인이 필요한 해 <b>' + s.warned + '</b>개' + (s.unchecked ? ' · 점검하지 못한 해 <b>' + s.unchecked + '</b>개' : '') + '</p>';
  if (s.rootYear != null) out += '<p class="rc-root"><b>' + s.rootYear + '년</b>부터 확인해 보세요. 이후 해의 차이는 이 해의 영향일 수 있습니다.</p>';
  out += '<div class="scroll"><table class="rc-table"><thead><tr><th>해</th><th>소득금액</th><th>신고서 공제액</th><th>계산 공제 가능액</th><th>신고서 잔액</th><th>계산 잔액</th><th>상태</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  if (a.warnings.length) {
    out += '<ul class="rc-warns">' + a.warnings.map(function (w) {
      return '<li><b>' + w.year + '년 · ' + w.code + '</b> ' + esc(w.msg) + (w.detail ? ' <span class="rc-small">(' + esc(w.detail) + ')</span>' : '') +
        (w.downstream ? ' <span class="rc-small">· 앞 해 차이의 영향일 수 있음</span>' : '') + '<div class="rc-small">' + esc(RC_WARN_TIP[w.code] || '') + '</div></li>';
    }).join('') + '</ul>';
    if (s.missedDeduction > 0) out += '<p class="rc-small">계산상 신고서보다 더 공제할 수 있었던 금액의 합: ' + fmt(s.missedDeduction) + '원 (참고용이며 환급액이 아닙니다. 세율·지방소득세·가산금·다른 공제에 따라 달라집니다.)</p>';
  } else {
    out += '<p class="rc-ok">입력한 값 기준으로는 어긋남이 보이지 않습니다. 입력이 맞는지, 다른 공제 항목은 별도로 확인하세요.</p>';
  }
  if (a.notes.length) out += '<ul class="rc-small">' + a.notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
  return out + rcRulesBadge() + '<p class="rc-small">참고용 계산입니다. 신고·청구는 세무사 또는 세무서에 확인한 뒤 판단하세요.</p>';
}
function rcStepResult() {
  var a = rcAnalyze();
  if (!a) return '<h2 tabindex="-1">결과</h2><p class="bad">계산 모듈을 불러오지 못했습니다. 이용권을 확인하거나 잠시 뒤 다시 시도해 주세요.</p>';
  return '<h2 tabindex="-1">점검 결과</h2>' + rcResultHtml(a);
}
function rcStepGuide() {
  var a = rcAnalyze();
  var yrs = a ? a.warnings.reduce(function (m, w) { if (m.indexOf(w.year) < 0) m.push(w.year); return m; }, []) : [];
  return '<h2 tabindex="-1">어긋난 해를 확인하는 방법</h2>' +
    (yrs.length ? '<p>확인이 필요한 해: <b>' + yrs.join(', ') + '년</b>' + '</p>' : '<p>점검에서 어긋난 해가 나오지 않았습니다. 그래도 아래 순서는 신고서를 점검할 때 그대로 쓸 수 있습니다.</p>') +
    '<ol class="rc-steps"><li><b>그 해 신고서를 다시 엽니다</b> (앞 화면의 홈택스 경로). 결손금·이월결손금공제명세서의 공제 금액과 잔액을 다시 보세요.</li>' +
    '<li><b>가장 오래된 어긋난 해부터</b> 확인합니다. 앞 해가 맞아야 뒤 해가 맞습니다.</li>' +
    '<li>신고서가 실제와 다르다면 <b>세무서 또는 세무사에게 먼저 확인</b>하세요. 직접 하려면 홈택스 세금신고에서 종합소득세의 신고구분을 <b>경정청구</b>로 고르고 기존 신고서를 불러옵니다(화면 이름은 바뀔 수 있습니다).</li>' +
    '<li>경정청구는 법정신고기한 뒤 일정 기간(5년으로 알려져 있음) 안에 할 수 있습니다. 기한은 세무서나 세무사에게 꼭 확인하세요.</li>' +
    '<li>경정청구 화면에서는 소득 구분 30(부동산임대업)으로 이월결손금 명세서의 발생 과세기간별 금액을 입력하고, 임대업(주택 제외) 줄의 공제금액에 합계를 넣는 방식이었습니다(2025 화면 기준 경험, 확인 필요).</li>' +
    '<li>제출 뒤에는 결손이 발생한 해의 신고서 등 증빙을 부속서류로 제출합니다.</li></ol>' +
    '<p class="rc-small">이 안내는 참고용이며 세무 상담이 아닙니다. 판단과 책임은 신고인에게 있습니다.</p>';
}
function rcStepSummary() {
  var a = rcAnalyze();
  return '<h2 tabindex="-1">요약</h2><div class="rc-summary">' + (a ? rcResultHtml(a) : '') + '</div>' +
    '<div class="rc-choose noprint"><button type="button" class="primary" data-rc="print">인쇄 / PDF로 저장</button><button type="button" data-rc="save">입력값 파일로 저장</button><button type="button" data-rc="restart">처음부터 다시</button></div>' +
    '<p class="rc-small noprint">저장한 파일은 이 도구가 서버에 보내지 않습니다. 개인 정보가 들어 있으니 보관에 유의하세요.</p>';
}

// ── 렌더링과 동작 ──
function rcRender(focus) {
  var steps = rcSteps();
  if (rc.step >= steps.length) rc.step = steps.length - 1;
  var st = steps[rc.step], total = steps.length;
  var body = { intro: rcStepIntro, range: rcStepRange, open: rcStepOpen, year: function () { return rcStepYear(st.i); }, confirm: rcStepConfirm, result: rcStepResult, guide: rcStepGuide, summary: rcStepSummary }[st.t]();
  var pct = Math.round((rc.step + 1) / total * 100);
  var last = rc.step === total - 1;
  var html = '<div class="rc-top noprint"><button type="button" class="link" data-rc="exit">← 장부선생으로 돌아가기</button><span class="rc-mode">' + (rc.mode === 'demo' ? '가상 예시' : rc.mode === 'mine' ? '내 값' : '') + '</span></div>' +
    '<div class="rc-prog noprint" role="progressbar" aria-valuemin="1" aria-valuemax="' + total + '" aria-valuenow="' + (rc.step + 1) + '" aria-label="진행 단계"><span style="width:' + pct + '%"></span></div>' +
    '<p class="rc-stepno noprint">' + (rc.step + 1) + ' / ' + total + ' 단계 · ' + esc(st.label) + '</p>' +
    '<div class="rc-body">' + body + '</div>' +
    '<div class="rc-nav noprint"><button type="button" data-rc="back"' + (rc.step === 0 ? ' disabled' : '') + '>← 뒤로</button>' +
    (last ? '' : '<button type="button" class="primary" data-rc="next" id="rcNext"' + (rcCanNext(st) ? '' : ' disabled') + '>' + esc(rcNextLabel(steps, rc.step)) + ' →</button>') + '</div>' +
    '<p class="rc-small rc-saverow noprint"><button type="button" class="link" data-rc="save">여기까지 저장</button> · <label class="link" for="rcLoad">저장한 파일 불러오기</label><input type="file" id="rcLoad" accept="application/json,.json" class="hidden"></p>';
  var el = $('#rcWizard');
  el.innerHTML = html;
  if (st.t === 'range') rcRangeCheck();
  if (st.t === 'year') rc.years[st.i] && ['income', 'claimed', 'balance'].forEach(rcHint);
  if (focus !== false) { var h = $('#rcWizard h2'); if (h) { h.focus({ preventScroll: true }); el.scrollIntoView({ block: 'start' }); } }
}
function rcRefresh() { if (rc.open) rcRender(false); }
function rcOpen() {
  rc.open = true;
  document.body.classList.add('rc-mode');
  $('#rcWizard').classList.remove('hidden');
  rcRender();
}
function rcClose() { rc.open = false; document.body.classList.remove('rc-mode'); $('#rcWizard').classList.add('hidden'); window.scrollTo(0, 0); }
function rcUpdateNext() {
  var steps = rcSteps(), n = $('#rcNext');
  if (n) n.disabled = !rcCanNext(steps[rc.step]);
}
function rcHint(key) {
  var el = $('#rc-h-' + key), inp = $('#rc-' + key);
  if (!el || !inp) return;
  var p = rcParse(inp.value);
  el.textContent = p.bad ? '숫자만 입력해 주세요(결손이면 앞에 -).' : (p.v == null ? '' : (p.v < 0 ? '결손 ' : '') + fmt(Math.abs(p.v)) + '원');
  el.className = 'rc-small' + (p.bad ? ' bad' : '');
}
function rcRangeCheck() {
  var m = $('#rcRangeMsg'); if (!m) return;
  var bad = rc.end < rc.start ? '끝 해가 시작 해보다 빠릅니다.' : (rc.end - rc.start > 11 ? '한 번에 최대 12년까지 점검할 수 있습니다.' : '');
  m.textContent = bad || ((rc.end - rc.start + 1) + '개 해를 점검합니다.'); m.className = 'rc-small' + (bad ? ' bad' : '');
}
function rcGo(delta) {
  var steps = rcSteps();
  if (delta > 0) {
    var st = steps[rc.step];
    if (!rcCanNext(st)) return;
    if (st.t === 'range' && rc.mode === 'demo') { rc.years = REFUND_DEMO.scenario.years.map(function (y) { return { year: y.year, income: y.income, claimed: y.claimed, balance: y.balance, unk: {} }; }); }
    else if (st.t === 'range') rcYearsFromRange();
  }
  rc.step = Math.max(0, Math.min(steps.length - 1, rc.step + delta));
  rcRender();
}
function rcSave() {
  if (locked()) { openLic(LOCK_MSG.save); return; }
  var data = { v: 1, kind: 'jangbu-refund', mode: rc.mode, start: rc.start, end: rc.end, step: rc.step, years: rc.years };
  download('refund-check.json', JSON.stringify(data, null, 2), 'application/json');
  toast('여기까지 저장했습니다');
}
function rcLoad(file) {
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var d = JSON.parse(rd.result);
      if (d.kind !== 'jangbu-refund' || !Array.isArray(d.years)) throw new Error('형식');
      if (d.mode === 'mine' && locked()) { openLic(LOCK_MSG.refund); return; }
      rc.mode = d.mode; rc.start = d.start; rc.end = d.end; rc.step = d.step || 0; rc.ack = true; rc.ok = false;
      rc.years = d.years.map(function (y) { return { year: y.year, income: y.income, claimed: y.claimed, balance: y.balance, unk: y.unk || {} }; });
      rcRender(); toast('저장한 값을 불러왔습니다');
    } catch (e) { toast('이 도구에서 저장한 파일이 아닙니다'); }
  };
  rd.readAsText(file);
}

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-rc]');
  if (!b || !$('#rcWizard').contains(b)) return;
  var a = b.getAttribute('data-rc');
  if (a === 'exit') rcClose();
  else if (a === 'back') rcGo(-1);
  else if (a === 'next') rcGo(1);
  else if (a === 'pick-demo') { rc.mode = 'demo'; rc.ack = false; rc.ok = false; rcGo(1); }
  else if (a === 'pick-mine') {
    if (locked()) { openLic(LOCK_MSG.refund); return; }
    if (!RR) { toast('계산 모듈을 아직 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); return; }
    if (rc.mode !== 'mine') { rc.years = []; rc.ack = false; rc.ok = false; }
    rc.mode = 'mine'; rcGo(1);
  }
  else if (a === 'save') rcSave();
  else if (a === 'print') { if (locked()) openLic(LOCK_MSG.print); else window.print(); }
  else if (a === 'restart') { rc.mode = null; rc.step = 0; rc.years = []; rc.ack = false; rc.ok = false; rcRender(); }
});
document.addEventListener('input', function (e) {
  var t = e.target;
  if (!$('#rcWizard').contains(t)) return;
  var key = t.getAttribute('data-rc-in');
  if (key) {
    var y = rc.years[rcSteps()[rc.step].i], p = rcParse(t.value);
    y[key] = p.empty || p.bad ? null : p.v;
    rcHint(key); rcUpdateNext();
  }
});
document.addEventListener('change', function (e) {
  var t = e.target;
  if (!$('#rcWizard').contains(t)) return;
  var range = t.getAttribute('data-rc-range');
  if (range) { rc[range] = Number(t.value); rcRangeCheck(); rcUpdateNext(); return; }
  if (t.hasAttribute('data-rc-ack')) { rc.ack = t.checked; rcUpdateNext(); return; }
  if (t.hasAttribute('data-rc-ok')) { rc.ok = t.checked; rcUpdateNext(); return; }
  var unk = t.getAttribute('data-rc-unk');
  if (unk) { var y = rc.years[rcSteps()[rc.step].i]; y.unk[unk] = t.checked; var inp = $('#rc-' + unk); inp.disabled = t.checked; if (t.checked) inp.value = ''; rcHint(unk); rcUpdateNext(); return; }
  if (t.getAttribute('data-rc-in')) { var yy = rc.years[rcSteps()[rc.step].i], k = t.getAttribute('data-rc-in'); t.value = rcFmtIn(yy[k]); return; }
  if (t.id === 'rcLoad' && t.files[0]) { rcLoad(t.files[0]); t.value = ''; }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || !rc.open) return;
  var t = e.target;
  if (!t || !$('#rcWizard').contains(t) || t.tagName === 'BUTTON' || t.tagName === 'SUMMARY') return;
  var n = $('#rcNext'); if (n && !n.disabled) { e.preventDefault(); rcGo(1); }
});
$('#btnRefund').addEventListener('click', rcOpen);
