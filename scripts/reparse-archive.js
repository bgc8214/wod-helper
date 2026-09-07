'use strict';
/**
 * 아카이브 재파싱 — 저장된 원문(raw)을 현재 파서·사전으로 다시 해석한다.
 * API 를 다시 호출하지 않으므로 파서를 고칠 때마다 안전하게 돌릴 수 있다.
 *
 * 사용:  node scripts/reparse-archive.js [--month 2026-09]
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseWod } = require('../collector/parser');
const { analyzeFocus } = require('../collector/focus');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'movements.json'), 'utf8'));

const argv = process.argv.slice(2);
const only = argv.includes('--month') ? argv[argv.indexOf('--month') + 1] : null;

const files = fs.readdirSync(ARCHIVE_DIR)
  .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
  .filter(f => !only || f === `${only}.json`)
  .sort();

let wods = 0, steps = 0, changed = 0;
for (const f of files) {
  const file = path.join(ARCHIVE_DIR, f);
  let a;
  try { a = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`[reparse] ${f} 파싱 실패 — 건너뜀`); continue; }

  for (const list of Object.values(a.days || {})) {
    for (const w of list) {
      wods++;
      const before = JSON.stringify(w.focus || null);
      const allSections = [];
      for (const st of w.steps || []) {
        if (!st.raw) continue;
        steps++;
        const r = parseWod(st.raw, dict);
        st.sections = r.sections;
        allSections.push(...r.sections);
      }
      if (allSections.length) {
        w.focus = analyzeFocus(allSections);
        // 분석 후 운동 객체 인라인 제거(사전은 latest.js 에 한 번만 실린다)
        for (const st of w.steps || []) {
          for (const sec of st.sections || []) {
            for (const it of sec.items || []) delete it.movement;
            for (const sc of sec.scales || []) for (const it of sc.items || []) delete it.movement;
            for (const n of sec.notes || []) for (const it of n.items || []) delete it.movement;
          }
        }
      }
      if (before !== JSON.stringify(w.focus || null)) changed++;
    }
  }
  a.reparsedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(a));
}

console.log(`[reparse] ${files.length}개월 · WOD ${wods}건 · 스텝 ${steps}건 재파싱`);
console.log(`[reparse] 집중 부위 분석이 바뀐 WOD: ${changed}건`);
