'use strict';
/**
 * WOD 수집기 — 지정 지점의 WOD 를 runQuery 로 가져와 파싱·분석 후 저장한다.
 *
 * 사용:  node collector/collect.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--quiet]
 * 환경변수(.env, 선택):
 *   STADION_BOX_IDX    지점 idx (기본 1 = 스타디온 판교)
 *   STADION_API_HOST   API 호스트 (기본 http://api.stadion.co.kr:8080)
 *   HIGHLIGHT_CATEGORY 강조 카테고리 idx (기본 6 = DIET/SWEAT CAMP)
 *   DAYS_AHEAD         오늘부터 며칠 뒤까지 수집 (기본 6)
 *
 * 산출물:
 *   data/latest.json / latest.js  — 오늘~+N일 (웹 초기 로드)
 *   data/archive/YYYY-MM.json     — 월별 누적 아카이브 (과거 조회용)
 *   data/index.json               — 아카이브 월 목록·날짜 목록 (날짜 탐색용)
 *
 * WOD 건마다 쿼리하지 않고 IN 절로 묶어 총 4쿼리만 쓴다(API 부담 최소화).
 * 실패해도 기존 산출물은 건드리지 않는다.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runQuery, q } = require('./api');
const { parseWod } = require('./parser');
const { analyzeFocus, analyzeDay } = require('./focus');

loadDotenv(path.join(__dirname, '..', '.env'));

const BOX_IDX = parseInt(process.env.STADION_BOX_IDX || '1', 10);
const HIGHLIGHT_CATEGORY = parseInt(process.env.HIGHLIGHT_CATEGORY || '6', 10);
const DAYS_AHEAD = parseInt(process.env.DAYS_AHEAD || '6', 10);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'movements.json'), 'utf8'));

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const argFrom = argValue('--from');
const argTo = argValue('--to');

async function main() {
  const today = new Date();
  const dToday = ymd(today);
  const from = argFrom || dToday;
  const to = argTo || ymd(new Date(today.getTime() + DAYS_AHEAD * 86400000));

  const boxName = await fetchBoxName(BOX_IDX);
  log(`[collect] 지점 #${BOX_IDX} ${boxName} · ${from} ~ ${to}`);

  const days = await fetchRangeWods(from, to);
  const dates = Object.keys(days).sort();
  const total = dates.reduce((n, d) => n + days[d].length, 0);
  log(`[collect] ${dates.length}일 / WOD ${total}건 수집`);

  // 아카이브 누적 (과거 조회용) — 수집한 날짜를 월별 파일에 병합
  const touchedMonths = mergeArchive(days, boxName);

  // 백필 모드(--from 지정)면 아카이브만 갱신하고 latest 는 건드리지 않는다
  if (argFrom) {
    writeIndex();
    log(`[collect] 백필 완료 — 아카이브 ${touchedMonths.length}개월 갱신`);
    return;
  }

  // 오늘 데이터가 0건이면 이전 파일 보존 (조용한 실패 방지)
  if (!(days[dToday] || []).length) {
    console.warn('[collect] 오늘 WOD 0건 → 기존 latest 유지, 저장 생략');
    writeIndex();
    return;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    box: { idx: BOX_IDX, name: boxName },
    highlightCategory: HIGHLIGHT_CATEGORY,
    today: dToday,
    tomorrow: ymd(new Date(today.getTime() + 86400000)),
    dates,
    days,
    dayFocus: Object.fromEntries(dates.map(d => [d, analyzeDay(days[d], HIGHLIGHT_CATEGORY)])),
    stats: buildStats(),
  };

  writeJson(path.join(DATA_DIR, `wod-${dToday}.json`), payload);
  writeJson(path.join(DATA_DIR, 'latest.json'), payload);
  // file:// 로컬에서도 fetch 없이 열리도록 JS 형태로도 출력.
  // 운동 사전은 여기 한 번만 실어 아카이브가 movementKey 로 조인하게 한다.
  fs.writeFileSync(path.join(DATA_DIR, 'latest.js'),
    'window.WOD_DATA = ' + JSON.stringify(payload) + ';\n' +
    'window.WOD_DICT = ' + JSON.stringify(slimDict()) + ';\n' +
    'window.WOD_VIDEOS = ' + JSON.stringify(loadVideos()) + ';\n');
  writeIndex();
  log(`[collect] 저장: latest.json/js, 아카이브 ${touchedMonths.join(', ')}`);

  const unmatched = collectUnmatched(days);
  if (unmatched.length) {
    const line = `# ${new Date().toISOString()}\n` + unmatched.join('\n') + '\n';
    fs.appendFileSync(path.join(DATA_DIR, 'unmatched.log'), line);
    log(`[collect] 미등록 용어 ${unmatched.length}개 → data/unmatched.log`);
  }
}

async function fetchBoxName(idx) {
  const rows = await runQuery(`SELECT name FROM boxInfo WHERE idx = ${idx}`);
  return rows[0]?.name || `box#${idx}`;
}

/**
 * 날짜 범위의 WOD 를 4쿼리로 가져온다.
 *  1) 범위 내 WOD 목록  2) 해당 WOD 들의 스텝  3) 해당 WOD 들의 시간표
 */
async function fetchRangeWods(from, to) {
  const wodRows = await runQuery(
    `SELECT w.idx, w.name, w.progressDate, w.categoryIdx, c.name AS cat
     FROM wodInfo w
     JOIN wodBoxLinkInfo bl ON bl.wodIdx = w.idx AND bl.boxIdx = ${BOX_IDX} AND bl.status = 1
     LEFT JOIN wodCategoryInfo c ON c.idx = w.categoryIdx
     WHERE w.progressDate >= '${q(from)}' AND w.progressDate <= '${q(to)}' AND w.status = 1
     GROUP BY w.idx
     ORDER BY w.progressDate, (w.categoryIdx = ${HIGHLIGHT_CATEGORY}) DESC, w.categoryIdx`
  );
  if (!wodRows.length) return {};

  const ids = wodRows.map(w => w.idx);
  const stepsByWod = groupBy(
    await runQueryChunked(ids, list =>
      `SELECT wodIdx, sequence, name, kind, explanation, timeCap, totalRound,
              scaleContent_E, scaleContent_A, scaleContent_I, scaleContent_N
       FROM wodStepInfo WHERE wodIdx IN (${list}) AND status = 1
       ORDER BY wodIdx, sequence, idx`),
    r => r.wodIdx
  );
  const timesByWod = groupBy(
    await runQueryChunked(ids, list =>
      `SELECT DISTINCT wodIdx, progressTime FROM wodBoxLinkInfo
       WHERE wodIdx IN (${list}) AND boxIdx = ${BOX_IDX} AND status = 1
       ORDER BY wodIdx, progressTime`),
    r => r.wodIdx
  );

  const days = {};
  for (const w of wodRows) {
    const date = dateOf(w.progressDate, w.name);
    if (!date) continue;
    const steps = stepsByWod.get(w.idx) || [];
    const parsedSteps = [];
    const unmatched = [];
    for (const s of steps) {
      const parsed = parseWod(s.explanation, dict);
      unmatched.push(...parsed.unmatched);
      parsedSteps.push({
        kind: s.kind,
        raw: s.explanation,
        sections: parsed.sections,
        scales: pickScales(s),
      });
    }
    const allSections = parsedSteps.flatMap(s => s.sections);
    const focus = analyzeFocus(allSections);
    // 분석이 끝나면 운동 객체 인라인을 걷어낸다(사전은 latest.js 에 한 번만 실림).
    stripMovements(parsedSteps);
    (days[date] ||= []).push({
      idx: w.idx,
      name: w.name,
      categoryIdx: w.categoryIdx,
      category: w.cat || null,
      highlight: w.categoryIdx === HIGHLIGHT_CATEGORY,
      times: (timesByWod.get(w.idx) || []).map(t => hhmm(t.progressTime)),
      steps: parsedSteps,
      focus,
      unmatched,
    });
  }
  return days;
}

/** IN 절이 너무 길어지지 않도록 400개씩 나눠 조회 */
async function runQueryChunked(ids, sqlFor, size = 400) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    const list = ids.slice(i, i + size).join(',');
    out.push(...await runQuery(sqlFor(list)));
  }
  return out;
}

/** 파싱 결과에서 운동 객체 인라인 제거 — movementKey 로만 참조 */
function stripMovements(steps) {
  for (const st of steps) {
    for (const sec of st.sections || []) {
      for (const it of sec.items || []) delete it.movement;
    }
  }
}

/** 운동별 시연 영상 (scripts/fetch-videos.js 산출물, 없으면 빈 객체) */
function loadVideos() {
  const f = path.join(DATA_DIR, 'videos.json');
  if (!fs.existsSync(f)) return {};
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    const out = {};
    for (const key of Object.keys(dict.movements)) {
      // 파생 동작(빈 바 프론트 스쿼트 등)은 기본 동작 영상을 쓴다
      const src = v[dict.movements[key].videoOf || key] || v[key];
      if (!src) continue;
      out[key] = { id: src.id, title: src.title, author: src.author,
                   start: src.start || 0, alts: src.alts || [] };
    }
    return out;
  } catch { return {}; }
}

/** 웹에 실을 슬림 사전 (aliases 는 매칭용이라 제외) */
function slimDict() {
  const out = {};
  for (const [key, m] of Object.entries(dict.movements)) {
    out[key] = { ko: m.ko, desc: m.desc, youtube: m.youtube, parts: m.parts, patterns: m.patterns };
  }
  return out;
}

/** 난이도별 스케일링 옵션 (비어 있으면 제외) */
function pickScales(s) {
  const map = {
    N: { label: '입문', text: s.scaleContent_N },
    I: { label: '초급', text: s.scaleContent_I },
    A: { label: '중급', text: s.scaleContent_A },
    E: { label: '상급', text: s.scaleContent_E },
  };
  const out = [];
  for (const [key, v] of Object.entries(map)) {
    const text = String(v.text || '').trim();
    if (text) out.push({ key, label: v.label, text });
  }
  return out;
}

/** 수집분을 월별 아카이브에 병합 저장. 갱신된 월 목록 반환 */
function mergeArchive(days, boxName) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const byMonth = new Map();
  for (const [date, wods] of Object.entries(days)) {
    const m = date.slice(0, 7);
    (byMonth.get(m) || byMonth.set(m, {}).get(m))[date] = wods;
  }
  const touched = [];
  for (const [month, monthDays] of byMonth) {
    const file = path.join(ARCHIVE_DIR, `${month}.json`);
    let existing = { month, box: { idx: BOX_IDX, name: boxName }, days: {} };
    if (fs.existsSync(file)) {
      try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 손상 시 새로 씀 */ }
    }
    existing.days = { ...existing.days, ...monthDays };
    existing.month = month;
    existing.box = { idx: BOX_IDX, name: boxName };
    existing.dates = Object.keys(existing.days).sort();
    existing.updatedAt = new Date().toISOString();
    writeJson(file, existing);
    touched.push(month);
  }
  return touched.sort();
}

/** 아카이브 목록 → data/index.json (웹 날짜 탐색용) */
function writeIndex() {
  if (!fs.existsSync(ARCHIVE_DIR)) return;
  const months = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort();
  const index = { months, updatedAt: new Date().toISOString() };
  // 날짜 목록도 함께(달력에서 WOD 있는 날 표시용)
  const dates = [];
  for (const m of months) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, `${m}.json`), 'utf8'));
      dates.push(...(a.dates || Object.keys(a.days || {})));
    } catch { /* 손상 파일 무시 */ }
  }
  index.dates = dates.sort();
  index.first = index.dates[0] || null;
  index.last = index.dates[index.dates.length - 1] || null;
  writeJson(path.join(DATA_DIR, 'index.json'), index);
}

/**
 * 아카이브 기반 최근 28일 통계 (운동 빈도·부위 분포).
 * 오너 관심 수업(HIGHLIGHT_CATEGORY = DIET/SWEAT CAMP)만 집계한다.
 */
function buildStats(windowDays = 28) {
  if (!fs.existsSync(ARCHIVE_DIR)) return null;
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 86400000);
  const from = ymd(start), to = ymd(end);

  const months = new Set([from.slice(0, 7), to.slice(0, 7)]);
  const movementCount = new Map();
  const partCount = new Map();
  const categoryCount = new Map();
  let wodCount = 0, dayCount = 0;

  for (const m of months) {
    const file = path.join(ARCHIVE_DIR, `${m}.json`);
    if (!fs.existsSync(file)) continue;
    let a;
    try { a = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const [date, wods] of Object.entries(a.days || {})) {
      if (date < from || date > to) continue;
      const target = wods.filter(w => w.categoryIdx === HIGHLIGHT_CATEGORY);
      if (!target.length) continue;
      dayCount++;
      for (const w of target) {
        wodCount++;
        if (w.category) categoryCount.set(w.category, (categoryCount.get(w.category) || 0) + 1);
        for (const p of w.focus?.parts || []) {
          partCount.set(p.name, (partCount.get(p.name) || 0) + p.value);
        }
        for (const step of w.steps || []) {
          for (const sec of step.sections || []) {
            for (const it of sec.items || []) {
              if (!it.movementKey) continue;
              const ko = dict.movements[it.movementKey]?.ko || it.movementKey;
              const cur = movementCount.get(it.movementKey) || { key: it.movementKey, ko, count: 0 };
              cur.count++;
              movementCount.set(it.movementKey, cur);
            }
          }
        }
      }
    }
  }
  if (!wodCount) return null;

  return {
    windowDays,
    from, to,
    categoryIdx: HIGHLIGHT_CATEGORY,
    categoryName: [...categoryCount.keys()][0] || null,
    dayCount, wodCount,
    topMovements: [...movementCount.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    parts: [...partCount.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
      .sort((a, b) => b.value - a.value),
    categories: [...categoryCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function collectUnmatched(days) {
  const all = [];
  for (const wods of Object.values(days)) {
    for (const w of wods) all.push(...(w.unmatched || []));
  }
  return [...new Set(all)].sort();
}

// --- helpers ---
function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    (m.get(k) || m.set(k, []).get(k)).push(r);
  }
  return m;
}

/**
 * progressDate 는 DATE 지만 JSON 직렬화 시 epoch millis 로 온다.
 * epoch 를 로컬 날짜로 환산하고, 실패하면 WOD 이름의 MMDD prefix 로 보정한다.
 */
function dateOf(progressDate, name) {
  if (typeof progressDate === 'number') return ymd(new Date(progressDate));
  const s = String(progressDate || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const n = String(name || '').match(/^(\d{2})(\d{2})\b/);
  if (n) return `${new Date().getFullYear()}-${n[1]}-${n[2]}`;
  return null;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(t) {
  const s = String(t);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}
/** 산출물은 웹이 내려받는 파일이라 들여쓰기 없이 저장한다(용량 60%↓) */
function writeJson(file, obj, pretty = false) {
  fs.writeFileSync(file, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
function log(...a) { if (!QUIET) console.log(...a); }
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
