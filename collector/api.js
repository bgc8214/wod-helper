'use strict';
/**
 * Stadion 백엔드 클라이언트 (방식 A / runQuery).
 * docs/api-schema.md 참고. 읽기 전용 SELECT 만 사용한다.
 */

const API_HOST = process.env.STADION_API_HOST || 'http://api.stadion.co.kr:8080';

/** 임의 SELECT 실행 → 행 배열 반환. 실패 시 throw. */
async function runQuery(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('runQuery: SELECT 문만 허용됩니다 (읽기 전용).');
  }
  const res = await fetch(`${API_HOST}/runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  // 서버는 문법 오류도 200 + "bad SQL grammar ..." 문자열로 반환 → 배열 여부로 판정
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`runQuery 실패: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`runQuery 비정상 응답: ${text.slice(0, 200)}`);
  }
  return data;
}

/** SQL 문자열 리터럴 이스케이프 (작은따옴표) */
function q(v) {
  return String(v).replace(/'/g, "''");
}

module.exports = { runQuery, q, API_HOST };
