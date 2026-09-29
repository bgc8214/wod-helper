'use strict';
/**
 * 스크린샷 입력 — 앱 화면에서 읽은 WOD 원문 텍스트를 카드로 만든다.
 * Stadion 2.0 이 API 를 막은 뒤 판교 WOD 를 넣는 주 통로.
 *
 * 사용:
 *   node scripts/ingest.js --date 2026-09-29 --cat 6 < wod.txt
 *   node scripts/ingest.js --date 2026-09-29 --cat 6 --file wod.txt
 *   node scripts/ingest.js --date 2026-09-29 --cat 6 --name "DIET/SWEAT CAMP" \
 *        --times "09:00,12:15" --text "WARM UP\n..."
 *
 * 옵션:
 *   --date   YYYY-MM-DD (필수)
 *   --cat    카테고리 idx (기본 6 = DIET/SWEAT CAMP)
 *   --name   수업 표시 이름 (기본: 카테고리명)
 *   --times  쉼표 구분 시간표 (선택)
 *   --file   원문 파일 경로 (없으면 stdin)
 *   --text   원문 직접 전달 (\n 은 줄바꿈)
 *   --box    지점 idx / 이름 (기본 1 / 스타디온 판교)
 *   --dry    저장하지 않고 파싱 결과만 출력
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildWod, mergeArchive, rebuildLatest, readArchiveDays } = require('../collector/builder');

// 판교 카테고리 (아카이브에서 관측된 것). idx→이름.
const CATEGORIES = {
  2: 'RUN&LIFT', 3: 'CROSSFIT', 6: 'DIET/SWEAT CAMP', 8: 'BJ LIFT',
  17: 'ON RAMP (PG)', 18: 'STADION DAY', 20: 'CF ELITE', 23: 'RUN CLUB',
  24: 'WEIGHT LIFTING', 26: 'YOGA', 30: 'ON RAMP (PG)', 31: 'HYROX', 34: 'MMA',
};

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const has = f => argv.includes(f);

function main() {
  const date = arg('--date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail('--date YYYY-MM-DD 가 필요합니다.');
  }
  const cat = parseInt(arg('--cat', '6'), 10);
  const name = arg('--name') || CATEGORIES[cat] || `수업 #${cat}`;
  const times = (arg('--times') || '').split(',').map(s => s.trim()).filter(Boolean);
  const boxIdx = parseInt(arg('--box', '1'), 10);
  const boxName = /^\d+$/.test(arg('--box', '1')) ? '스타디온 판교' : arg('--box');

  let raw = arg('--text');
  if (raw != null) raw = raw.replace(/\\n/g, '\n');
  else if (arg('--file')) raw = fs.readFileSync(arg('--file'), 'utf8');
  else raw = fs.readFileSync(0, 'utf8');   // stdin
  raw = String(raw || '').trim();
  if (!raw) fail('원문 텍스트가 비어 있습니다. (stdin / --file / --text)');

  // 같은 날짜의 기존 WOD 중 최대 idx+1 로 안정적인 로컬 idx 부여
  const existing = readArchiveDays()[date] || [];
  const maxIdx = existing.reduce((n, w) => Math.max(n, Number(w.idx) || 0), 900000);

  const wod = buildWod({
    idx: pickIdx(existing, cat, maxIdx),
    name: `${date.slice(5).replace('-', '')} ${name}`,
    categoryIdx: cat,
    category: CATEGORIES[cat] || name,
    times,
    raw,
    source: 'screenshot',
  });

  // 파싱 요약 출력
  reportParse(wod);

  if (has('--dry')) {
    console.log('\n[ingest] --dry: 저장하지 않았습니다.');
    return;
  }

  const box = { idx: boxIdx, name: boxName };
  const touched = mergeArchive({ [date]: [wod] }, box);
  const res = rebuildLatest({ box });
  console.log(`\n[ingest] 저장 완료`);
  console.log(`  아카이브: ${touched.join(', ')} (${date} · ${name})`);
  console.log(`  latest 표시 날짜: ${res.dates.join(', ') || '없음'}`);
  console.log(`  최신 데이터 날짜: ${res.latestDataDate}`);
  if (wod.unmatched.length) {
    console.log(`  ⚠️ 미등록 용어 ${wod.unmatched.length}개: ${wod.unmatched.join(', ')}`);
    console.log('     → data/movements.json 에 추가하면 다음 입력부터 인식됩니다.');
  }
}

/** 같은 카테고리가 이미 있으면 그 idx 재사용(덮어쓰기), 없으면 새 idx */
function pickIdx(existing, cat, maxIdx) {
  const same = existing.find(w => w.categoryIdx === cat);
  return same ? same.idx : maxIdx + 1;
}

function reportParse(wod) {
  console.log(`[ingest] ${wod.name} (cat ${wod.categoryIdx}${wod.highlight ? ' ★' : ''})`);
  console.log(`  집중: ${wod.focus.summary || '-'} · ${wod.focus.type || '-'}`);
  let ok = 0, ng = 0;
  for (const sec of wod.steps[0].sections) {
    const parts = [];
    (sec.formats || []).forEach(f => parts.push(`포맷:${f.ko}`));
    if (sec.scheme) parts.push(`스킴:${sec.scheme}`);
    (sec.prescriptions || []).forEach(p => parts.push(p.kind === 'set'
      ? `처방:${p.reps}회@${p.intensity}` : `휴식:${p.time}`));
    console.log(`  [${sec.nameKo}] ${parts.join(' ')}`);
    for (const it of sec.items || []) {
      if (it.meta) continue;
      if (it.movementKey) { ok++; console.log(`     ✓ ${it.raw}`); }
      else { ng++; console.log(`     ✗ ${it.raw} (미등록)`); }
    }
  }
  console.log(`  → 매칭 ${ok} / 미등록 ${ng}`);
}

function fail(msg) { console.error('[ingest] ' + msg); process.exit(1); }

main();
