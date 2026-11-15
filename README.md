# rental-ledger-converter

간편장부 → 복식부기 변환 엔진 (단일 HTML 도구의 계산부). 기획은 [docs/PRD.md](docs/PRD.md), 범위는 [docs/scope-v1.md](docs/scope-v1.md).

## 실행

```bash
node --test tests tests-private          # 공개 테스트 20개(엔진 7 + 서버 13) + 개인 사례 테스트 83개 (tests-private는 저장소에 올리지 않음)
node scripts/build.js                    # 개인 빌드 → dist/index.html (개인 설정 포함, 잠금 없음, 저장소 제외)
node scripts/build.js --public           # 공개 빌드(장부선생 체험 버전) → dist-public/index.html
node scripts/check-public.js             # 공개 빌드·저장소에 개인 값이 들어갔는지 검사 (--strict면 저장소 파일도 실패)
node scripts/dev-license-server.mjs      # 로컬 모의 이용권 서버 + 체험 화면(http://localhost:8787, 시험용 demo@example.com / 123456)
node scripts/build-legal.js            # docs/legal 약관·방침을 dist-public/legal HTML로
node scripts/build-server.js           # 유료 계산 모듈(src/engine-paid.js)을 서버 배포용 파일로 묶기
node scripts/license-admin.js            # 이용권 발급·폐기·연장 (서버 주소·관리자 토큰은 환경 변수, server/README.md)
node scripts-private/run-case-b.js       # 개인 사례 출력(비공개)
```

**제품명은 장부선생**이다(PRD-paid-license). 빌드는 두 가지다: **개인 빌드**(`dist/`)는 내 설정·사업장 기본값이 들어가고 잠금이 없다. **공개 빌드**(`dist-public/`)는 일반 예시값만 들어간 **체험 버전**이라 가상 샘플만 동작하고 내 파일 업로드·조정계산서·홈택스 입력값·저장·인쇄는 이용권(이메일 + 6자리 코드)이 필요하다. 이용권 확인 서버는 Phase 1이라 지금은 "서버 준비 중" 안내만 나온다.

`dist/index.html`(개인 빌드)은 엔진·가정값·가상 샘플이 모두 들어간 단일 파일이다. 엑셀(.xlsx) 읽기만 SheetJS를 cdnjs에서 불러오므로 인터넷 연결이 필요하고, CSV는 오프라인에서도 된다. 파일 내용은 브라우저 밖으로 나가지 않는다. 실제 금액이 든 `samples/case-b-site1.csv`는 HTML에 넣지 않는다.

Node 20 이상. 외부 패키지 없음.

## 화면 사용 순서 (단계별 반영)

`dist/index.html`을 열면 한 번에 한 단계만 보이고, 단계마다 아래쪽에 **[반영하고 다음 →]** 버튼이 있습니다. 앞 단계를 반영해야 다음 단계가 열립니다.

| 단계 | 하는 일 | 반영하면 |
|---|---|---|
| 1. 파일 업로드 | 가상 샘플을 불러오거나 엑셀·CSV를 고르고 사업장(시트)을 확인 | 2단계로 넘어감 |
| 2. 필수 정보 | 간편장부에 없는 값 7개(건물·토지 취득가, 취득일, 기초 감가상각누계액, 기초 현금, 기초 보증금, 대출 잔액)를 입력 | 결과가 만들어지고 3단계로 넘어감 |
| 3. 추가 설정 (선택) | 과세연도, 부가세 처리, 건물 감가상각, 연중 변동, 세무조정 등. 바꿀 게 없으면 [건너뛰고 결과 보기]를 눌러도 됨 | 결과가 갱신되고 결과 화면으로 넘어감 |
| 4. 결과 확인 | 재무제표, 조정계산서, 홈택스 입력값 등 | |

- 반영한 단계의 입력을 고치면 "수정됨"으로 표시되고, 다시 반영하기 전까지 결과는 이전 값 기준입니다.
- 3단계를 반영하기 전에는 기본값이 결과에 쓰입니다. 3단계에서 고친 값도 [반영하고 결과 보기 →]를 누르기 전에는 적용되지 않습니다.
- 2단계 "필수 정보"의 칸은 임시값이면 빨간 "임시값 · 확인 필요", 고치거나 눌러서 확인하면 초록 "✓ 확인됨"으로 바뀝니다. 임시값이 남아 있어도 다음 단계로 갈 수 있고, 버튼 옆에 남은 개수를 알려 줍니다. 입력한 금액은 칸 아래에 "3억 1,110만 원"처럼 풀어 보여 줍니다.
- 칸은 값의 성격별(소득금액에 영향 / 재무상태표만)로 묶여 있고 격자에 맞춰 정렬됩니다.
- 화면 구성(2026-10-31 개편, 2026-11-15 디자인 변경. 시안 캡처는 `brand/mockups/uxpilot/`):
  - **단계별 배치**: 큰 제목 아래 왼쪽에 본문 카드, 오른쪽에 안내 패널(도움말, 이용 문의)이 있고, 맨 아래에 [← 이전]과 [반영하고 다음 →]이 있습니다. 좁은 화면에서는 안내 패널이 본문 아래로 내려갑니다.
  - **체험 버전 띠**: 체험 버전에서는 맨 위에 안내 띠와 [이용권 입력]이 나옵니다.
  - **이용 문의**: "1:1 카톡 문의하기"는 이용권 사용자 전용입니다. 문의 채널 주소(`src/template.html`의 `CONTACT_URL`)는 아직 비어 있습니다.
  - **상단 고정 헤더**: 로고와 단계 표시줄(파일 업로드, 필수 정보, 추가 설정, 결과 확인)이 한 줄에 있습니다. 번호 원과 연결선으로 진행 상황을 보여 주고, 누르면 그 단계로 이동합니다.
  - **끌어다 놓는 파일 올리기**: 파일을 놓거나 눌러서 고릅니다. 읽은 내용은 "무엇을 읽었나요?"를 펼치면 나옵니다.
  - **진행 막대**: 필수 정보 7개 중 몇 개를 확인했는지 "3 / 7 입력함 43%"처럼 보입니다.
  - **결과 탭 재배치**: 요약, 홈택스 입력, 재무상태표, 손익계산서, 조정계산서, 수입금액명세서, 조정합계표, 시산표, 분개장, 대사 순으로 한 줄에 들어갑니다. 탭 이름에 마우스를 올리면 전체 이름이 보입니다.
  - **확인할 항목**: 내부 코드 대신 "확인 필요/참고/오류" 라벨로 보여 주고, 코드는 작게 덧붙입니다.
  - **알림(토스트)**: 반영, 복사, 저장 때 잠깐 알려 줍니다.
  - **한글 줄바꿈**: 어절 단위로 끊어 읽기 쉽게 했고, 모바일(375px)에서도 가로 스크롤 없이 한 열로 배치됩니다.
- 화면 스타일: Pretendard(jsDelivr에서 글꼴만 불러오며 장부 데이터는 보내지 않습니다. 못 불러오면 맑은 고딕), 짙은 청록 포인트 색과 따뜻한 베이지 배경(채도 높은 초록은 쓰지 않음), 주의 박스 색. 라이트/다크 모드를 모두 지원합니다.

## 구성

| 경로 | 내용 |
|---|---|
| `src/engine.js` | 파싱·검증·분개·시산표·재무제표·감가상각·간주임대료·조정계산서(별지 제46호)·기장세액공제·홈택스 입력값(`hometaxInputs`) (순수 함수) |
| `docs/` | **유료 이용권 PRD(`PRD-paid-license.md`)**, **개인 세금 문서는 `docs-private/`(볼트 정션, git 제외)**, PRD, scope, 입력 형식, 간편장부 작성법, 사용 매뉴얼(`user-manual.md`), 홈택스 매뉴얼, 출처 대장(`sources.md`) |
| `config/tax-params-2025.json` | 연도별 세법 값 (이자율 3.10%, 공제율 20%, 한도 100만 원) |
| `src/refund-check.js`, `src/refund-wizard.js` | 환급 점검(이월결손금): 계산 모듈(유료, 서버 배포)과 단계별 마법사 화면. 설계는 `docs/PRD-refund-check.md` |
| `server/` | 이용권 확인·유료 모듈 배포 서버(Cloudflare Workers + KV) 코드·설정 서식·배포 순서 |
| `config/assumptions.public.json` | 공개 빌드용 **일반 예시값**(건물 3억, 보증금 2천만, 대출 1억 등) |
| `config/*.private.*` | 개인 설정·사업장 기본값·금지어 목록 (**git 제외**) |
| `brand/` | 로고·파비콘·앱 아이콘(SVG, PNG), 미리보기, 인쇄용 PDF |
| `tests/` `tests-private/` | 공개 테스트(가상 샘플) / 개인 신고서 사례 테스트(git 제외) |
| `samples/` | 가상 샘플, 사례 B-1 입력 (실제 금액 포함, 저장소에 커밋하지 말 것) |
| `tests/engine.test.js` | 사례 A(첨부 신고서), 사례 B-1 회귀 테스트 |

## 알려진 한계

- 건물·보증금·대출·기초 잔액은 가정값이다. 결과의 재무상태표와 감가상각비 이외 수치는 가정에 의존한다.
- 기장세액공제는 종합소득 산출세액·종합소득금액을 설정에 넣어야 계산된다.
- 한 번에 사업장(시트) 하나만 계산한다. 합산·사업장별 비교는 v1.1.
- 법정 서식 그대로의 PDF 레이아웃은 아직 없다. 화면 표와 브라우저 인쇄(PDF 저장)로 대신한다.
- 실제 엑셀 파일 업로드는 같은 구조의 시험 파일로 확인했고, 사용자의 실제 파일로는 아직 확인하지 않았다.

## 사이트 주소 구성 (2026-11-15)

**서비스 주소는 `https://jangbu.madoo.kr`** 이다(가비아에서 산 `madoo.kr`을 Cloudflare에 연결, 워커 `jangbu-license`의 사용자 지정 도메인). 배포: `JANGBU_SERVER_URL=https://jangbu.madoo.kr node scripts/deploy-server.js`. 옛 주소 `jangbu-license.madoo.workers.dev`도 당분간 같이 열려 있다.

`scripts/deploy-server.js`가 `server/public`을 아래처럼 만든 뒤 올린다. `--dry`를 붙이면 올리지 않고 폴더만 만든다(로컬 확인용).

| 주소 | 내용 | 원본 |
|---|---|---|
| `/` | 대문(제품 메뉴: 장부변환, 환급점검, 분양견적) | `src/landing.html` |
| `/convert/` | 장부변환 체험 화면 | `dist-public/index.html` |
| `/refund/` | 환급점검 | `prototype/refund-check.html` |
| `/legal/` | 이용약관·처리방침·환불 안내 | `dist-public/legal/` |
| `/api/*` | 이용권 서버 | `server/worker.mjs` |

- `madoo.kr`과 `www.madoo.kr`은 별도 Worker `madoo-redirect`(`redirect-site/`)가 `jangbu.madoo.kr`로 넘긴다(임시 이동 302). 배포: `redirect-site` 폴더에서 `npx wrangler deploy`.
- 분양견적은 다른 프로젝트(`quote-maker`)라 대문에서 그 주소로 링크만 건다. 주소는 `JANGBU_QUOTE_URL`로 바꿀 수 있다.
- 장부변환 화면의 아이콘·매니페스트·약관 링크는 상대 경로라 `/convert/` 아래에 같이 둔다.
- 원본의 미리보기 태그에 적힌 `https://jangbu-license.madoo.workers.dev`는 배포 때 `JANGBU_SERVER_URL`로 바뀐다.

## 페이지 아이콘 규칙 (2026-11-15)

- 모든 HTML 페이지의 `<head>`에 탭 아이콘(`rel="icon"`), 홈 화면 아이콘(`apple-touch-icon`, 180px), `manifest`(192·512)를 넣는다. 원본은 `brand/favicon.svg`와 `brand/png/home-icon-*.png`.
- **Worker(`jangbu-license`, `jangbu-refund`)**: `/apple-touch-icon.png`처럼 절대 경로. `scripts/deploy-server.js`, `scripts/deploy-refund.js`가 파일을 만든다.
- **GitHub Pages(저장소 루트 `index.html`)**: 저장소 이름 아래(`/rental-ledger-converter/`)에 올라가므로 **상대 경로**(`apple-touch-icon.png`, `manifest.webmanifest`)를 쓰고 아이콘 파일을 저장소 루트에 둔다. 절대 경로로 쓰면 404가 되어 홈 화면 아이콘이 안 나온다.
- 배포 뒤에는 아이콘·매니페스트 주소가 200인지 확인한다.
