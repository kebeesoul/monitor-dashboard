import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDashboardData,
  fetchDashboardData,
  parseCsv,
  validateDashboardData,
} from '../lib/dashboard-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINKS = [
  ['', 'video_id', 'artist', 'title', 'upload_date', 'youtube_url'],
  ['', 'abcdefghijk', 'Artist', 'Listed title', '2020-01-02', 'https://www.youtube.com/watch?v=abcdefghijk'],
];
const SECOND_ID = 'lmnopqrstuv';

function dailyRowsFromDeltas(deltas, id = 'abcdefghijk', start = '2026-07-01') {
  let views = 1000;
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  return deltas.map((delta, index) => {
    if (index > 0) views += delta;
    const date = new Date(startTime + index * 86400000).toISOString().slice(0, 10);
    return [date, 'Track', id, String(delta), String(views)];
  });
}

function buildFromDeltas(deltas, extraDailyRows = [], extraLinks = []) {
  return buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ...dailyRowsFromDeltas(deltas),
    ...extraDailyRows,
  ], [
    ...LINKS,
    ...extraLinks,
  ]);
}

test('CSV parser keeps quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('title,views\n\"A, B\",\"1,234\"\n\"A \"\"quote\"\"\",2'), [
    ['title', 'views'],
    ['A, B', '1,234'],
    ['A "quote"', '2'],
  ]);
});

test('source dates define the range without a hardcoded cutoff', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ['2026-07-21 0:00', 'Track', 'abcdefghijk', '0', '90'],
    ['2026-07-22 0:00', 'Track', 'abcdefghijk', '10', '100'],
  ], LINKS, '2026-07-22T00:00:00.000Z');

  assert.deepEqual(result.dateRange, { start: '2026-07-21', end: '2026-07-22' });
  assert.deepEqual(result.videos[0].history, [
    { date: '2026-07-21', weekday: '화', weekdayIndex: 2, views: 90, delta: 0, rate: 0 },
    { date: '2026-07-22', weekday: '수', weekdayIndex: 3, views: 100, delta: 10, rate: 11.11 },
  ]);
  assert.deepEqual(result.videos[0].monitoring, {
    asOf: '2026-07-22',
    latestRate: 11.11,
    growth: {
      1: { increase: 10, observedDays: 1 },
      7: { increase: 10, observedDays: 1 },
      30: { increase: 10, observedDays: 1 },
    },
    alerts: ['new'],
  });
});

test('Links controls visible videos, labels, and final date range', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ['2026-07-22', 'Track', 'abcdefghijk', '0', '100'],
    ['2026-07-25', 'Hidden', 'unlisted123', '0', '500'],
  ], LINKS);

  assert.deepEqual(result.dateRange, { start: '2026-07-22', end: '2026-07-22' });
  assert.deepEqual(result.videos.map(video => ({
    id: video.id,
    artist: video.artist,
    title: video.title,
    uploadDate: video.uploadDate,
  })), [
    {
      id: 'abcdefghijk',
      artist: 'Artist',
      title: 'Listed title',
      uploadDate: '2020-01-02',
    },
  ]);
});

test('Links metadata does not alter or discard DailyDelta history', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ['2026-07-21', 'Historical label', 'abcdefghijk', '0', '90'],
    ['2026-07-22', 'Historical label', 'abcdefghijk', '10', '100'],
    ['2026-07-23', 'Historical label', 'abcdefghijk', '21', '121'],
  ], LINKS);

  assert.deepEqual(result.videos[0].history, [
    { date: '2026-07-21', weekday: '화', weekdayIndex: 2, views: 90, delta: 0, rate: 0 },
    { date: '2026-07-22', weekday: '수', weekdayIndex: 3, views: 100, delta: 10, rate: 11.11 },
    { date: '2026-07-23', weekday: '목', weekdayIndex: 4, views: 121, delta: 21, rate: 21 },
  ]);
});

test('a corrected Links ID replaces the old video and starts a new frontend baseline', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ['2026-07-31', '양다일', 'AMJHxEA-J8A', '4427', '1679077'],
    ['2026-08-01', '양다일', 'eS4Xbayh2jA', '0', '40440000'],
  ], [
    ['', 'video_id', 'artist', 'title', 'upload_date', 'youtube_url'],
    ['', 'eS4Xbayh2jA', '양다일', '착각', '2017-12-29', 'https://www.youtube.com/watch?v=eS4Xbayh2jA'],
  ]);

  assert.deepEqual(result.dateRange, { start: '2026-08-01', end: '2026-08-01' });
  assert.deepEqual(result.videos.map(video => ({
    id: video.id,
    currentViews: video.currentViews,
    history: video.history,
  })), [
    {
      id: 'eS4Xbayh2jA',
      currentViews: 40440000,
      history: [
        {
          date: '2026-08-01',
          weekday: '토',
          weekdayIndex: 6,
          views: 40440000,
          delta: 0,
          rate: 0,
        },
      ],
    },
  ]);
});

test('same-day duplicates keep the highest view count', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ['2026-07-22 0:00', 'Track', 'abcdefghijk', '0', '100'],
    ['2026-07-22 12:00', 'Track', 'abcdefghijk', '0', '110'],
    ['2026-07-23 0:00', 'Track', 'abcdefghijk', '11', '121'],
  ], LINKS);

  assert.deepEqual(result.videos[0].history, [
    { date: '2026-07-22', weekday: '수', weekdayIndex: 3, views: 110, delta: 0, rate: 0 },
    { date: '2026-07-23', weekday: '목', weekdayIndex: 4, views: 121, delta: 11, rate: 10 },
  ]);
});

test('official total views begin at a zero-delta baseline without rewriting audio history', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views', 'increase-rate', '요일', 'total_delta', 'total_views', 'total_increase-rate'],
    ['2026-07-21', 'Track', 'abcdefghijk', '0', '100', '0', '화', '', '', ''],
    ['2026-07-22', 'Track', 'abcdefghijk', '10', '110', '0.1', '수', '0', '200', '0'],
    ['2026-07-23', 'Track', 'abcdefghijk', '10', '120', '0.09', '목', '25', '225', '0.125'],
  ], [
    ['', 'video_id', 'artist', 'title', 'upload_date', 'mv_video_id'],
    ['', 'abcdefghijk', 'Artist', 'Listed title', '2020-01-02', 'mvfirst1234'],
  ]);

  assert.equal(result.videos[0].mvId, 'mvfirst1234');
  assert.equal(result.videos[0].currentViews, 120);
  assert.equal(result.videos[0].currentTotalViews, 225);
  assert.deepEqual(result.videos[0].history, [
    { date: '2026-07-21', weekday: '화', weekdayIndex: 2, views: 100, delta: 0, rate: 0 },
    {
      date: '2026-07-22',
      weekday: '수',
      weekdayIndex: 3,
      views: 110,
      delta: 10,
      rate: 10,
      totalViews: 200,
      totalDelta: 0,
      totalRate: 0,
    },
    {
      date: '2026-07-23',
      weekday: '목',
      weekdayIndex: 4,
      views: 120,
      delta: 10,
      rate: 9.09,
      totalViews: 225,
      totalDelta: 25,
      totalRate: 12.5,
    },
  ]);
  assert.equal(result.videos[0].monitoring.latestTotalRate, 12.5);
  assert.deepEqual(result.videos[0].monitoring.totalGrowth, {
    1: { increase: 25, observedDays: 1 },
    7: { increase: 25, observedDays: 1 },
    30: { increase: 25, observedDays: 1 },
  });
});

test('a newly mapped official video uses the recorded zero-delta total baseline', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views', 'increase-rate', '요일', 'total_delta', 'total_views', 'total_increase-rate'],
    ['2026-07-30', 'Track', 'abcdefghijk', '10', '100', '0.1', '목', '10', '100', '0.1'],
    ['2026-07-31', 'Track', 'abcdefghijk', '10', '110', '0.1', '금', '0', '610', '0'],
  ], [
    ['', 'video_id', 'artist', 'title', 'upload_date', 'mv_video_id'],
    ['', 'abcdefghijk', 'Artist', 'Listed title', '2020-01-02', 'mvfirst1234'],
  ]);

  assert.equal(result.videos[0].currentViews, 110);
  assert.equal(result.videos[0].currentTotalViews, 610);
  assert.equal(result.videos[0].history[1].delta, 10);
  assert.equal(result.videos[0].history[1].totalDelta, 0);
  assert.equal(result.videos[0].history[1].totalRate, 0);
  assert.deepEqual(result.videos[0].monitoring.totalGrowth, {
    1: { increase: 0, observedDays: 1 },
    7: { increase: 10, observedDays: 1 },
    30: { increase: 10, observedDays: 1 },
  });
});

test('weekday summaries use Monday-first order and daily averages', () => {
  const result = buildDashboardData([
    ['date', 'artist', 'video_id', 'delta', 'views'],
    ['2026-07-20', 'Track', 'abcdefghijk', '0', '100'],
    ['2026-07-21', 'Track', 'abcdefghijk', '10', '110'],
    ['2026-07-20', 'Track', SECOND_ID, '0', '200'],
    ['2026-07-21', 'Track', SECOND_ID, '30', '230'],
  ], [
    ...LINKS,
    ['', SECOND_ID, 'Artist', 'Second title', '2020-02-03', `https://www.youtube.com/watch?v=${SECOND_ID}`],
  ]);

  assert.deepEqual(result.weekdaySummary, [
    { weekday: '월', weekdayIndex: 1, sampleCount: 2, totalDelta: 0, averageDelta: 0 },
    { weekday: '화', weekdayIndex: 2, sampleCount: 2, totalDelta: 40, averageDelta: 40 },
    { weekday: '수', weekdayIndex: 3, sampleCount: 0, totalDelta: 0, averageDelta: 0 },
    { weekday: '목', weekdayIndex: 4, sampleCount: 0, totalDelta: 0, averageDelta: 0 },
    { weekday: '금', weekdayIndex: 5, sampleCount: 0, totalDelta: 0, averageDelta: 0 },
    { weekday: '토', weekdayIndex: 6, sampleCount: 0, totalDelta: 0, averageDelta: 0 },
    { weekday: '일', weekdayIndex: 7, sampleCount: 0, totalDelta: 0, averageDelta: 0 },
  ]);
});

test('Google Sheet fetch uses the configured DailyDelta and Links tabs', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const body = url.includes('sheet=DailyDelta')
      ? 'date,artist,video_id,delta,views\n2026-07-22,Track,abcdefghijk,0,100'
      : ',video_id,artist,title,upload_date,youtube_url\n,abcdefghijk,Artist,Listed title,2020-01-02,https://www.youtube.com/watch?v=abcdefghijk';
    return new Response(body, { status: 200 });
  };

  const result = await fetchDashboardData({
    spreadsheetId: 'sheet-id',
    sheets: { daily: 'DailyDelta', links: 'Links' },
  }, fetchImpl);

  assert.equal(result.videos.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.some(url => url.includes('sheet=DailyDelta')));
  assert.ok(calls.some(url => url.includes('sheet=Links')));
});

test('generated snapshot is internally consistent', () => {
  const snapshot = validateDashboardData(
    JSON.parse(readFileSync(join(ROOT, 'data.json'), 'utf8')),
  );
  const dates = snapshot.videos.flatMap(video => video.history.map(point => point.date));

  assert.equal(snapshot.dateRange.start, dates.reduce((left, right) => left < right ? left : right));
  assert.equal(snapshot.dateRange.end, dates.reduce((left, right) => left > right ? left : right));
  assert.ok(snapshot.videos.every(video => /^[A-Za-z0-9_-]{11}$/.test(video.id)));
  assert.ok(snapshot.videos.every(video => video.artist));
  assert.ok(snapshot.videos.every(video => /^\d{4}-\d{2}-\d{2}$/.test(video.uploadDate)));
  assert.ok(snapshot.videos.every(video => video.history[0].delta === 0 && video.history[0].rate === 0));
  assert.ok(snapshot.videos.every(video => video.history.every(point => (
    /^[월화수목금토일]$/.test(point.weekday)
    && Number.isInteger(point.weekdayIndex)
  ))));
  assert.ok(snapshot.videos.every(video => video.monitoring.asOf === snapshot.dateRange.end));
  const allowedAlerts = new Set(['new', 'missing', 'spike', 'accelerating', 'decelerating']);
  assert.ok(snapshot.videos.every(video => (
    Array.isArray(video.monitoring.alerts)
    && video.monitoring.alerts.every(alert => allowedAlerts.has(alert))
  )));
  assert.deepEqual(snapshot.weekdaySummary.map(item => item.weekday), ['월', '화', '수', '목', '금', '토', '일']);
});

test('public and standalone HTML use the performance table for monitoring', () => {
  for (const filename of ['index.html', 'index_standalone.html']) {
    const html = readFileSync(join(ROOT, filename), 'utf8');

    if (filename === 'index.html') assert.match(html, /fetch\('\/api\/dashboard'/);
    assert.doesNotMatch(html, /총 누적 조회수/);
    assert.doesNotMatch(html, /최신 일일 증가율|id="rate-chart"|renderLatestRateChart|rate-chart-/);
    assert.match(html, /id="seg-growth"/);
    assert.match(html, /data-w="1"[\s\S]*data-w="7"[\s\S]*data-w="30"/);
    assert.match(html, /data-p="7" class="on" aria-pressed="true">7일<\/button>[\s\S]*data-p="30" aria-pressed="false"/);
    assert.match(html, /data-v="cum" aria-pressed="false">누적 조회수<\/button>[\s\S]*data-v="delta" class="on" aria-pressed="true">일일 증가분<\/button>/);
    assert.match(html, /data-n="abbr" aria-pressed="false">축약 \(66\.4M\)<\/button>[\s\S]*data-n="full" class="on" aria-pressed="true">전체 자리수<\/button>/);
    assert.match(html, /let numMode = 'full';[\s\S]*let period = '7';[\s\S]*let viewMode = 'delta';/);
    assert.match(html, /id="seg-status"/);
    assert.match(html, /data-status="all"[\s\S]*data-status="spike"[\s\S]*data-status="accelerating"[\s\S]*data-status="decelerating"[\s\S]*data-status="missing"[\s\S]*data-status="new"/);
    assert.match(html, /해당 상태의 영상이 없습니다/);
    assert.ok(html.indexOf('영상별 성과') < html.indexOf('조회수 추세'));
    assert.match(html, /data-sort="artist"[^>]*>아티스트<\/th>[\s\S]*data-sort="title"[^>]*>제목<\/th>[\s\S]*data-sort="uploadDate"[^>]*>발매일<\/th>/);
    assert.doesNotMatch(html, /data-sort="uploadDate"[^>]*>업로드일<\/th>/);
    assert.match(html, /let tableWindow = 1;[\s\S]*let sortKey = 'gain', sortDir = -1;/);
    assert.match(html, /data-sort="points"[^>]*>수집기간<\/th>/);
    assert.doesNotMatch(html, />포인트<\/th>/);
    assert.match(html, /각 음원을 누르면 상세한 차트내용을 확인할 수 있습니다/);
    assert.doesNotMatch(html, /표시 .*실제 관측 최대 .*행 클릭 시 차트 하이라이트 \+ 상세/);
    assert.match(html, /BNM Youtube 아트트랙 모니터링/);
    assert.doesNotMatch(html, /Designed by Kebee/);
    assert.match(html, /표시할 데이터가 없습니다/);
    assert.match(html, /const topLabel = `\$\{top\.artist\} - \$\{top\.title\}`;/);
    assert.match(html, /title="\$\{esc\(topLabel\)\}">\$\{esc\(topLabel\)\}<\/div>/);
    assert.match(html, /\$\{esc\(v\.artist\)\} - \$\{esc\(v\.title\)\} ↗<\/a>/);
    assert.match(html, />발매일 \$\{v\.uploadDate\}<\/div>/);
    assert.match(html, /<div class="k-label">최신 스크랩 날짜<\/div>/);
    assert.doesNotMatch(html, /<div class="k-sub">데이터 [\s\S]*?포인트<\/div>/);
    assert.match(html, /데이터 포인트가 1개뿐이라 추세를 계산할 수 없습니다/);
    assert.doesNotMatch(html, /id="id-input"|id="id-btn"|id="id-msg"|lookupId|extractVideoId|DATA\.videos\.slice\(0, 5\)/);
    assert.match(html, /colspan="10">해당 상태의 영상이 없습니다/);
    assert.match(html, /<title>Brand New Music - 유튜브뮤직 음원 모니터링<\/title>/);
    assert.match(html, /class="hd-title">Brand New Music - 유튜브뮤직 음원 모니터링<\/div>/);
    assert.doesNotMatch(html, /BNM YouTube 음원 모니터링/);
    assert.match(html, /<details class="panel tbl-panel weekday-panel">\s*<summary class="weekday-summary">/);
    assert.doesNotMatch(html, /<details class="panel tbl-panel weekday-panel"[^>]*\sopen(?:\s|>)/);
    assert.match(html, /id="weekday-body"/);
    assert.match(html, /data-weekday-sort="weekdayIndex"[^>]*>요일<\/th>[\s\S]*data-weekday-sort="sampleCount"[^>]*>수집 건수<\/th>/);
    assert.match(html, /let weekdaySortKey = 'weekdayIndex', weekdaySortDir = 1;/);
    assert.match(html, /function renderWeekdayTable\(\)/);
    assert.match(html, /<th>날짜<\/th><th>요일<\/th><th>조회수 전체 \(Art Track\)<\/th>/);
    assert.match(html, /class="clear-all"[^>]*>전부 취소<\/button>/);
    assert.match(html, /selectedIds\.length[\s\S]*class="clear-all"/);
    assert.match(html, /function clearAllSelections\(\)[\s\S]*selectedIds = \[\];[\s\S]*highlightId = null;/);
    assert.doesNotMatch(html, /docs\.google\.com\/spreadsheets/);
    assert.doesNotMatch(html, /DATA_START_DATE|SHEET_CSV_URL|SHEET_WRITE_URL|YT_API_KEY/);
  }
});

test('public dashboard labels total and Art Track values together', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  assert.match(html, /현재 조회수 전체 \(Art Track\)/);
  assert.match(html, /최근 \$\{tableWindow\}일 증가 전체 \(Art Track\)/);
  assert.match(html, /v\.currentTotalViews/);
  assert.match(html, /monitoring\.totalGrowth/);
  assert.match(html, /Art Track/);
});

test('latest daily rates and 1, 7, 30 day gains are available for every listed video', () => {
  const snapshot = JSON.parse(readFileSync(join(ROOT, 'data.json'), 'utf8'));
  const end = snapshot.dateRange.end;

  for (const video of snapshot.videos) {
    const latest = video.history.at(-1);
    assert.equal(latest.date, end);
    assert.equal(video.monitoring.latestRate, latest.rate);
    for (const days of [1, 7, 30]) {
      const from = new Date(new Date(end) - (days - 1) * 86400000).toISOString().slice(0, 10);
      const points = video.history
        .filter(point => point.date >= from && point.date <= end)
      const gain = points.reduce((sum, point) => sum + point.delta, 0);
      const observedDays = video.history
        .filter((point, index) => index > 0 && point.date >= from && point.date <= end)
        .length;
      assert.deepEqual(video.monitoring.growth[days], { increase: gain, observedDays });
    }
  }
});

test('a video behind the global latest date is marked missing', () => {
  const secondRows = dailyRowsFromDeltas([0, 10, 10], SECOND_ID);
  const result = buildFromDeltas([0, 10], secondRows, [
    ['', SECOND_ID, 'Artist', 'Second title', '2020-02-03', `https://www.youtube.com/watch?v=${SECOND_ID}`],
  ]);
  const missing = result.videos.find(video => video.id === 'abcdefghijk');

  assert.equal(missing.monitoring.asOf, '2026-07-03');
  assert.equal(missing.monitoring.latestRate, null);
  assert.deepEqual(missing.monitoring.growth[1], { increase: 0, observedDays: 0 });
  assert.ok(missing.monitoring.alerts.includes('missing'));
  assert.ok(missing.monitoring.alerts.includes('new'));
});

test('new videos defer spike, acceleration, and deceleration until enough points exist', () => {
  const sevenPoints = buildFromDeltas([0, 10, 10, 10, 10, 10, 100]).videos[0];
  const fourteenPoints = buildFromDeltas([
    0,
    10, 10, 10, 10, 10, 10, 10,
    20, 20, 20, 20, 20, 20,
  ]).videos[0];

  assert.deepEqual(sevenPoints.monitoring.alerts, ['new']);
  assert.ok(!fourteenPoints.monitoring.alerts.includes('accelerating'));
  assert.ok(!fourteenPoints.monitoring.alerts.includes('decelerating'));
});

test('spike starts at eight points and includes the exact two-times boundary', () => {
  const below = buildFromDeltas([0, 10, 10, 10, 10, 10, 10, 19]).videos[0];
  const boundary = buildFromDeltas([0, 10, 10, 10, 10, 10, 10, 20]).videos[0];

  assert.ok(!below.monitoring.alerts.includes('spike'));
  assert.ok(boundary.monitoring.alerts.includes('spike'));
  assert.ok(!boundary.monitoring.alerts.includes('new'));
});

test('acceleration and deceleration include the exact 20 percent boundaries', () => {
  const accelerating = buildFromDeltas([
    0,
    10, 10, 10, 10, 10, 10, 10,
    12, 12, 12, 12, 12, 12, 12,
  ]).videos[0];
  const decelerating = buildFromDeltas([
    0,
    10, 10, 10, 10, 10, 10, 10,
    8, 8, 8, 8, 8, 8, 8,
  ]).videos[0];

  assert.ok(accelerating.monitoring.alerts.includes('accelerating'));
  assert.ok(decelerating.monitoring.alerts.includes('decelerating'));
});

test('a video can have spike and acceleration alerts at the same time', () => {
  const video = buildFromDeltas([
    0,
    10, 10, 10, 10, 10, 10, 10,
    10, 10, 10, 10, 11, 11, 22,
  ]).videos[0];

  assert.ok(video.monitoring.alerts.includes('spike'));
  assert.ok(video.monitoring.alerts.includes('accelerating'));
});

test('non-positive previous seven-day growth skips acceleration and deceleration', () => {
  const video = buildFromDeltas([
    0,
    0, 0, 0, 0, 0, 0, 0,
    10, 10, 10, 10, 10, 10, 10,
  ]).videos[0];

  assert.ok(!video.monitoring.alerts.includes('accelerating'));
  assert.ok(!video.monitoring.alerts.includes('decelerating'));
});

test('API serves the deployment snapshot when Google Sheet is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const { GET } = await import('../api/dashboard.mjs?fallback-test');
    const response = await GET();
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-dashboard-fallback'), 'snapshot');
    assert.match(response.headers.get('cache-control'), /stale-if-error=86400/);
    assert.equal(data.source, 'snapshot');
    assert.equal(data.stale, true);
    assert.ok(data.videos.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
