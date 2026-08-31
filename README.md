# WOD Helper

Stadion 크로스핏 앱의 **오늘/내일 WOD 를 자동 수집**해서, 영어 운동 이름을
**한글 설명 + 유튜브 시연 링크**로 풀어 보여주는 개인용 웹페이지.
앱을 켜서 눈으로 확인할 필요 없이, 폰에서 링크만 열면 된다.

> 기획: [PRD.md](./PRD.md) · 데이터 경로 상세: [docs/api-schema.md](./docs/api-schema.md)

## 어떻게 데이터를 가져오나 (방식 A 확정)

PRD 3장의 세 경로(API / 로컬 DB / 화면 조작) 중 **방식 A(백엔드 API)** 로 성공했다.

- Stadion 백엔드는 `POST http://api.stadion.co.kr:8080/runQuery` 로 **읽기 SQL 을 그대로 실행**한다.
  (클라이언트가 SQL 을 만들어 보내는 구조라, 우리도 `SELECT` 만 보내 WOD 를 조회한다.)
- **인증 불필요.** mitmproxy 없이 동작. 로컬 SQLite(방식 B)는 캐시 파일이 없어 불가, 화면 조작(방식 C)은 미사용.
- 요청은 **저빈도**(하루 3회), **본인 지점 조회**만. 다른 회원 데이터는 건드리지 않는다.

자세한 스키마·검증 쿼리는 [docs/api-schema.md](./docs/api-schema.md).

## 구조

```
wod-helper/
  PRD.md                    기획서
  docs/api-schema.md        확정된 API/스키마/쿼리
  collector/
    api.js                  runQuery 클라이언트 (SELECT 전용)
    parser.js               WOD 본문 → (섹션/포맷/운동) 파서
    parser.test.js          파서 단위 테스트 (8/31 실측 회귀 포함)
    collect.js              수집 진입점 → data/latest.json(.js)
  data/
    movements.json          용어 사전(운동/포맷/섹션) — 코드 수정 없이 보강
    latest.json / latest.js 최신 수집 결과 (페이지가 읽음)
    unmatched.log           매칭 실패 용어 로그(사전 보강용, gitignore)
  web/index.html            단일 페이지 (오늘/내일 탭, 반응형)
  scripts/
    collect.sh              크론 진입점
    com.wodhelper.collect.plist  launchd 잡(하루 3회)
    install-launchd.sh      launchd 설치 헬퍼
```

## 사용법

```bash
# 1) 수집 (오늘/내일 판교 WOD → data/latest.json, latest.js)
npm run collect

# 2) 페이지 보기
open web/index.html          # 로컬 파일로 바로 (latest.js 를 읽음)
# 또는 로컬 서버로:
npm run serve                # http://localhost:8787

# 3) 파서 테스트
npm test
```

### 자동 갱신 (macOS launchd)

```bash
bash scripts/install-launchd.sh   # 하루 3회(08/14/20시) 자동 수집 + 즉시 1회
# 해제
launchctl unload ~/Library/LaunchAgents/com.wodhelper.collect.plist
```

## 설정

`.env`(선택, `.env.example` 참고):

| 변수 | 기본 | 의미 |
|---|---|---|
| `STADION_BOX_IDX` | `1` | 지점 (1 판교 · 2 광명 · 3 범계) |
| `HIGHLIGHT_CATEGORY` | `6` | 강조·기본 펼침 카테고리 (6 = DIET/SWEAT CAMP) |
| `STADION_API_HOST` | `http://api.stadion.co.kr:8080` | API 호스트 |

## 용어 사전 보강

운동 이름이 사전에 없으면 페이지엔 "설명 준비 중"으로 나오고 `data/unmatched.log` 에 남는다.
그 용어를 `data/movements.json` 의 `movements` 에 `{ko, desc, youtube, aliases}` 로 추가하면
**코드 수정 없이** 다음 수집부터 반영된다. 포맷어(`FOR TIME`/`AMRAP`…)는 `formats`,
섹션명(`STRENGTH`…)은 `sections` 에 있다.

## 주의

비공식 API 를 개인 열람 목적으로만 사용한다. 저빈도·본인 계정·본인 지점 한정, 재배포·상업화 안 함.
로그인 자격증명은 커밋하지 않는다(`.gitignore`).
