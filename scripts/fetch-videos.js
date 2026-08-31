'use strict';
/**
 * 운동별 시연 영상 수집(일회성/증분) — data/videos.json 생성.
 *
 * movements.json 의 각 운동을 YouTube 에서 검색해 videoId 후보를 뽑고,
 * oEmbed 로 실재 여부·제목·채널을 검증한 뒤 캐시한다.
 * 한 번 만들어두면 웹은 이 파일만 읽으므로 이후 YouTube 요청이 없다.
 *
 * 사용:  node scripts/fetch-videos.js [--force] [--only KEY]
 *   --force  이미 있는 항목도 다시 수집
 *   --only   특정 movementKey 만
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'videos.json');
const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'movements.json'), 'utf8'));

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 공식/신뢰 채널을 우선한다 */
const PREFERRED = [/crossfit/i, /rogue/i, /catalyst/i, /invictus/i, /gym ?shark/i];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function searchIds(query, limit = 6) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  const html = await res.text();
  const ids = [];
  for (const m of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * 영상 길이(초). 인트로·타이틀을 건너뛰고 본 동작부터 재생하기 위해 필요하다.
 * watch 페이지의 lengthSeconds 를 읽는다. 실패하면 null.
 */
async function lengthOf(id) {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    const html = await r.text();
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    return m ? parseInt(m[1], 10) : null;
  } catch { return null; }
}

/** 인트로를 지나 실제 동작이 나올 법한 시작 지점 */
function startAt(len) {
  if (!len || len < 20) return 0;
  if (len > 600) return 60;              // 긴 강의형은 1분 뒤부터
  return Math.min(Math.max(Math.round(len * 0.22), 6), 45);
}

/** oEmbed 로 실재·제목·채널·썸네일 확인. 없는 영상이면 null */
async function verify(id) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return null;
    const j = await r.json();
    return {
      id,
      title: j.title,
      author: j.author_name,
      thumb: j.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  } catch { return null; }
}

function score(v, key) {
  let s = 0;
  if (PREFERRED.some(re => re.test(v.author || ''))) s += 10;
  const t = (v.title || '').toLowerCase();
  const words = key.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  s += words.filter(w => t.includes(w)).length * 2;
  if (/how to|technique|demo|tutorial|standards/i.test(t)) s += 3;
  if (/wod|workout of the day|vlog|competition|highlight/i.test(t)) s -= 2;
  return s;
}

async function main() {
  // --force 는 "있어도 다시 수집"이지 파일 초기화가 아니다(--only 와 함께 써도 나머지 보존)
  let out = {};
  if (fs.existsSync(OUT)) {
    try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { out = {}; }
  }

  const keys = Object.keys(dict.movements).filter(k => !ONLY || k === ONLY);
  let done = 0, added = 0, failed = [];

  for (const key of keys) {
    done++;
    if (out[key] && !FORCE) continue;
    const m = dict.movements[key];
    const query = `${key} crossfit how to`;
    try {
      const ids = await searchIds(query);
      if (!ids.length) { failed.push(key); continue; }

      const verified = [];
      for (const id of ids.slice(0, 4)) {
        const v = await verify(id);
        if (v) verified.push(v);
        await sleep(120);
      }
      if (!verified.length) { failed.push(key); continue; }

      verified.sort((a, b) => score(b, key) - score(a, key));
      const best = verified[0];
      const len = await lengthOf(best.id);
      out[key] = {
        ko: m.ko,
        id: best.id,
        title: best.title,
        author: best.author,
        thumb: best.thumb,
        len: len || null,
        start: startAt(len),
        alts: verified.slice(1, 3).map(v => v.id),   // 임베드 거부 시 대체
      };
      added++;
      console.log(`[video] ${String(done).padStart(2)}/${keys.length} ${m.ko} → ${best.id} `
        + `(${best.author}${len ? `, ${len}s → ${startAt(len)}s 부터` : ''})`);
    } catch (e) {
      failed.push(key);
      console.error(`[video] ${key} 실패: ${e.message}`);
    }
    await sleep(600);   // 저빈도 유지
  }

  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`\n[video] 저장: data/videos.json · 총 ${Object.keys(out).length}개 (신규 ${added})`);
  if (failed.length) console.log(`[video] 실패 ${failed.length}개: ${failed.join(', ')}`);
}

main().catch(e => { console.error('[video] 중단:', e.message); process.exit(1); });
