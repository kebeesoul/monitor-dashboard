import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../dashboard.config.json' with { type: 'json' };
import { fetchDashboardData } from '../lib/dashboard-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'index.html');
const EMBED_MARKER = '<script id="embedded-data-placeholder"></script>';

function writeStandalone(data) {
  if (!existsSync(INDEX_PATH)) throw new Error('index.html을 찾지 못했습니다');
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
  const embedded = `<script>\nwindow.EMBEDDED_DATA = ${serialized};\n</script>`;
  const source = readFileSync(INDEX_PATH, 'utf8');
  if (!source.includes(EMBED_MARKER)) {
    throw new Error('index.html의 embedded-data-placeholder를 찾지 못했습니다');
  }
  writeFileSync(
    join(ROOT, 'index_standalone.html'),
    source.replace(EMBED_MARKER, embedded),
    'utf8',
  );
}

console.log('Google Sheet에서 DailyDelta와 Links를 읽는 중...');
const data = await fetchDashboardData(config);
writeFileSync(join(ROOT, 'data.json'), JSON.stringify(data), 'utf8');
writeStandalone(data);

const totalPoints = data.videos.reduce((sum, video) => sum + video.history.length, 0);
console.log(`data.json / index_standalone.html 생성 완료`);
console.log(`영상 ${data.videos.length}개 / 포인트 ${totalPoints}개`);
console.log(`기간 ${data.dateRange.start} ~ ${data.dateRange.end}`);
