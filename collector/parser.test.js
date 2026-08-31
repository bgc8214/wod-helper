'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseWod, normalize, isRepScheme, matchFormat, matchTimeCap } = require('./parser');

const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'movements.json'), 'utf8'));

// 실측: 8/31 판교 DIET/SWEAT CAMP (wodStepInfo idx 16887) 원문
const REAL_831 = [
  'WARM UP', '', "WORLD'S GREATEST", 'BAND PULL APART', 'EMPTY BAR FRONT SQUAT', '',
  'STRENGTH', '', 'EVERY 2:30 X 5 SETS', '', 'FRONT SQUAT 4 REPS (MODERATE TO HEAVY)', '',
  'METCON', '', 'FOR TIME', '', '21-18-15-12-9', '', 'PULL UP', 'WALL BALL SHOT', '',
  'TIME CAP: 16:00',
].join('\r\n');

test('normalize: 괄호/특수문자 제거·대문자화', () => {
  assert.strictEqual(normalize('Front Squat 4 reps (moderate to heavy)'), 'FRONT SQUAT 4 REPS');
  assert.strictEqual(normalize('21-18-15-12-9'), '21 18 15 12 9');
});

test('isRepScheme: 스킴 라인 판정', () => {
  assert.ok(isRepScheme('21-18-15-12-9'));
  assert.ok(isRepScheme('5-5-5-5-5'));
  assert.ok(isRepScheme('10/8/6'));
  assert.ok(!isRepScheme('PULL UP'));
  assert.ok(!isRepScheme('FRONT SQUAT 4 REPS'));
});

test('matchTimeCap: 제한시간 파싱', () => {
  assert.strictEqual(matchTimeCap('TIME CAP: 16:00').ko, '제한시간 16분');
  assert.strictEqual(matchTimeCap('TIME CAP 12 MIN').ko, '제한시간 12분');
  assert.strictEqual(matchTimeCap('PULL UP'), null);
});

test('matchFormat: 포맷 한글 변환', () => {
  assert.strictEqual(matchFormat('FOR TIME', dict.formats).ko, '시간 재기');
  assert.strictEqual(matchFormat('EVERY 2:30 X 5 SETS', dict.formats).ko, '2분 30초마다 · 5세트');
  assert.strictEqual(matchFormat('AMRAP 12', dict.formats).ko, '12분 제한, 최대 라운드');
  assert.strictEqual(matchFormat('EMOM 10', dict.formats).ko, '10분간 매 분마다');
  assert.strictEqual(matchFormat('PULL UP', dict.formats), null);
});

test('parseWod: 8/31 실측 WOD 구조', () => {
  const r = parseWod(REAL_831, dict);
  const names = r.sections.map(s => s.name);
  assert.deepStrictEqual(names, ['WARM UP', 'STRENGTH', 'METCON']);

  const [warm, strength, metcon] = r.sections;

  // WARM UP: 3개 동작, 모두 사전 매칭
  assert.strictEqual(warm.items.length, 3);
  assert.deepStrictEqual(warm.items.map(i => i.movementKey),
    ["WORLD'S GREATEST", 'BAND PULL APART', 'EMPTY BAR FRONT SQUAT']);

  // STRENGTH: EVERY 포맷 + FRONT SQUAT
  assert.strictEqual(strength.formats[0].ko, '2분 30초마다 · 5세트');
  assert.strictEqual(strength.items[0].movementKey, 'FRONT SQUAT');
  assert.strictEqual(strength.items[0].reps, '4 REPS');
  assert.strictEqual(strength.items[0].note, 'MODERATE TO HEAVY');

  // METCON: FOR TIME, 스킴, 2개 운동, 타임캡
  assert.strictEqual(metcon.formats[0].ko, '시간 재기');
  assert.strictEqual(metcon.scheme, '21-18-15-12-9');
  assert.deepStrictEqual(metcon.items.map(i => i.movementKey), ['PULL UP', 'WALL BALL SHOT']);
  assert.strictEqual(metcon.timeCap.ko, '제한시간 16분');

  // 실측 WOD는 전 용어가 사전에 있어야 한다(회귀 방지)
  assert.deepStrictEqual(r.unmatched, []);
});

test('parseWod: 한 라인 여러 운동(/) 분리', () => {
  const r = parseWod('METCON\nFOR TIME\nPULL UP / WALL BALL SHOT', dict);
  const metcon = r.sections[0];
  assert.deepStrictEqual(metcon.items.map(i => i.movementKey), ['PULL UP', 'WALL BALL SHOT']);
});

test('parseWod: 최장 별칭 우선 (EMPTY BAR FRONT SQUAT vs FRONT SQUAT)', () => {
  const r = parseWod('WARM UP\nEMPTY BAR FRONT SQUAT', dict);
  assert.strictEqual(r.sections[0].items[0].movementKey, 'EMPTY BAR FRONT SQUAT');
});

test('parseWod: 미등록 용어는 unmatched 로', () => {
  const r = parseWod('METCON\nFOR TIME\nSLED PUSH 20 M', dict);
  assert.ok(r.unmatched.includes('SLED PUSH 20 M'));
  assert.strictEqual(r.sections[0].items[0].movement, null);
});

test('parseWod: 사전 보강분 매칭 (ASSAULT BIKE → BIKE)', () => {
  const r = parseWod('METCON\nFOR TIME\nASSAULT BIKE 20 CAL', dict);
  assert.strictEqual(r.sections[0].items[0].movementKey, 'BIKE');
});

test('movements: 모든 운동에 parts/patterns 태그가 있다', () => {
  for (const [key, m] of Object.entries(dict.movements)) {
    assert.ok(Array.isArray(m.parts) && m.parts.length > 0, `${key}: parts 없음`);
    assert.ok(Array.isArray(m.patterns) && m.patterns.length > 0, `${key}: patterns 없음`);
  }
});

test('parseWod: 별칭 매칭 (C2B → CHEST TO BAR)', () => {
  const r = parseWod('METCON\nAMRAP 12\nC2B 10 REPS', dict);
  assert.strictEqual(r.sections[0].items[0].movementKey, 'CHEST TO BAR');
});
