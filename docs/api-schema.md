# API 스키마 — 착수 세션에서 확정된 수집 경로

> PRD 3장의 "방식 A(백엔드 API)" 정찰 결과. **방식 A 확정.** mitmproxy 없이 성공.
> 조사일: 2026-08-31

## 결론 요약

- **방식 A 채택.** Stadion 백엔드는 `POST /runQuery` 로 **임의 SQL을 그대로 실행**한다.
  클라이언트(Flutter 바이너리)가 SQL 문자열을 만들어 보내는 구조라, 우리도 같은 방식으로
  읽기 전용 SELECT 만 보내 WOD 를 조회한다.
- **인증 불필요.** `getboxInfoAll`, `getwodItemInfoAll`, `runQuery` 모두 토큰 없이 응답한다.
  (로그인 프록시 `/getaccountinfo` 는 `userID`/`password` JSON 을 받지만, WOD 조회에는 안 쓴다.)
- 방식 B(로컬 SQLite)는 **불가** — 앱 컨테이너(`~/Library/Containers/com.hybox.stadion2`)에
  `.db`/`.sqlite` 파일이 없다. 방식 C(화면 조작)는 사용하지 않는다.

## 엔드포인트

| 메서드 | 경로 | 용도 |
|---|---|---|
| POST | `http://api.stadion.co.kr:8080/getboxInfoAll` | 지점 목록 (body `{}`) |
| POST | `http://api.stadion.co.kr:8080/getwodItemInfoAll` | 운동 아이템 마스터 (body `{}`) |
| POST | `http://api.stadion.co.kr:8080/runQuery` | **임의 SQL 실행.** body `{"query":"<SQL>"}` |

> ⚠️ `runQuery` 는 비공식·저수준 엔드포인트다. **SELECT 만**, 본인 계정 조회 목적,
> 하루 몇 회 이하의 저빈도로만 사용한다. INSERT/UPDATE/DELETE 는 절대 보내지 않는다.

### runQuery 주의
- 파라미터 키는 반드시 `query`. (`sql`, `q` 는 500 에러)
- 서버는 MariaDB. `information_schema` 로 스키마 조회 가능.
- 응답은 행 배열(JSON). 문법 오류 시 `bad SQL grammar ...` 문자열을 200 으로 반환하므로
  응답이 `[` 로 시작하는지로 성공 판정한다.

## 지점 (boxInfo)

| idx | name |
|---|---|
| 1 | 스타디온 판교 ← **오너 지점** |
| 2 | 스타디온 광명 |
| 3 | 스타디온 범계 |

## 카테고리 (wodCategoryInfo, status=1)

| idx | name |
|---|---|
| 3 | CROSSFIT |
| 6 | **DIET/SWEAT CAMP** ← 오너 관심 수업 |
| 2 | RUN&LIFT |
| … | (WEIGHT LIFTING, MMA, ON RAMP (PG) 등 다수) |

## 핵심 테이블 스키마

### wodInfo — WOD 한 건
`idx, name, explanation, progressDate, isSuccessCheck, isOpen, progressStatus, writer,
status, regUnixtime, lastUpdatetime, orderNo, showStartDatetime, categoryIdx, boardIndex`

- **`progressDate` 는 DATE 타입이다.** JSON 직렬화 시 epoch millis(예: `1788102000000`)처럼
  보이지만 실제 저장은 `2026-08-31`. 그래서 **`progressDate = '2026-08-31'` (문자열 비교)** 로
  필터해야 한다. 정수 비교(`= 1788102000000`)나 `FROM_UNIXTIME()` 은 **실패**한다.
- `name` 예: `"0831 DIET/SWEAT CAMP"` (MMDD prefix + 카테고리명)
- `categoryIdx` 로 수업 종류 판별.

### wodStepInfo — WOD 안의 섹션(스텝). **WOD 본문이 여기 있다.**
`idx, wodIdx, sequence, name, kind, explanation, movementName, movementExplanation,
isSuccessCheck, totalRound, timeCap, intervalEmom, intervalTime, writer, status,
regUnixtime, lastUpdatetime, scaleContent_E, scaleContent_A, scaleContent_I, scaleContent_N`

- **`explanation` 필드에 WARM UP/STRENGTH/METCON 전문이 통째로** 들어있다(`\r\n` 구분).
  `movementName` 등 구조화 컬럼은 대개 null → **explanation 텍스트를 파싱**한다(파서 담당).
- DIET/SWEAT 는 보통 스텝 1개(`kind='BI'`)에 전 섹션이 뭉쳐 있다.

### wodBoxLinkInfo — WOD ↔ 지점 ↔ 시간
`idx, wodIdx, boxIdx, coachIdx, progressTime, limitCount, writer, status,
regUnixtime, lastUpdatetime, demoCount`

- WOD 는 지점에 **직접 안 붙는다.** 이 링크로 연결된다. 같은 WOD 가 여러 `progressTime` 으로 반복.
- 오늘 판교 WOD 를 얻으려면 `wodInfo` 를 이 테이블(`boxIdx=1`)과 조인.

## 검증된 조회 쿼리

### 특정 날짜·지점의 WOD 목록 (카테고리명 포함)
```sql
SELECT w.idx, w.name, w.categoryIdx, c.name AS cat,
       bl.boxIdx, b.name AS box
FROM wodInfo w
JOIN wodBoxLinkInfo bl ON bl.wodIdx = w.idx AND bl.boxIdx = 1 AND bl.status = 1
JOIN boxInfo b         ON b.idx = bl.boxIdx
LEFT JOIN wodCategoryInfo c ON c.idx = w.categoryIdx
WHERE w.progressDate = '2026-08-31' AND w.status = 1
GROUP BY w.idx;
```

### WOD 한 건의 섹션(본문)
```sql
SELECT idx, sequence, name, kind, explanation, timeCap, totalRound
FROM wodStepInfo
WHERE wodIdx = 11291 AND status = 1
ORDER BY sequence, idx;
```

### 지점의 수업 시간표(progressTime)
```sql
SELECT DISTINCT progressTime
FROM wodBoxLinkInfo
WHERE wodIdx = 11291 AND boxIdx = 1 AND status = 1
ORDER BY progressTime;
```

## 실측 예 (8/31 판교 DIET/SWEAT CAMP, wodIdx=11291)

`wodStepInfo.explanation` 원문(파서 테스트 기준):
```
WARM UP

WORLD'S GREATEST
BAND PULL APART
EMPTY BAR FRONT SQUAT

STRENGTH

EVERY 2:30 X 5 SETS

FRONT SQUAT 4 REPS (MODERATE TO HEAVY)

METCON

FOR TIME

21-18-15-12-9

PULL UP
WALL BALL SHOT

TIME CAP: 16:00
```
