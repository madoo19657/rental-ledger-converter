# 장부선생 이용권 확인 서버 (Cloudflare Workers + KV)

이메일 + 6자리 코드로 이용권을 확인하는 작은 서버다. **장부 데이터는 받지 않고**, 이메일·코드 원문도 저장하지 않는다(해시만).
설계는 `../docs/PRD-paid-license.md`(L-1~L-9, S-1~S-6, O-1~O-3).

## 파일
| 파일 | 내용 |
|---|---|
| `worker.mjs` | 서버 본체. `/api/verify`, `/api/session`, `/api/health`, 관리자 `/admin/*` |
| `fake-kv.mjs` | 테스트·로컬 모의 서버용 메모리 KV |
| `wrangler.toml` | 배포 설정 서식(KV ID와 허용 주소를 채운다) |

## 로컬에서 먼저 써 보기 (Cloudflare 없이)
```bash
node scripts/build.js --public                       # 체험 화면 빌드 (서버 주소가 비어 있어도 됨)
JANGBU_LICENSE_ENDPOINT=http://localhost:8787 node scripts/build.js --public
node scripts/dev-license-server.mjs                  # http://localhost:8787 에서 화면과 서버가 같이 뜸
# 시험용 이용권: demo@example.com / 123456
JANGBU_API=http://localhost:8787 JANGBU_ADMIN_TOKEN=dev-admin node scripts/license-admin.js issue --email me@example.com
```
메모리 저장이라 서버를 끄면 이용권이 사라진다. 서버 코드 테스트: `node --test tests/server.test.js`.

## 배포 순서 (Cloudflare 계정이 있어야 한다. 아래 명령은 일반적인 순서이며 직접 확인하지 못했다. 화면·요금은 Cloudflare 안내를 따른다)
1. `wrangler` 설치와 로그인 (`npm i -g wrangler`, `wrangler login`).
2. KV 만들기: `wrangler kv namespace create LICENSES` → 나온 ID를 `wrangler.toml`의 `id`에 적는다.
3. `wrangler.toml`의 `ALLOWED_ORIGIN`에 체험 화면 주소를 적는다.
4. 비밀값 3개 등록 (각각 길고 무작위인 문자열, **저장소·채팅에 쓰지 않는다**):
   ```bash
   cd server
   wrangler secret put PEPPER         # 이메일·코드 해시용
   wrangler secret put TOKEN_SECRET   # 토큰 서명용
   wrangler secret put ADMIN_TOKEN    # 발급 스크립트용
   ```
5. 유료 계산 모듈 묶기: `node scripts/build-server.js` (`src/engine-paid.js` → `server/paid-module.gen.mjs`, 저장소에 올리지 않음). **계산 코드를 고칠 때마다 다시 실행하고 다시 배포한다.**
6. 배포(체험 화면 포함, 한 번에): `JANGBU_SERVER_URL=https://jangbu-license.<계정>.workers.dev node scripts/deploy-server.js` (공개 빌드 → 개인 값 검사 → 모듈 묶기 → `server/public` 복사 → `wrangler deploy`). 체험 화면은 같은 주소의 `/`에서 나온다. 화면·계산 코드를 고칠 때마다 다시 실행한다.

> 2026-11-01 배포함: 서버·체험 화면 `https://jangbu-license.janny-kim72.workers.dev`. Pages는 생성 오류(8000000)로 쓰지 않았다. → 나온 주소(예: `https://jangbu-license.<계정>.workers.dev`).
6. 화면을 그 주소로 빌드한다: `JANGBU_LICENSE_ENDPOINT=https://... node scripts/build.js --public` 후 `node scripts/check-public.js`.
7. 발급: `JANGBU_API=https://... JANGBU_ADMIN_TOKEN=... node scripts/license-admin.js issue --email 구매자@example.com --note 주문번호`

## 운영 메모
- 발급 장부는 이 PC의 `scripts-private/license-ledger.json`에만 남는다(서버에는 이메일이 없다). 백업하되 저장소에는 올리지 않는다.
- `PEPPER`를 잃어버리거나 바꾸면 모든 이용권이 무효가 된다. 비밀번호 관리자에 보관한다.
- 시도 제한과 잠금은 KV(결과적 일관성)로 구현했다. 동시에 많은 요청이 오면 한도를 조금 넘길 수 있다. 문제가 생기면 Durable Objects로 옮긴다.
- 알려진 한계: 이메일을 아는 제3자가 일부러 틀린 코드를 보내면 그 이메일이 15분간 잠긴다(서비스 거부). 문의가 오면 관리자가 `devices-reset`·재발급으로 푼다.
- 유료 계산 코드는 `/api/module`이 유효한 토큰에만 내려준다(Phase 1b). 공개 화면에는 코드가 없다. 서버 장애 시 유료 기능은 열리지 않는다(저장하지 않음).
