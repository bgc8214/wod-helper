# WOD Helper

Stadion 크로스핏 앱의 **WOD 를 자동 수집**해서, 영어 운동 이름을
**한글 설명 + 시연 영상 + 집중 부위 분석**으로 풀어 보여주는 개인용 웹페이지.
앱을 켜서 눈으로 확인할 필요 없이, 폰에서 링크만 열면 된다.

**🔗 https://wod-helper.vercel.app**

> 기획: [PRD.md](./PRD.md) · 데이터 경로 상세: [docs/api-schema.md](./docs/api-schema.md)

## 무엇을 보여주나

- **오늘 ~ +6일** — 미리 등록된 미래 WOD 까지. "내일 뭐 하는지" 보고 갈 날을 고른다.
- **지난 5년 아카이브** — 2021-03 부터 전량(약 7,500건). 날짜 레일·좌우 키로 이동.
- **집중 부위 분석** — 운동별 부위·동작 태그를 집계해 `하체 34% · 등 20% · 근력형` 식으로.
- **시연 영상 자동 재생** — 하이라이트 수업의 운동이 카드로 순환하며 영상이 재생된다.
- **난이도별 스케일링** — 입문/초급/중급/상급 (DB 의 `scaleContent` 활용).
- **최근 28일 통계** — 운동 빈도·부위 분포.

> 도표(집중 부위·통계)는 `HIGHLIGHT_CATEGORY`(기본 DIET/SWEAT CAMP) **한 수업 기준**으로 낸다.
> 수업마다 성격이 완전히 달라(크로스핏 vs MMA) 전부 합치면 의미가 흐려지기 때문.
> WOD 목록 자체는 그날 전체 수업을 보여준다.

## 어떻게 데이터를 가져오나 (방식 A 확정)

PRD 3장의 세 경로(API / 로컬 DB / 화면 조작) 중 **방식 A(백엔드 API)** 로 성공했다.

- Stadion 백엔드는 `POST http://api.stadion.co.kr:8080/runQuery` 로 **읽기 SQL 을 그대로 실행**한다.
- **인증 불필요.** 로컬 SQLite(방식 B)는 캐시 파일이 없어 불가, 화면 조작(방식 C)은 미사용.
- 요청은 **저빈도**, **본인 지점 조회**만. 다른 회원 데이터는 건드리지 않는다.
- WOD 건마다 쿼리하지 않고 `IN` 절로 묶어 **1회 수집 = 4쿼리**. (7일치 90여 회 → 4회)

> 브라우저에서 이 API 를 직접 부를 수는 없다. 서버가 CORS 를 열지 않아
> preflight 이 403 이고 응답에 `Access-Control-Allow-Origin` 이 없다.
> 그래서 수집기가 정적 파일을 만들고, 웹은 그 파일만 읽는다(= 페이지 조회는 API 를 안 건드린다).

## 구조

```
wod-helper/
  index.html                단일 페이지 (히어로 영상 재생·날짜 탐색·통계)
  vercel.json               latest 데이터 no-cache 헤더
  collector/
    api.js                  runQuery 클라이언트 (SELECT 전용)
    parser.js               WOD 본문 → (섹션/포맷/운동) 파서
    focus.js                부위·패턴 집계 → 집중 부위/근력·컨디셔닝 분류
    collect.js              수집 진입점 → latest.json(.js) + archive/ + index.json
    parser.test.js          단위 테스트
  data/
    movements.json          용어 사전 — 운동별 ko/desc/parts/patterns/aliases
    videos.json             운동별 시연 영상 (id·시작지점·채널)
    latest.json / latest.js 최신 수집 결과 (사전·영상 인라인)
    archive/YYYY-MM.json    월별 아카이브 (과거 조회용)
    index.json              아카이브 날짜 인덱스
    unmatched.log           매칭 실패 용어 로그(사전 보강용)
  scripts/
    collect.sh              크론 진입점 (수집 → git push → Vercel 배포)
    backfill.sh             과거 WOD 일괄 수집(분기 단위)
    fetch-videos.js         운동별 시연 영상 수집
    compact-archive.js      아카이브 경량화(일회성)
    com.wodhelper.collect.plist / install-launchd.sh
```

## 사용법

```bash
npm run collect              # 수집 (오늘~+6일)
npm test                     # 파서 테스트
python3 -m http.server 8899  # 로컬 확인 → http://localhost:8899

# 과거 데이터 백필 (일회성)
bash scripts/backfill.sh 2021 2026

# 운동 시연 영상 수집 (사전에 운동을 추가했을 때)
node scripts/fetch-videos.js
```

### 자동 갱신 (macOS launchd)

```bash
bash scripts/install-launchd.sh
launchctl unload ~/Library/LaunchAgents/com.wodhelper.collect.plist   # 해제
```

`collect.sh` 는 데이터가 **바뀐 경우에만** git push 와 `vercel deploy --prod` 를 실행한다.

## 설정

`.env`(선택, `.env.example` 참고):

| 변수 | 기본 | 의미 |
|---|---|---|
| `STADION_BOX_IDX` | `1` | 지점 (1 판교 · 2 광명 · 3 범계) |
| `HIGHLIGHT_CATEGORY` | `6` | 강조 수업 + **도표 기준** (6 = DIET/SWEAT CAMP) |
| `DAYS_AHEAD` | `6` | 오늘부터 며칠 뒤까지 수집 |
| `STADION_API_HOST` | `http://api.stadion.co.kr:8080` | API 호스트 |
| `VERCEL_TOKEN` | — | launchd 세션에서 배포가 막힐 때만 |

## 용어 사전 보강

운동 이름이 사전에 없으면 원문 그대로 나오고 `data/unmatched.log` 에 남는다.
`data/movements.json` 의 `movements` 에 아래 형태로 추가하면 **코드 수정 없이** 다음 수집부터 반영된다.

```json
"SLED PUSH": {
  "ko": "슬레드 푸시", "desc": "…", "youtube": "…",
  "aliases": ["SLED"],
  "parts": ["하체", "심폐"], "patterns": ["밀기", "유산소"]
}
```

`parts`/`patterns` 는 집중 부위 분석에 쓰인다(값 목록은 파일 상단 `_tagSpec` 참고).
추가 후 `node scripts/fetch-videos.js` 를 돌리면 시연 영상도 붙는다.

## 주의

비공식 API 를 개인 열람 목적으로만 사용한다. 저빈도·본인 지점 한정, 재배포·상업화 안 함.
영상은 YouTube 공식 임베드로 재생하며 파일을 저장하지 않는다.
로그인 자격증명은 커밋하지 않는다(`.gitignore`).
