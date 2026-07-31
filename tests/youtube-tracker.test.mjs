import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKER_PATH = join(ROOT, 'scripts', 'youtube-tracker.gs');
const SOURCE = readFileSync(TRACKER_PATH, 'utf8');
const tracker = {};

vm.createContext(tracker);
vm.runInContext(SOURCE, tracker);

test('Links rows are parsed by header name and duplicate IDs are removed', () => {
  const rows = [
    ['album_id', 'title', 'total_baseline_date', 'upload_date', 'ytmusic_video_id', 'mv_video_id', 'artist', 'video_id'],
    ['MPREb_first123', 'First title', '2026-07-31', '2026-07-01', 'ytmusic1234', 'mvfirst1234', 'First artist', 'abcdefghijk'],
    ['MPREb_duplicate', 'Duplicate title', '2026-08-01', '2026-07-02', 'duplicate12', 'mvsecond123', 'Other artist', 'abcdefghijk'],
    ['invalid', 'Invalid', '', '2026-07-03', '', '', 'Artist', 'too-short'],
    ['', 'Second title', '', '2026-07-04', '', '', 'Second artist', 'lmnopqrstuv'],
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(tracker.parseLinkRows_(rows))),
    [
      {
        video_id: 'abcdefghijk',
        artist: 'First artist',
        title: 'First title',
        upload_date: '2026-07-01',
        mv_video_id: 'mvfirst1234',
        album_id: 'MPREb_first123',
        ytmusic_video_id: 'ytmusic1234',
        total_baseline_date: '2026-07-31',
      },
      {
        video_id: 'lmnopqrstuv',
        artist: 'Second artist',
        title: 'Second title',
        upload_date: '2026-07-04',
        mv_video_id: '',
        album_id: '',
        ytmusic_video_id: '',
        total_baseline_date: '',
      },
    ],
  );
});

test('only Art Track IDs are deduplicated before YouTube Data API batching', () => {
  const tracks = [
    { video_id: 'abcdefghijk', mv_video_id: 'mvfirst1234' },
    { video_id: 'lmnopqrstuv', mv_video_id: 'mvfirst1234' },
    { video_id: 'thirdid1234', mv_video_id: '' },
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(tracker.sourceVideoIds_(tracks))),
    ['abcdefghijk', 'lmnopqrstuv', 'thirdid1234'],
  );
});

test('YouTube IDs are split into API batches of at most 50', () => {
  const ids = Array.from({ length: 101 }, (_, index) => String(index).padStart(11, '0'));
  const batches = tracker.chunk_(ids, 50);

  assert.deepEqual(JSON.parse(JSON.stringify(batches.map(batch => batch.length))), [50, 50, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(batches.flat())), ids);
});

test('YouTube Music totals are read from the fixed dashboard catalog endpoint', () => {
  let requestedUrl = '';
  tracker.UrlFetchApp = {
    fetch: url => {
      requestedUrl = url;
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          counts: { abcdefghijk: 16_380_000 },
        }),
      };
    },
  };

  const result = tracker.fetchYouTubeMusicAlbumViews_([
    { video_id: 'abcdefghijk', album_id: 'MPREb_first' },
    { video_id: 'lmnopqrstuv', album_id: '' },
  ]);

  assert.equal(requestedUrl, tracker.TRACKER_YTMUSIC_COUNTS_URL);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    abcdefghijk: 16_380_000,
  });
});

test('Matrix planning reuses today, reads the previous date, and appends new IDs', () => {
  const matrix = [
    ['title', 'video_id', '2026-07-28 00:00 (화)', '2026-07-29 00:00 (수)'],
    ['Existing title', 'abcdefghijk', '1,000 (+10)', '1,100 (+100)'],
  ];
  const tracks = [
    { video_id: 'abcdefghijk', artist: 'Artist', title: 'Existing title', upload_date: '' },
    { video_id: 'lmnopqrstuv', artist: 'Artist', title: 'New title', upload_date: '' },
  ];
  const plan = tracker.planMatrixChanges_(
    matrix,
    tracks,
    { abcdefghijk: 1200, lmnopqrstuv: 500 },
    '2026-07-29',
  );

  assert.equal(plan.todayColumn, 4);
  assert.equal(plan.createdTodayColumn, false);
  assert.equal(plan.matrixAdded, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.addedRows)), [
    ['New title', 'lmnopqrstuv'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.todayValues)), [
    ['1,200 (+200)'],
    ['500'],
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(plan.entries.map(entry => ({
      video_id: entry.video_id,
      delta: entry.delta,
      rate: entry.rate,
    })))),
    [
      { video_id: 'abcdefghijk', delta: 200, rate: 0.2 },
      { video_id: 'lmnopqrstuv', delta: 0, rate: 0 },
    ],
  );
});

test('replacing a track ID keeps the old Matrix history separate and baselines the new ID', () => {
  const matrix = [
    ['title', 'video_id', '2026-07-30 00:00 (목)', '2026-07-31 00:00 (금)'],
    ['착각', 'AMJHxEA-J8A', '1,674,650 (+2,903)', '1,679,077 (+4,427)'],
  ];
  const tracks = [
    {
      video_id: 'eS4Xbayh2jA',
      artist: '양다일',
      title: '착각',
      upload_date: '2017-12-29',
      mv_video_id: '',
    },
  ];
  const plan = tracker.planMatrixChanges_(
    matrix,
    tracks,
    { eS4Xbayh2jA: 40440000 },
    '2026-08-01',
  );

  assert.equal(plan.matrixAdded, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.addedRows)), [
    ['착각', 'eS4Xbayh2jA'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.todayValues)), [
    [''],
    ['40,440,000'],
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(plan.entries.map(entry => ({
      video_id: entry.video_id,
      delta: entry.delta,
      rate: entry.rate,
    })))),
    [{ video_id: 'eS4Xbayh2jA', delta: 0, rate: 0 }],
  );
});

test('DailyDelta planning upserts the same Korean date without adding duplicates', () => {
  const entries = [
    {
      video_id: 'abcdefghijk',
      title: 'Existing title',
      views: 1200,
      delta: 200,
      rate: 0.2,
      total_views: 2200,
      total_delta: 300,
      total_rate: 300 / 1900,
    },
    {
      video_id: 'lmnopqrstuv',
      title: 'New title',
      views: 500,
      delta: 0,
      rate: 0,
      total_views: 500,
      total_delta: 0,
      total_rate: 0,
    },
  ];
  const first = tracker.planDailyUpserts_([
    ['date', 'artist', 'video_id', 'delta', 'views', 'increase-rate', '요일', 'total_delta', 'total_views', 'total_increase-rate'],
    ['2026-07-29 0:00', 'Old title', 'abcdefghijk', 100, 1100, 0.1, '수', 200, 1900, 0.12],
  ], entries, '2026-07-29');

  assert.equal(first.updates.length, 1);
  assert.equal(first.inserts.length, 1);
  assert.equal(first.updates[0].rowNumber, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(first.inserts[0])), [
    '2026-07-29',
    'New title',
    'lmnopqrstuv',
    0,
    500,
    0,
    0,
    500,
    0,
  ]);

  const second = tracker.planDailyUpserts_([
    ['date', 'artist', 'video_id', 'delta', 'views', 'increase-rate', '요일', 'total_delta', 'total_views', 'total_increase-rate'],
    first.updates[0].values,
    first.inserts[0],
  ], entries, '2026-07-29');

  assert.equal(second.updates.length, 2);
  assert.equal(second.inserts.length, 0);
});

test('total metrics use the previous collected total and baseline new totals at zero', () => {
  const entries = [
    { video_id: 'abcdefghijk', views: 1200 },
    { video_id: 'lmnopqrstuv', views: 500 },
    { video_id: 'newalbum123', views: 600 },
  ];
  const tracks = [
    {
      video_id: 'abcdefghijk',
      album_id: 'MPREb_existing',
      total_baseline_date: '',
    },
    {
      video_id: 'lmnopqrstuv',
      album_id: '',
      total_baseline_date: '',
    },
    {
      video_id: 'newalbum123',
      album_id: 'MPREb_new',
      total_baseline_date: '2026-07-30',
    },
  ];
  const daily = [
    ['date', 'artist', 'video_id', 'delta', 'views', 'increase-rate', '요일', 'total_delta', 'total_views', 'total_increase-rate'],
    ['2026-07-29', 'Existing title', 'abcdefghijk', 100, 1100, 0.1, '수', 200, 1900, 0.12],
    ['2026-07-29', 'New album title', 'newalbum123', 50, 550, 0.1, '수', 50, 900, 0.1],
  ];

  tracker.attachTotalMetrics_(
    entries,
    tracks,
    {
      abcdefghijk: 2200,
      newalbum123: 1000,
    },
    daily,
    '2026-07-30',
  );

  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [
    {
      video_id: 'abcdefghijk',
      views: 1200,
      total_views: 2200,
      total_delta: 300,
      total_rate: 300 / 1900,
    },
    {
      video_id: 'lmnopqrstuv',
      views: 500,
      total_views: 500,
      total_delta: 0,
      total_rate: 0,
    },
    {
      video_id: 'newalbum123',
      views: 600,
      total_views: 1000,
      total_delta: 0,
      total_rate: 0,
    },
  ]);
});

test('tracker source contains no literal Google API key', () => {
  assert.doesNotMatch(SOURCE, /AIza[0-9A-Za-z_-]{20,}/);
  assert.match(SOURCE, /getProperty\(['"]YOUTUBE_API_KEY['"]\)/);
});
