'use strict';
/**
 * 아카이브 경량화(일회성) — API 재호출 없이 기존 파일만 다시 쓴다.
 *  1) items[].movement 인라인 제거 (사전은 latest.js 에 한 번만 실림)
 *  2) 들여쓰기 제거
 *
 * 사용:  node scripts/compact-archive.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'archive');
const files = fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort();

let before = 0, after = 0, stripped = 0;
for (const f of files) {
  const file = path.join(ARCHIVE_DIR, f);
  before += fs.statSync(file).size;
  let a;
  try { a = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`[compact] ${f} 파싱 실패 — 건너뜀: ${e.message}`); continue; }

  for (const wods of Object.values(a.days || {})) {
    for (const w of wods) {
      for (const st of w.steps || []) {
        for (const sec of st.sections || []) {
          for (const it of sec.items || []) {
            if (it.movement) { delete it.movement; stripped++; }
          }
        }
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(a));
  after += fs.statSync(file).size;
}

const mb = n => (n / 1048576).toFixed(1) + 'MB';
console.log(`[compact] ${files.length}개월 · movement 인라인 ${stripped}건 제거`);
console.log(`[compact] ${mb(before)} → ${mb(after)} (${Math.round((1 - after / before) * 100)}% 절감)`);
