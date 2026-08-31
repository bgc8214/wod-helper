# WOD Helper — 기획서 (PRD)

> Stadion 크로스핏 앱의 오늘/내일 WOD를 자동으로 가져와, **영어 운동 이름을 한글로 풀어
> 설명하고 시연 영상을 링크한** 보기 편한 페이지로 만든다.

작성: 2026-08-31 · 대상: 다른 세션에서 이 문서만 보고 바로 구현 착수 가능하도록 작성

---

## 0. 한 줄 요약

매일 Stadion에서 WOD를 긁어와 → 운동 용어를 한글 설명 + 유튜브 링크로 붙이고 →
**오늘/내일 카드로 보여주는 개인용 웹페이지**. 앱을 켜서 캡처할 필요 없이 자동.

---

## 1. 문제 (오너의 실제 불편)

1. **영어라 뭘 하는 운동인지 모른다.** "WALL BALL SHOT", "FRONT SQUAT 4 REPS"를 봐도
   동작이 안 그려진다.
2. **앱을 켜서 눈으로 봐야 한다.** Stadion은 iOS 앱을 맥에서 래핑한 것이라 창이 작고
   (288×541 고정) 스크롤로 나눠 봐야 한다. 자동화가 안 된다.
3. **내일 WOD를 미리 못 챙긴다.** 오후에 올라오는데 매번 확인하러 들어가야 한다.
4. **관심 있는 건 DIET/SWEAT 수업 하나뿐**인데 전부 뒤져야 한다.

## 2. 목표 / 비목표

**목표 (v1)**
- 오늘·내일 DIET/SWEAT WOD를 자동 수집
- 각 운동(움직임)을 한글 이름 + 한 줄 설명 + 유튜브 시연 링크로 표시
- "오늘은 STRENGTH(프론트 스쿼트) + METCON(21-18-15-12-9)" 식 요약
- 하루 1회 이상 자동 갱신 (내일 WOD가 올라오면 반영)
- 보기 편한 웹페이지 (폰에서도)

**비목표 (v1에서 안 함)**
- 예약/출석 체크인 (Stadion 앱이 함) — **읽기 전용**
- 다른 회원 랭킹·기록 (개인 열람 목적 밖)
- 1RM 계산기 (Stadion 홈에 이미 있음)
- 여러 지점(Box) 지원 — 내가 다니는 지점 하나만

## 3. 데이터 수집 — **이게 이 프로젝트의 핵심 판단**

Stadion은 **Flutter iOS 앱을 맥에 래핑**한 것이다(`/Applications/Stadion.app/Wrapper/Runner.app`).
바이너리 분석 결과 데이터 경로가 **셋** 있다. 난이도·안정성이 크게 다르니 순서대로 검토한다.

### 방식 A — 백엔드 API 직접 호출 (권장, 먼저 시도)

앱 바이너리에서 확인된 사실:
- API 호스트: `api.stadion.co.kr`, `app.stadion.co.kr`
- WOD 관련 서비스 메서드가 명확히 존재: `fetchWodList`, `fetchWodInfo`,
  `fetchWodInfoByBox`, `getFilteredWodClassTimeInfoList`,
  `fetchGetWodStepInfoByWodIdxItems` 등
- 데이터 모델: `wodInfo`, `wodStepInfo`, `wodItemInfo`, `wodCategoryInfo`,
  `wodBoxLinkInfo`(WOD↔지점 연결), `wodParticipantLinkInfo`(예약)
- 로그인 프록시: `app.stadion.co.kr/...Proc` 계열, JWT 토큰 기반으로 추정

**구현자가 할 일 (착수 첫 단계):**
1. 앱을 켠 상태에서 **네트워크 캡처**로 실제 요청을 관찰한다. 방법 둘 중 하나:
   - **mitmproxy** (권장): `mitmproxy` 실행 → 맥 프록시를 8080으로 → Stadion에서
     WOD 화면 진입 → `api.stadion.co.kr` 요청의 경로·헤더·바디·응답 JSON을 기록.
     (TLS는 이 iOS-on-Mac 래퍼가 시스템 신뢰 저장소를 쓰므로 mitm 인증서 설치로 대개 뚫린다.
     막히면 방식 B로.)
   - 프록시가 안 되면 `Console.app`에서 `Runner` 프로세스 로그 필터
     (`API Service(WodInfo)` 문자열이 로그에 찍힌다 — 바이너리에서 확인됨).
2. 관찰한 요청을 그대로 재현하는 클라이언트를 만든다:
   - 로그인 1회 → 토큰 저장 → `fetchWodList`(오늘/내일, 내 지점) → 각 WOD의
     `fetchGetWodStepInfoByWodIdxItems`로 스텝(WARM UP/STRENGTH/METCON) 상세.
   - **토큰 만료 대응**: 401이면 재로그인. 자격증명은 `.env`에 (커밋 금지).
3. 응답 JSON 스키마를 `docs/api-schema.md`에 받아 적는다 (다음 단계가 여기 의존).

> ⚠️ 이건 비공식 API다. 개인 열람 용도로만, 요청 빈도를 낮게(하루 몇 회) 둔다.
> 다른 회원 데이터는 건드리지 않는다. 오너 본인 계정으로만.

### 방식 B — 로컬 SQLite 캐시 읽기 (API가 막히면)

바이너리에 `wodInfo`, `wodStepInfo` 등을 **로컬 SQLite로 캐시**하는 쿼리가 그대로 있다
(`SELECT * FROM wodCategoryInfo WHERE status = 1` 등). 앱이 동기화한 DB 파일을
`~/Library/Containers/` 또는 앱 샌드박스에서 찾아 **읽기 전용**으로 조회하면
네트워크 없이 최신 캐시를 얻는다.
- 첫 할 일: `find ~/Library -name "*.db" -o -name "*.sqlite" 2>/dev/null | grep -i stadion`
  또는 앱 컨테이너 경로에서 `.db` 탐색 → `sqlite3`로 `wodInfo` 스키마 확인.
- 한계: 앱을 최소 1회 켜서 동기화해야 캐시가 갱신된다("완전 자동"은 아님).
  하지만 방식 C보다 훨씬 안정적이다.

### 방식 C — 화면 자동 조작 (최후의 수단)

API·DB 둘 다 막혔을 때만. 이번 세션에서 실제로 성공한 방법이라 재현 절차가 있다:
- 앱 실행: `open -a Stadion`
- **창을 주 디스플레이로 옮긴다** — 창이 보조 모니터 음수 좌표(`-347,-779`)에 있으면
  스크롤 이벤트가 전달되지 않는다. `osascript`로 `set position of window 1 to {60,40}`.
  (창 크기는 288×541 고정, 리사이즈 불가.)
- 클릭: `osascript ... click at {x,y}` (캡처 이미지 좌표 ÷2 + 창 원점).
- 스크롤: `CGEvent scrollWheelEvent2` (이 세션에 `scroll.swift` 헬퍼 있음).
  `System Events`의 `scroll` 명령은 이 앱에서 실패한다.
- 캡처: `screencapture -x -R "x,y,w,h"` 로 창 영역만.
- **한계**: WOD 상세가 스크롤 3~4번에 나뉘고, 텍스트를 OCR로 읽어야 하며,
  레이아웃이 바뀌면 깨진다. 유지보수 비용이 크다. **정말 최후에만.**

**결론**: A를 먼저, 안 되면 B, C는 비상용. 착수자는 30분 안에 A 가능 여부부터 판정할 것.

## 4. 운동 용어 → 한글 설명 + 영상 (오너가 가장 원하는 부분)

수집한 WOD 텍스트에서 **운동 이름(movement)**을 뽑아 사전과 매칭한다.

### 4-1. 용어 사전 (프로젝트가 소유하는 정적 데이터)
`data/movements.json` — 키는 정규화된 영문명, 값은:
```json
"WALL BALL SHOT": {
  "ko": "월볼 샷",
  "desc": "메디신볼을 들고 스쿼트 → 일어서며 목표 높이로 던지기. 하체+어깨 복합운동.",
  "youtube": "https://www.youtube.com/results?search_query=crossfit+wall+ball+shot",
  "aliases": ["WALL BALL", "WALLBALL", "WB"]
}
```
- 초기 30~40개만 채우면 크로스핏 WOD 대부분 커버(스쿼트·데드리프트·풀업·버피·
  월볼·박스점프·클린·스내치·케틀벨·런지·핸드스탠드 등). **부록 A에 시드 목록.**
- 유튜브는 v1에선 **검색 링크**로 충분(고정 영상 ID를 일일이 넣는 유지보수 회피).
  좋은 영상 하나를 고정하고 싶으면 나중에 `youtube` 값에 watch URL로 교체.
- 매칭 규칙: 대소문자·복수형·숫자(reps)·괄호 무시하고 최장 별칭 우선.
  예: "21-18-15-12-9 PULL UP / WALL BALL SHOT" → `PULL UP`, `WALL BALL SHOT` 추출.
- **매칭 실패 용어**는 로그에 남겨(부록 B) 사전을 점진 보강. 화면엔 원문 그대로 + "설명 준비 중".

### 4-2. WOD 구조 파싱
스텝은 대문자 섹션 헤더로 나뉜다(실측): `WARM UP`, `STRENGTH`, `METCON`,
간혹 `SKILL`, `COOL DOWN`. 각 섹션에:
- 포맷 라인: `EVERY 2:30 X 5 SETS`, `FOR TIME`, `AMRAP 12`, `TIME CAP: 16:00`
- 운동 라인: `FRONT SQUAT 4 REPS`, `21-18-15-12-9` 스킴 등

파서는 (섹션명, 포맷, [운동+reps]) 구조로 정규화. 포맷 용어도 사전에 넣어 한글로:
`FOR TIME`="시간 재기", `AMRAP`="제한시간 내 최대 라운드", `EMOM`="매 분마다" 등.

## 5. 화면 (출력)

**형태**: 정적 웹페이지 1장 (오너가 만든 stock-app 톤과 무관, 독립 프로젝트).
폰에서 열기 좋게 반응형. 배포는 로컬 파일 or Vercel/GitHub Pages(개인용).

```
┌────────────────────────────┐
│  오늘 · 8/31 (일)          │  ← 날짜 헤더
│  [ 오늘 ] [ 내일 ]          │  ← 탭
├────────────────────────────┤
│  DIET/SWEAT CAMP           │  ← 내가 듣는 수업만 강조(설정에서 필터)
│                            │
│  🔥 STRENGTH               │
│  프론트 스쿼트 4회 × 5세트   │  ← 한글
│  (2분 30초마다) · 중~고중량   │
│  ▸ 프론트 스쿼트  [영상]     │  ← 용어별 펼침 + 유튜브
│                            │
│  ⏱ METCON · 시간 재기       │
│  21-18-15-12-9             │
│  ▸ 풀업  [영상]             │
│  ▸ 월볼 샷  [영상]          │
│  제한시간 16분              │
├────────────────────────────┤
│  다른 수업 (접힘)           │  ← CROSSFIT 등은 접어서
└────────────────────────────┘
```

- **기본은 DIET/SWEAT**만 펼치고 나머지 수업은 접는다(오너가 그것만 들음). 설정으로 변경.
- 운동 이름을 누르면 한글 설명 + 유튜브 링크 펼침.
- "내일" 탭은 데이터 없으면 "아직 안 올라왔어요 · 보통 오후에 갱신".

## 6. 자동 실행 (스케줄)

- **launchd**(맥) 또는 **cron**으로 하루 2~3회 수집 스크립트 실행:
  아침(오늘 확정), 오후(내일 업로드분), 저녁(내일 보정).
- 수집 → `data/wod-YYYY-MM-DD.json` 저장 → 페이지가 그 JSON을 읽어 렌더.
- 방식 B/C면 "앱 실행 → 동기화 대기 → 수집" 단계를 스크립트에 포함.
- 실패 시 조용히 이전 데이터 유지 + 페이지에 "마지막 갱신: HH:MM" 표시.

## 7. 기술 스택 (제안)

- **수집기**: Node.js (fetch 기반). API면 순수 http, DB면 `better-sqlite3`,
  화면 조작이면 이 세션의 swift 헬퍼 + `screencapture` + OCR(`shortcuts run` 또는 tesseract).
- **사전/파서**: 순수 함수 모듈 (테스트 쉽게). 용어 매칭·WOD 파싱 단위 테스트 필수 —
  포맷이 자주 바뀌므로 회귀 방지가 생명.
- **페이지**: 단일 HTML + 약간의 JS (JSON fetch). 빌드 도구 없이도 됨.
- **스케줄**: launchd plist.
- 저장소 구조:
  ```
  wod-helper/
    PRD.md                 ← 이 문서
    docs/api-schema.md     ← 착수자가 캡처로 채움
    collector/             ← 수집(A/B/C 중 택1 구현)
    data/movements.json    ← 용어 사전(부록 A 시드)
    data/wod-*.json        ← 수집 결과
    web/index.html         ← 페이지
    scripts/collect.sh     ← 크론 진입점
    .env                   ← 자격증명(gitignore)
  ```

## 8. 리스크 / 판단이 필요한 것

| 리스크 | 대응 |
|---|---|
| 비공식 API 이용약관 저촉 가능성 | 개인 열람·저빈도·본인 계정 한정. 재배포·상업화 안 함. 오너 확인 필요. |
| API가 인증/서명으로 막힘 | 방식 B(로컬 DB)로 폴백. 그것도 막히면 C. |
| 앱 업데이트로 스키마 변경 | 파서·사전을 데이터로 분리해 코드 수정 없이 갱신. 매칭 실패 로그로 조기 감지. |
| 유튜브 링크 품질(검색 결과가 엉뚱) | v1은 검색 링크, 자주 나오는 용어만 고정 영상으로 승격. |
| "내일" 업로드 시각이 불규칙 | 오후·저녁 2회 수집으로 커버. 없으면 빈 상태 명시. |

## 9. 착수자를 위한 첫 3스텝 (Day 1)

1. **API 정찰** — mitmproxy 켜고 Stadion에서 WOD 열어 `api.stadion.co.kr` 요청 관찰.
   30분 내 "A 가능/불가" 판정. 응답 JSON을 `docs/api-schema.md`에 붙인다.
2. **불가 시 DB 정찰** — 앱 컨테이너에서 `.db` 찾아 `wodInfo`/`wodStepInfo` 스키마 확인.
3. 둘 중 되는 걸로 **오늘 WOD 1건을 JSON으로 뽑는 것**까지가 Day 1 목표.
   화면·사전·스케줄은 그 다음.

---

## 부록 A — 용어 사전 시드 (movements.json 초기값)

크로스핏 WOD 빈출 30선. 착수자는 이걸 `data/movements.json`으로 옮기고 desc를 다듬는다.

WALL BALL SHOT / FRONT SQUAT / BACK SQUAT / OVERHEAD SQUAT / AIR SQUAT /
DEADLIFT / SUMO DEADLIFT HIGH PULL / PULL UP / CHEST TO BAR / RING ROW /
PUSH UP / HANDSTAND PUSH UP / PUSH PRESS / PUSH JERK / SHOULDER PRESS /
CLEAN / POWER CLEAN / CLEAN AND JERK / SNATCH / POWER SNATCH /
THRUSTER / BURPEE / BOX JUMP / KETTLEBELL SWING / GOBLET SQUAT /
LUNGE / DOUBLE UNDER / TOES TO BAR / ROW(에르그) / RUN /
+ 포맷어: FOR TIME / AMRAP / EMOM / RFT / TIME CAP / EVERY X MIN

각 항목: {ko, desc(1줄), youtube(검색 링크), aliases[]}.

## 부록 B — 이번 세션에서 확인한 사실 (착수자 참고, 재조사 불필요)

- 앱 위치: `/Applications/Stadion.app/Wrapper/Runner.app` (iOS-on-Mac 래퍼, Flutter)
- Flutter 바이너리: `.../Runner.app/Frameworks/App.framework/App` — `strings`로 분석함
- API 호스트: `api.stadion.co.kr`, `app.stadion.co.kr` (파일: `file.stadion.co.kr`)
- WOD API 메서드(바이너리에서 확인): `fetchWodList`, `fetchWodInfo`,
  `fetchWodInfoByBox`, `getFilteredWodClassTimeInfoList`,
  `fetchGetWodStepInfoByWodIdxItems`, `fetchWodCategoryList`, `fetchWodNames`
- 로컬 캐시 테이블: `wodInfo`, `wodStepInfo`, `wodItemInfo`, `wodCategoryInfo`,
  `wodBoxLinkInfo`, `wodParticipantLinkInfo`, `wodRecordInfo`
- 로그 마커: `API Service(WodInfo) Error - <method>:` (Console.app에서 잡힌다)
- 유튜브 채널: youtube.com/channel/UCDfJTHvJmf9TYj7l81PG2rw (Stadion 공식 — 자체 영상 있을 수 있음)
- **화면 자동화 실측**: 창을 주 디스플레이로 옮기면 클릭·스크롤·캡처 전부 성공.
  보조 모니터 음수 좌표에서는 스크롤 실패. 창 크기 288×541 고정(리사이즈 불가).
- **실제 WOD 예시**(8/31 DIET/SWEAT CAMP, 파서 테스트용):
  ```
  WARM UP: WORLD'S GREATEST / BAND PULL APART / EMPTY BAR FRONT SQUAT
  STRENGTH: EVERY 2:30 X 5 SETS — FRONT SQUAT 4 REPS (MODERATE TO HEAVY)
  METCON: FOR TIME 21-18-15-12-9 — PULL UP / WALL BALL SHOT — TIME CAP: 16:00
  ```
