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
    ['title', 'upload_date', 'mv_video_id', 'artist', 'video_id'],
    ['First title', '2026-07-01', 'mvfirst1234', 'First artist', 'abcdefghijk'],
    ['Duplicate title', '2026-07-02', 'mvsecond123', 'Other artist', 'abcdefghijk'],
    ['Invalid', '2026-07-03', '', 'Artist', 'too-short'],
    ['Second title', '2026-07-04', '', 'Second artist', 'lmnopqrstuv'],
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
      },
      {
        video_id: 'lmnopqrstuv',
        artist: 'Second artist',
        title: 'Second title',
        upload_date: '2026-07-04',
        mv_video_id: '',
      },
    ],
  );
});

test('audio and official MV IDs are deduplicated before API batching', () => {
  const tracks = [
    { video_id: 'abcdefghijk', mv_video_id: 'mvfirst1234' },
    { video_id: 'lmnopqrstuv', mv_video_id: 'mvfirst1234' },
    { video_id: 'thirdid1234', mv_video_id: '' },
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(tracker.sourceVideoIds_(tracks))),
    ['abcdefghijk', 'mvfirst1234', 'lmnopqrstuv', 'thirdid1234'],
  );
});

test('YouTube IDs are split into API batches of at most 50', () => {
  const ids = Array.from({ length: 101 }, (_, index) => String(index).padStart(11, '0'));
  const batches = tracker.chunk_(ids, 50);

  assert.deepEqual(JSON.parse(JSON.stringify(batches.map(batch => batch.length))), [50, 50, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(batches.flat())), ids);
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
  ];
  const tracks = [
    { video_id: 'abcdefghijk', mv_video_id: 'mvfirst1234' },
    { video_id: 'lmnopqrstuv', mv_video_id: '' },
  ];
  const daily = [
    ['date', 'artist', 'video_id', 'delta', 'views', 'increase-rate', '요일', 'total_delta', 'total_views', 'total_increase-rate'],
    ['2026-07-29', 'Existing title', 'abcdefghijk', 100, 1100, 0.1, '수', 200, 1900, 0.12],
  ];

  tracker.attachTotalMetrics_(
    entries,
    tracks,
    { abcdefghijk: 1200, mvfirst1234: 1000, lmnopqrstuv: 500 },
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
  ]);
});

test('tracker source contains no literal Google API key', () => {
  assert.doesNotMatch(SOURCE, /AIza[0-9A-Za-z_-]{20,}/);
  assert.match(SOURCE, /getProperty\(['"]YOUTUBE_API_KEY['"]\)/);
});
