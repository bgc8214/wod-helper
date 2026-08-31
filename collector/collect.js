'use strict';
/**
 * WOD 수집기 — 오늘/내일 지정 지점의 WOD 를 runQuery 로 가져와
 * 파싱한 뒤 data/wod-YYYY-MM-DD.json + data/latest.json 으로 저장한다.
 *
 * 사용:  node collector/collect.js
 * 환경변수(.env, 선택):
 *   STADION_BOX_IDX   지점 idx (기본 1 = 스타디온 판교)
 *   STADION_API_HOST  API 호스트 (기본 http://api.stadion.co.kr:8080)
 *   HIGHLIGHT_CATEGORY 강조 카테고리 idx (기본 6 = DIET/SWEAT CAMP)
 *
 * 실패해도 기존 data/*.json 은 건드리지 않는다(조용히 이전 데이터 유지).
 */

const fs = require('node:fs');
const path = require('node:path');
const { runQuery, q } = require('./api');
const { parseWod } = require('./parser');

// .env 로드 (의존성 없이 최소 파서)
loadDotenv(path.join(__dirname, '..', '.env'));

const BOX_IDX = parseInt(process.env.STADION_BOX_IDX || '1', 10);
const HIGHLIGHT_CATEGORY = parseInt(process.env.HIGHLIGHT_CATEGORY || '6', 10);
const DATA_DIR = path.join(__dirname, '..', 'data');
const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'movements.json'), 'utf8'));

async function main() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const dToday = ymd(today);
  const dTomorrow = ymd(tomorrow);

  const boxName = await fetchBoxName(BOX_IDX);
  console.log(`[collect] 지점 #${BOX_IDX} ${boxName} · ${dToday} / ${dTomorrow}`);

  const days = {};
  const allUnmatched = [];
  for (const date of [dToday, dTomorrow]) {
    const wods = await fetchDayWods(date);
    for (const w of wods) allUnmatched.push(...w.unmatched);
    days[date] = wods;
    console.log(`[collect]   ${date}: WOD ${wods.length}건`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    box: { idx: BOX_IDX, name: boxName },
    highlightCategory: HIGHLIGHT_CATEGORY,
    today: dToday,
    tomorrow: dTomorrow,
    days,
  };

  // 저장 (오늘 데이터가 0건이면 이전 파일 보존 — 조용한 실패 방지)
  const hasToday = (days[dToday] || []).length > 0;
  if (!hasToday) {
    console.warn('[collect] 오늘 WOD 0건 → 기존 데이터 유지, 저장 생략');
  } else {
    writeJson(path.join(DATA_DIR, `wod-${dToday}.json`), payload);
    writeJson(path.join(DATA_DIR, 'latest.json'), payload);
    // file:// 로컬에서도 fetch 없이 열리도록 JS 형태로도 출력
    fs.writeFileSync(path.join(DATA_DIR, 'latest.js'),
      'window.WOD_DATA = ' + JSON.stringify(payload) + ';\n');
    console.log(`[collect] 저장: data/wod-${dToday}.json, data/latest.json, data/latest.js`);
  }

  // 매칭 실패 용어 로그(부록 B) — 사전 점진 보강용
  const uniq = [...new Set(allUnmatched)].sort();
  if (uniq.length) {
    const line = `# ${new Date().toISOString()}\n` + uniq.map(u => `${u}`).join('\n') + '\n';
    fs.appendFileSync(path.join(DATA_DIR, 'unmatched.log'), line);
    console.log(`[collect] 미등록 용어 ${uniq.length}개 → data/unmatched.log`);
  }
}

async function fetchBoxName(idx) {
  const rows = await runQuery(`SELECT name FROM boxInfo WHERE idx = ${idx}`);
  return rows[0]?.name || `box#${idx}`;
}

/** 특정 날짜·지점의 모든 WOD(+스텝 파싱+시간표) */
async function fetchDayWods(date) {
  const wodRows = await runQuery(
    `SELECT w.idx, w.name, w.categoryIdx, c.name AS cat
     FROM wodInfo w
     JOIN wodBoxLinkInfo bl ON bl.wodIdx = w.idx AND bl.boxIdx = ${BOX_IDX} AND bl.status = 1
     LEFT JOIN wodCategoryInfo c ON c.idx = w.categoryIdx
     WHERE w.progressDate = '${q(date)}' AND w.status = 1
     GROUP BY w.idx
     ORDER BY (w.categoryIdx = ${HIGHLIGHT_CATEGORY}) DESC, w.categoryIdx`
  );

  const result = [];
  for (const w of wodRows) {
    const steps = await runQuery(
      `SELECT sequence, name, kind, explanation, timeCap, totalRound
       FROM wodStepInfo WHERE wodIdx = ${w.idx} AND status = 1
       ORDER BY sequence, idx`
    );
    const times = await runQuery(
      `SELECT DISTINCT progressTime FROM wodBoxLinkInfo
       WHERE wodIdx = ${w.idx} AND boxIdx = ${BOX_IDX} AND status = 1
       ORDER BY progressTime`
    );

    const parsedSteps = [];
    const unmatched = [];
    for (const s of steps) {
      const parsed = parseWod(s.explanation, dict);
      unmatched.push(...parsed.unmatched);
      parsedSteps.push({
        kind: s.kind,
        raw: s.explanation,
        sections: parsed.sections,
      });
    }

    result.push({
      idx: w.idx,
      name: w.name,
      categoryIdx: w.categoryIdx,
      category: w.cat || null,
      highlight: w.categoryIdx === HIGHLIGHT_CATEGORY,
      times: times.map(t => hhmm(t.progressTime)),
      steps: parsedSteps,
      unmatched,
    });
  }
  return result;
}

// --- helpers ---
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(t) {
  // "06:40:00" → "06:40", Date/기타 → 그대로 문자열화
  const s = String(t);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

main().catch(err => {
  console.error('[collect] 실패:', err.message);
  console.error('[collect] 기존 데이터를 그대로 유지합니다.');
  process.exit(1);
});
