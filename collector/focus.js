'use strict';
/**
 * 포커스 분석기 — 파싱된 WOD 섹션에서 "오늘 뭘 집중하는지" 를 계산한다.
 *
 * movements.json 의 parts(자극 부위)·patterns(동작 패턴) 태그를 집계한다.
 * 웜업/쿨다운/모빌리티는 본운동이 아니므로 가중치를 낮춘다.
 *
 * 순수 함수 모듈(부수효과 없음). 테스트는 focus.test.js.
 */

/** 본운동이 아닌 섹션은 낮은 가중치 */
const LIGHT_SECTIONS = new Set([
  'WARM UP', 'WARMUP', 'MOBILITY', 'COOL DOWN', 'COOLDOWN',
]);
const LIGHT_WEIGHT = 0.3;

/** 컨디셔닝 성향으로 보는 패턴 */
const CARDIO_PATTERNS = new Set(['유산소', '점프']);
/** 근력 성향으로 보는 패턴 */
const STRENGTH_PATTERNS = new Set(['스쿼트', '힌지', '올림픽', '밀기', '당기기']);

/**
 * 한 WOD(섹션 배열)의 포커스 분석.
 * @param {Array} sections parseWod 결과의 sections
 * @returns {{parts: Array, patterns: Array, summary: string|null, type: string|null, movementCount: number}}
 */
function analyzeFocus(sections) {
  const parts = new Map();
  const patterns = new Map();
  let movementCount = 0;

  for (const sec of sections || []) {
    const weight = LIGHT_SECTIONS.has(String(sec.name || '').toUpperCase())
      ? LIGHT_WEIGHT : 1;
    for (const item of sec.items || []) {
      const mv = item.movement;
      if (!mv) continue;
      movementCount++;
      for (const p of mv.parts || []) add(parts, p, weight);
      for (const p of mv.patterns || []) add(patterns, p, weight);
    }
  }

  const partList = rank(parts);
  const patternList = rank(patterns);
  return {
    parts: partList,
    patterns: patternList,
    type: classify(patternList),
    summary: summarize(partList, patternList),
    movementCount,
  };
}

/**
 * 하루치(여러 WOD)를 합산한 포커스. 카테고리별로 성격이 달라
 * 특정 WOD 하나만 보고 싶을 때는 analyzeFocus 를 개별 호출한다.
 */
function analyzeDay(wods) {
  const parts = new Map();
  const patterns = new Map();
  for (const w of wods || []) {
    for (const p of w.focus?.parts || []) add(parts, p.name, p.value);
    for (const p of w.focus?.patterns || []) add(patterns, p.name, p.value);
  }
  const partList = rank(parts);
  const patternList = rank(patterns);
  return {
    parts: partList,
    patterns: patternList,
    type: classify(patternList),
    summary: summarize(partList, patternList),
  };
}

function add(map, key, weight) {
  map.set(key, (map.get(key) || 0) + weight);
}

/** Map → [{name, value, pct}] 내림차순 */
function rank(map) {
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      value: round(value),
      pct: Math.round((value / total) * 100),
    }))
    .sort((a, b) => b.value - a.value);
}

function round(n) { return Math.round(n * 10) / 10; }

/** 근력형 / 컨디셔닝형 / 복합형 판정 */
function classify(patternList) {
  if (!patternList.length) return null;
  let cardio = 0, strength = 0;
  for (const p of patternList) {
    if (CARDIO_PATTERNS.has(p.name)) cardio += p.pct;
    if (STRENGTH_PATTERNS.has(p.name)) strength += p.pct;
  }
  if (cardio >= 45 && strength < 30) return '컨디셔닝';
  if (strength >= 55 && cardio < 20) return '근력';
  if (cardio === 0 && strength === 0) return null;
  return '복합';
}

/** "하체·어깨 중심 · 스쿼트/밀기" 형태의 한 줄 요약 */
function summarize(partList, patternList) {
  if (!partList.length) return null;
  const topParts = partList.slice(0, 2).map(p => p.name);
  const topPatterns = patternList.slice(0, 2).map(p => p.name);
  const left = topParts.join('·') + ' 중심';
  return topPatterns.length ? `${left} · ${topPatterns.join('/')}` : left;
}

module.exports = { analyzeFocus, analyzeDay };
