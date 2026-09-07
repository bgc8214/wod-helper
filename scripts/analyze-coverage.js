'use strict';
/**
 * 사전 커버리지 분석 — 아카이브 전체(5년치)를 다시 파싱해서
 * "실제로 얼마나 자주 나오는데 사전에 없는 용어"를 빈도순으로 뽑는다.
 *
 * 저장된 파싱 결과가 아니라 raw 원문을 현재 파서로 다시 돌리므로,
 * 파서·사전을 고친 뒤 효과를 바로 확인할 수 있다.
 *
 * 사용:  node scripts/analyze-coverage.js [--top 40] [--category 6] [--csv]
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseWod } = require('../collector/parser');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'movements.json'), 'utf8'));

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const TOP = parseInt(arg('--top', '40'), 10);
const CATEGORY = arg('--category', null);
const CSV = argv.includes('--csv');
const SINCE = arg('--since', null);   // 'YYYY-MM-DD' 이후만

const files = fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort();

let wodCount = 0, stepCount = 0;
let matchedItems = 0, unmatchedItems = 0, metaItems = 0;
const missing = new Map();     // 정규화 용어 → {raw, count, firstSeen, lastSeen, cats:Set}
const matchedKeys = new Map();  // 매칭된 운동 → 등장 횟수

for (const f of files) {
  let a;
  try { a = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8')); } catch { continue; }
  for (const [date, wods] of Object.entries(a.days || {})) {
    if (SINCE && date < SINCE) continue;
    for (const w of wods) {
      if (CATEGORY != null && String(w.categoryIdx) !== String(CATEGORY)) continue;
      wodCount++;
      for (const st of w.steps || []) {
        if (!st.raw) continue;
        stepCount++;
        const r = parseWod(st.raw, dict);
        for (const sec of r.sections) {
          const all = [
            ...(sec.items || []),
            ...(sec.scales || []).flatMap(s => s.items || []),
            ...(sec.notes || []).flatMap(n => n.items || []),
          ];
          for (const it of all) {
            if (it.meta) { metaItems++; continue; }   // 파서가 이미 '운동 아님'으로 판정
            if (it.movementKey) {
              matchedItems++;
              matchedKeys.set(it.movementKey, (matchedKeys.get(it.movementKey) || 0) + 1);
            } else {
              unmatchedItems++;
              const key = clean(it.raw);
              if (!key) continue;
              const cur = missing.get(key) || { raw: it.raw, count: 0, first: date, last: date, cats: new Set() };
              cur.count++;
              if (date < cur.first) cur.first = date;
              if (date > cur.last) cur.last = date;
              if (w.category) cur.cats.add(w.category);
              missing.set(key, cur);
            }
          }
        }
      }
    }
  }
}

/** 숫자·단위를 걷어내 같은 용어끼리 묶는다: "20 CAL ROW" ≈ "ROW" */
function clean(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(REPS?|CAL(ORIES?)?|SEC(ONDS?)?|MIN(UTES?)?|M|KM|LB|KG|X|SETS?|ROUNDS?)?\b/g, ' ')
    .replace(/[^A-Z가-힣'&/ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ranked = [...missing.entries()]
  .map(([k, v]) => ({ term: k, ...v, cats: [...v.cats] }))
  .sort((a, b) => b.count - a.count);

const total = matchedItems + unmatchedItems;
const pct = n => total ? (n / total * 100).toFixed(1) : '0';

if (CSV) {
  console.log('term,count,first,last,categories');
  for (const r of ranked) console.log(`"${r.term}",${r.count},${r.first},${r.last},"${r.cats.join('|')}"`);
} else {
  console.log(`\n분석 대상: ${files.length}개월 · WOD ${wodCount}건 · 스텝 ${stepCount}건`
    + (CATEGORY != null ? ` (카테고리 ${CATEGORY} 만)` : '') + (SINCE ? ` (${SINCE} 이후)` : ''));
  console.log(`사전 등록 운동: ${Object.keys(dict.movements).length}개`);
  console.log(`운동 항목 ${total}건 중 매칭 ${matchedItems} (${pct(matchedItems)}%) · `
    + `미매칭 ${unmatchedItems} (${pct(unmatchedItems)}%)`);
  console.log(`(그 밖에 구조·지시문으로 걸러낸 항목 ${metaItems}건)`);
  console.log(`서로 다른 미등록 용어: ${ranked.length}종\n`);

  console.log(`── 미등록 상위 ${Math.min(TOP, ranked.length)}개 (빈도순) ──`);
  ranked.slice(0, TOP).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${String(r.count).padStart(5)}회  ${r.term}`
      + `   [${r.first.slice(0, 7)}~${r.last.slice(0, 7)}]`);
  });

  // 상위 N 개를 채우면 커버리지가 얼마나 오르는지
  let acc = 0;
  const gains = [10, 25, 50, 100].map(n => {
    acc = ranked.slice(0, n).reduce((s, r) => s + r.count, 0);
    return `상위 ${n}개 추가 시 +${(acc / total * 100).toFixed(1)}%p`;
  });
  console.log(`\n예상 효과: ${gains.join(' · ')}`);
}
