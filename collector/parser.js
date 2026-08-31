'use strict';
/**
 * WOD 파서 — wodStepInfo.explanation 원문 텍스트를
 * (섹션, 포맷, 운동+reps) 구조로 정규화한다.
 *
 * PRD 4-2 규칙:
 *  - 섹션: 대문자 헤더 (WARM UP / STRENGTH / METCON / SKILL / COOL DOWN ...)
 *  - 포맷: FOR TIME / AMRAP n / EMOM n / EVERY m:ss X k SETS / TIME CAP: mm:ss ...
 *  - 운동 매칭: 대소문자·복수형·숫자(reps)·괄호 무시, 최장 별칭 우선
 *  - 매칭 실패 용어는 result.unmatched 로 반환 → collector 가 로그에 남김
 *
 * 순수 함수 모듈(부수효과 없음). 테스트는 parser.test.js.
 */

/** 매칭용 정규화: 대문자화, 괄호 내용 제거, 특수문자→공백, 다중공백 정리 */
function normalize(s) {
  return String(s)
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')      // (MODERATE TO HEAVY) 제거
    .replace(/[^A-Z0-9'&/ ]/g, ' ')  // 하이픈·콜론 등 → 공백 ('와 &,/ 는 유지)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 운동 별칭 인덱스 구성: [{norm, key, entry}] 를 길이 내림차순으로 */
function buildMovementIndex(movements) {
  const idx = [];
  for (const [key, entry] of Object.entries(movements)) {
    const names = [key, ...(entry.aliases || [])];
    for (const n of names) {
      const norm = normalize(n);
      if (norm) idx.push({ norm, key, entry });
    }
  }
  idx.sort((a, b) => b.norm.length - a.norm.length); // 최장 우선
  return idx;
}

/** 라인이 섹션 헤더면 {name, nameKo} 반환, 아니면 null */
function matchSection(line, sections) {
  const norm = normalize(line).replace(/[:]/g, '').trim();
  // 헤더는 짧고, 사전에 정확히 있는 경우만 (오탐 방지)
  if (sections[norm]) return { name: norm, nameKo: sections[norm] };
  return null;
}

/** reps 스킴 라인 판정: 21-18-15-12-9, 5-5-5, 10/8/6 등 */
function isRepScheme(line) {
  const t = line.trim();
  return /^\d+(\s*[-–/]\s*\d+)+\s*$/.test(t);
}

/** TIME CAP 추출: "TIME CAP: 16:00" / "TIME CAP 12 MIN" → {value, ko} */
function matchTimeCap(line) {
  const m = line.match(/TIME\s*CAP\s*[:\-]?\s*((\d+):(\d+)|(\d+)\s*MIN)/i);
  if (!m) return null;
  if (m[2] != null) {
    const min = parseInt(m[2], 10), sec = parseInt(m[3], 10);
    const ko = sec ? `제한시간 ${min}분 ${sec}초` : `제한시간 ${min}분`;
    return { value: `${m[2]}:${m[3]}`, ko };
  }
  return { value: `${m[4]}:00`, ko: `제한시간 ${m[4]}분` };
}

/** 포맷 라인 판정 + 한글 변환. 운동이 없는 순수 포맷 라인이면 {raw, ko, desc} */
function matchFormat(line, formats) {
  const t = line.trim();
  const U = t.toUpperCase();

  // EVERY 2:30 X 5 SETS  /  EVERY 2 MIN X 10 SETS
  let m = U.match(/^EVERY\s+(\d+):(\d+)\s*[X×]\s*(\d+)\s*SETS?$/);
  if (m) return { raw: t, ko: `${fmtMinSec(m[1], m[2])}마다 · ${m[3]}세트`, desc: formats.EVERY?.desc };
  m = U.match(/^EVERY\s+(\d+)\s*MIN(?:UTE)?S?\s*[X×]\s*(\d+)\s*SETS?$/);
  if (m) return { raw: t, ko: `${m[1]}분마다 · ${m[2]}세트`, desc: formats.EVERY?.desc };
  m = U.match(/^EVERY\s+(\d+):(\d+)$/);
  if (m) return { raw: t, ko: `${fmtMinSec(m[1], m[2])}마다`, desc: formats.EVERY?.desc };

  // EMOM 12 / EMOM 12 MIN / EMOM 12:00
  m = U.match(/^EMOM\s*(\d+):(\d+)$/);
  if (m) return { raw: t, ko: `${fmtMinSec(m[1], m[2])}간 매 분마다`, desc: formats.EMOM.desc };
  m = U.match(/^EMOM\s*(\d+)?(?:\s*MIN(?:UTE)?S?)?$/);
  if (m) return { raw: t, ko: m[1] ? `${m[1]}분간 매 분마다` : '매 분마다', desc: formats.EMOM.desc };

  // AMRAP 12 / AMRAP 12 MIN / AMRAP 16:00 / 12 MIN AMRAP
  m = U.match(/^AMRAP\s*(\d+):(\d+)$/);
  if (m) return { raw: t, ko: `${fmtMinSec(m[1], m[2])} 제한, 최대 라운드`, desc: formats.AMRAP.desc };
  m = U.match(/^AMRAP\s*(\d+)?(?:\s*MIN(?:UTE)?S?)?$/) || U.match(/^(\d+)\s*MIN(?:UTE)?S?\s*AMRAP$/);
  if (m) return { raw: t, ko: m[1] ? `${m[1]}분 제한, 최대 라운드` : '제한시간 내 최대 라운드', desc: formats.AMRAP.desc };

  // n ROUNDS FOR TIME / RFT / FOR TIME
  m = U.match(/^(\d+)\s*(?:ROUNDS?\s*)?(?:RFT|ROUNDS FOR TIME)$/);
  if (m) return { raw: t, ko: `${m[1]}라운드 시간 재기`, desc: formats.RFT.desc };
  if (/^(RFT|ROUNDS FOR TIME)$/.test(U)) return { raw: t, ko: formats.RFT.ko, desc: formats.RFT.desc };
  if (/^FOR TIME$/.test(U)) return { raw: t, ko: formats['FOR TIME'].ko, desc: formats['FOR TIME'].desc };

  // TABATA
  if (/^TABATA/.test(U)) return { raw: t, ko: formats.TABATA.ko, desc: formats.TABATA.desc };

  return null;
}

function fmtMinSec(min, sec) {
  min = parseInt(min, 10); sec = parseInt(sec, 10);
  return sec ? `${min}분 ${sec}초` : `${min}분`;
}

/** 운동 라인에서 reps/note 분리 후 movement 매칭 */
function extractItems(line, movIndex, unmatched) {
  const items = [];
  // '/' 로 여러 운동 병기 분리
  const chunks = line.split('/').map(s => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const noteMatch = chunk.match(/\(([^)]*)\)/);
    const note = noteMatch ? noteMatch[1].trim() : null;
    const repsMatch = chunk.match(/(\d+)\s*(REPS?|CAL(?:ORIES?)?|M\b|METERS?|SEC|MIN)/i);
    const reps = repsMatch ? repsMatch[0].trim() : null;

    const norm = normalize(chunk);
    let matched = null;
    for (const cand of movIndex) {
      if (wordIncludes(norm, cand.norm)) { matched = cand; break; }
    }
    if (matched) {
      items.push({ raw: chunk, reps, note, movementKey: matched.key, movement: matched.entry });
    } else if (norm && !/^\d+$/.test(norm)) {
      // 운동으로 보이나 사전에 없음 → unmatched
      unmatched.push(chunk);
      items.push({ raw: chunk, reps, note, movementKey: null, movement: null });
    }
  }
  return items;
}

/** norm 텍스트가 target(정규화 별칭)을 단어경계로 포함하는가 */
function wordIncludes(norm, target) {
  if (!target) return false;
  const re = new RegExp('(^|\\s)' + escapeRe(target) + '($|\\s)');
  return re.test(norm);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * 메인 파서.
 * @param {string} text  wodStepInfo.explanation
 * @param {object} dict  { sections, formats, movements }
 * @returns {{sections: Array, unmatched: string[]}}
 */
function parseWod(text, dict) {
  const movIndex = buildMovementIndex(dict.movements || {});
  const sectionsDict = dict.sections || {};
  const formatsDict = dict.formats || {};
  const unmatched = [];
  const out = [];

  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  let cur = null;
  const ensure = () => {
    if (!cur) { cur = { name: 'WOD', nameKo: sectionsDict.WOD || '본운동', formats: [], scheme: null, timeCap: null, items: [] }; out.push(cur); }
    return cur;
  };

  for (const line of lines) {
    const sec = matchSection(line, sectionsDict);
    if (sec) {
      cur = { name: sec.name, nameKo: sec.nameKo, formats: [], scheme: null, timeCap: null, items: [] };
      out.push(cur);
      continue;
    }

    const c = ensure();

    const tc = matchTimeCap(line);
    if (tc) { c.timeCap = tc; continue; }

    if (isRepScheme(line)) { c.scheme = line.replace(/\s/g, ''); continue; }

    const fmt = matchFormat(line, formatsDict);
    if (fmt) { c.formats.push(fmt); continue; }

    const items = extractItems(line, movIndex, unmatched);
    for (const it of items) c.items.push(it);
  }

  return { sections: out, unmatched: dedupe(unmatched) };
}

function dedupe(arr) {
  return [...new Set(arr.map(s => s.trim()).filter(Boolean))];
}

module.exports = {
  parseWod,
  normalize,
  buildMovementIndex,
  matchSection,
  matchFormat,
  matchTimeCap,
  isRepScheme,
};
