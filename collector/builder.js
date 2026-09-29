'use strict';
/**
 * 공유 빌더 — collect.js(자동 수집)와 ingest.js(스크린샷 입력)가 함께 쓴다.
 *
 * 하는 일:
 *  - WOD 원문 텍스트 → 파싱·분석된 WOD 객체 (buildWod)
 *  - 월별 아카이브 병합 저장 (mergeArchive)
 *  - 아카이브 전체를 훑어 latest.json/js + index.json 재생성 (rebuildLatest)
 *
 * 데이터 소스가 API(1.0)든 스크린샷이든, 일단 아카이브에 쌓이면
 * 그 뒤 웹 산출물 생성은 이 모듈 하나로 통일된다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseWod } = require('./parser');
const { analyzeFocus, analyzeDay } = require('./focus');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'movements.json'), 'utf8'));
const HIGHLIGHT_CATEGORY = parseInt(process.env.HIGHLIGHT_CATEGORY || '6', 10);

/**
 * WOD 한 건을 원문에서 만든다.
 * @param {object} o  { idx, name, categoryIdx, category, times, raw, scales, source }
 */
function buildWod(o) {
  const parsed = parseWod(o.raw || '', dict);
  const step = {
    kind: o.kind || 'BI',
    raw: o.raw || '',
    sections: parsed.sections,
    scales: o.scales || [],
  };
  const focus = analyzeFocus(parsed.sections);
  stripMovements([step]);
  return {
    idx: o.idx,
    name: o.name,
    categoryIdx: o.categoryIdx,
    category: o.category || null,
    highlight: o.categoryIdx === HIGHLIGHT_CATEGORY,
    times: o.times || [],
    steps: [step],
    focus,
    unmatched: parsed.unmatched,
    source: o.source || 'api',       // 'api' | 'screenshot'
  };
}

function stripMovements(steps) {
  for (const st of steps) {
    for (const sec of st.sections || []) {
      for (const it of sec.items || []) delete it.movement;
      for (const sc of sec.scales || []) for (const it of sc.items || []) delete it.movement;
      for (const n of sec.notes || []) for (const it of n.items || []) delete it.movement;
    }
  }
}

/** days{date:[wod]} 를 월별 아카이브에 병합. 갱신된 월 목록 반환 */
function mergeArchive(days, box) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const byMonth = new Map();
  for (const [date, wods] of Object.entries(days)) {
    const m = date.slice(0, 7);
    (byMonth.get(m) || byMonth.set(m, {}).get(m))[date] = wods;
  }
  const touched = [];
  for (const [month, monthDays] of byMonth) {
    const file = path.join(ARCHIVE_DIR, `${month}.json`);
    let existing = { month, box, days: {} };
    if (fs.existsSync(file)) {
      try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 손상 시 새로 */ }
    }
    // 같은 날짜는 기존 배열에 카테고리별로 덮어쓴다(수동 입력이 자동 수집분을 보완)
    for (const [date, wods] of Object.entries(monthDays)) {
      const prev = existing.days[date] || [];
      const merged = mergeDayWods(prev, wods);
      existing.days[date] = merged;
    }
    existing.month = month;
    existing.box = box;
    existing.dates = Object.keys(existing.days).sort();
    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(existing));
    touched.push(month);
  }
  return touched.sort();
}

/** 같은 날짜 내에서 categoryIdx(+name) 기준으로 덮어쓰며 병합 */
function mergeDayWods(prev, next) {
  const keyOf = w => `${w.categoryIdx}|${w.name}`;
  const map = new Map(prev.map(w => [keyOf(w), w]));
  for (const w of next) map.set(keyOf(w), w);
  return [...map.values()];
}

/** 아카이브 전체 → latest.json/js + index.json 재생성 */
function rebuildLatest(opts = {}) {
  const box = opts.box || readAnyBox() || { idx: 1, name: '스타디온 판교' };
  const today = opts.today || ymd(new Date());
  const daysAhead = opts.daysAhead != null ? opts.daysAhead : 6;

  const allDays = readArchiveDays();
  const dates = Object.keys(allDays).sort();

  // latest 에 실을 날짜: 오늘~+N일 중 데이터 있는 것.
  // 없으면(판교 2.0 공백기) 가장 가까운 과거 데이터로 폴백.
  const windowEnd = ymd(new Date(parseYmd(today).getTime() + daysAhead * 86400000));
  let windowDates = dates.filter(d => d >= today && d <= windowEnd);
  if (!windowDates.length) {
    const past = dates.filter(d => d <= today);
    if (past.length) windowDates = [past[past.length - 1]];
  }
  const days = Object.fromEntries(windowDates.map(d => [d, allDays[d]]));

  const payload = {
    generatedAt: new Date().toISOString(),
    box,
    highlightCategory: HIGHLIGHT_CATEGORY,
    today,
    tomorrow: ymd(new Date(parseYmd(today).getTime() + 86400000)),
    latestDataDate: dates[dates.length - 1] || null,   // 실제 최신 데이터 날짜(배너용)
    dates: windowDates,
    days,
    dayFocus: Object.fromEntries(windowDates.map(d => [d, analyzeDay(days[d], HIGHLIGHT_CATEGORY)])),
    stats: buildStats(allDays),
  };

  writeIndex(dates);
  fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(DATA_DIR, 'latest.js'),
    'window.WOD_DATA = ' + JSON.stringify(payload) + ';\n' +
    'window.WOD_DICT = ' + JSON.stringify(slimDict()) + ';\n' +
    'window.WOD_VIDEOS = ' + JSON.stringify(loadVideos()) + ';\n');
  return { dates: windowDates, latestDataDate: payload.latestDataDate };
}

/** 아카이브 모든 날짜의 WOD 를 {date:[wod]} 로 (중복 날짜는 최신 파일 우선) */
function readArchiveDays() {
  if (!fs.existsSync(ARCHIVE_DIR)) return {};
  const out = {};
  for (const f of fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort()) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8'));
      Object.assign(out, a.days || {});
    } catch { /* 손상 무시 */ }
  }
  return out;
}

function readAnyBox() {
  if (!fs.existsSync(ARCHIVE_DIR)) return null;
  const files = fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort();
  for (const f of files.reverse()) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8'));
      if (a.box) return a.box;
    } catch { /* skip */ }
  }
  return null;
}

function writeIndex(dates) {
  const months = fs.existsSync(ARCHIVE_DIR)
    ? fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).map(f => f.replace('.json', '')).sort()
    : [];
  const sorted = (dates || []).slice().sort();
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify({
    months,
    dates: sorted,
    first: sorted[0] || null,
    last: sorted[sorted.length - 1] || null,
    updatedAt: new Date().toISOString(),
  }));
}

/** 최근 28일 통계 (관심 카테고리만) */
function buildStats(allDays, windowDays = 28) {
  const end = new Date();
  const from = ymd(new Date(end.getTime() - windowDays * 86400000));
  const to = ymd(end);
  const movementCount = new Map(), partCount = new Map(), categoryCount = new Map();
  let wodCount = 0, dayCount = 0;

  for (const [date, wods] of Object.entries(allDays)) {
    if (date < from || date > to) continue;
    const target = wods.filter(w => w.categoryIdx === HIGHLIGHT_CATEGORY);
    if (!target.length) continue;
    dayCount++;
    for (const w of target) {
      wodCount++;
      if (w.category) categoryCount.set(w.category, (categoryCount.get(w.category) || 0) + 1);
      for (const p of w.focus?.parts || []) partCount.set(p.name, (partCount.get(p.name) || 0) + p.value);
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
  if (!wodCount) return null;
  return {
    windowDays, from, to,
    categoryIdx: HIGHLIGHT_CATEGORY,
    categoryName: [...categoryCount.keys()][0] || null,
    dayCount, wodCount,
    topMovements: [...movementCount.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    parts: [...partCount.entries()].map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 })).sort((a, b) => b.value - a.value),
    categories: [...categoryCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

function loadVideos() {
  const f = path.join(DATA_DIR, 'videos.json');
  if (!fs.existsSync(f)) return {};
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    const out = {};
    for (const key of Object.keys(dict.movements)) {
      const src = v[dict.movements[key].videoOf || key] || v[key];
      if (!src) continue;
      out[key] = { id: src.id, title: src.title, author: src.author, start: src.start || 0, alts: src.alts || [] };
    }
    return out;
  } catch { return {}; }
}

function slimDict() {
  const out = {};
  for (const [key, m] of Object.entries(dict.movements)) {
    out[key] = { ko: m.ko, desc: m.desc, youtube: m.youtube, parts: m.parts, patterns: m.patterns };
  }
  return out;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

module.exports = { buildWod, mergeArchive, rebuildLatest, readArchiveDays, dict, HIGHLIGHT_CATEGORY, ymd };
