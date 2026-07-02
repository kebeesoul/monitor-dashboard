// build-data.mjs — xlsx → data.json 변환 + index_standalone.html 생성
// 실행: node scripts/build-data.mjs
// 비개발자 참고: 이 스크립트는 data/ 폴더의 엑셀 파일을 읽어
// 대시보드가 쓰는 data.json을 만들고, 더블클릭용 index_standalone.html도 함께 갱신합니다.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 파일명에 공백/언더스코어 어느 쪽이든 자동 인식
const CANDIDATES = [
  'data/BNM_YT_View_Tracker.xlsx',
  'data/BNM YT View Tracker.xlsx',
];
const xlsxPath = CANDIDATES.map(p => join(ROOT, p)).find(existsSync);
if (!xlsxPath) {
  console.error('❌ 엑셀 파일을 찾지 못했습니다. data/ 폴더에 BNM YT View Tracker.xlsx 를 넣어주세요.');
  process.exit(1);
}
console.log(`📂 엑셀 파일 읽는 중: ${xlsxPath}`);

const wb = XLSX.readFile(xlsxPath); // raw serial 그대로 읽어 타임존 왜곡 방지

// Excel 날짜 시리얼 → 'YYYY-MM-DD' (UTC 기준, 시:분:초 버림)
function serialToDay(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const d = new Date(Math.round((serial - 25569) * 86400) * 1000);
  return d.toISOString().slice(0, 10);
}

// ── 1) DailyDelta 읽기 ───────────────────────────────────────
const sheetNames = wb.SheetNames;
if (!sheetNames.includes('DailyDelta')) {
  console.error(`❌ DailyDelta 시트가 없습니다. 현재 시트: ${sheetNames.join(', ')}`);
  process.exit(1);
}
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets['DailyDelta'], { defval: null, raw: true });

let skipped = 0;
const parsed = [];
for (const r of rawRows) {
  const day = serialToDay(r.date);
  const views = Number(r.views);
  const id = typeof r.video_id === 'string' ? r.video_id.trim() : null;
  if (!day || !id || !Number.isFinite(views)) { skipped++; continue; }
  parsed.push({
    id,
    day,
    views,
    title: typeof r.title === 'string' ? r.title.trim() : '',
    deltaOrig: Number.isFinite(Number(r.delta)) ? Number(r.delta) : null,
  });
}

// ── 2) (video_id, 일자) 중복 제거: views 최대 행만 유지 ─────────
const byKey = new Map();
for (const p of parsed) {
  const k = `${p.id}|${p.day}`;
  const prev = byKey.get(k);
  if (!prev || p.views > prev.views) byKey.set(k, p);
}
const dedupRemoved = parsed.length - byKey.size;

// ── 3) 영상별 히스토리 구성 + delta/rate 재계산 ────────────────
const byVideo = new Map();
for (const p of byKey.values()) {
  if (!byVideo.has(p.id)) byVideo.set(p.id, []);
  byVideo.get(p.id).push(p);
}

// Links: 제목 보강용으로만 사용 (URL은 신뢰하지 않음)
const linkTitles = new Map();
if (sheetNames.includes('Links')) {
  for (const l of XLSX.utils.sheet_to_json(wb.Sheets['Links'], { defval: null })) {
    if (l.video_id && l.title) linkTitles.set(String(l.video_id).trim(), String(l.title).trim());
  }
}

let totalPoints = 0;
let minDay = null, maxDay = null;
const videos = [];
for (const [id, points] of byVideo) {
  points.sort((a, b) => a.day.localeCompare(b.day));
  const history = points.map((p, i) => {
    const prev = i > 0 ? points[i - 1] : null;
    const delta = prev ? p.views - prev.views : 0;
    const rate = prev && prev.views > 0 ? Math.round((delta / prev.views) * 10000) / 100 : 0;
    return { date: p.day, views: p.views, delta, rate, deltaOrig: p.deltaOrig };
  });
  totalPoints += history.length;
  const first = history[0].date, last = history[history.length - 1].date;
  if (!minDay || first < minDay) minDay = first;
  if (!maxDay || last > maxDay) maxDay = last;

  // 제목: DailyDelta 마지막 행 우선, 비면 Links로 보강
  const lastTitle = [...points].reverse().find(p => p.title)?.title;
  const title = lastTitle || linkTitles.get(id) || id;

  videos.push({
    id,
    title,
    // 링크·썸네일은 무조건 video_id로 재구성 (Links URL 불일치 방어)
    url: `https://www.youtube.com/watch?v=${id}`,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    currentViews: history[history.length - 1].views,
    history,
  });
}
videos.sort((a, b) => b.currentViews - a.currentViews);

const data = {
  generatedAt: new Date().toISOString(),
  dateRange: { start: minDay, end: maxDay },
  videos,
};

writeFileSync(join(ROOT, 'data.json'), JSON.stringify(data), 'utf8');

// ── 4) index_standalone.html 생성 (data.json + config 인라인 임베드) ──
const indexPath = join(ROOT, 'index.html');
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, 'utf8');
  const inline = `<script>
window.DASH_CONFIG = window.DASH_CONFIG || { SHEET_CSV_URL: "", YT_API_KEY: "" };
window.EMBEDDED_DATA = ${JSON.stringify(data)};
<\/script>`;
  // config.js·데이터 fetch 대신 임베드 데이터를 쓰도록 마커 치환
  html = html.replace('<script src="config.js"></script>', inline);
  writeFileSync(join(ROOT, 'index_standalone.html'), html, 'utf8');
  console.log('🖥  index_standalone.html 생성 완료 (더블클릭으로 열 수 있는 오프라인 버전)');
} else {
  console.log('ℹ️  index.html이 아직 없어 standalone 생성은 건너뜀 (다음 빌드에서 자동 생성)');
}

// ── 5) 요약 출력 ─────────────────────────────────────────────
console.log('──────────────────────────────────────');
console.log(`✅ data.json 생성 완료`);
console.log(`   영상 ${videos.length}개 / 유효 포인트 ${totalPoints}개 / 스킵 ${skipped}개 / 중복제거 ${dedupRemoved}행`);
console.log(`   데이터 기간: ${minDay} ~ ${maxDay}`);
console.log('──────────────────────────────────────');
console.log('다음 단계: 로컬에서 보려면  npx serve .  또는  python3 -m http.server  실행 후 index.html 열기');
console.log('서버 없이 보려면 index_standalone.html 파일을 더블클릭하세요.');
