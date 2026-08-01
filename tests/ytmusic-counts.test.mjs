import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectYtmusicCounts,
  fetchYtmusicCounts,
  parseYtmusicPlayCount,
  parseYtmusicTargets,
} from '../lib/ytmusic-counts.mjs';

test('Links album mappings require a canonical YouTube Music video ID', () => {
  assert.deepEqual(parseYtmusicTargets([
    ['video_id', 'album_id', 'ytmusic_video_id'],
    ['abcdefghijk', 'MPREb_first', 'canonical01'],
    ['lmnopqrstuv', '', ''],
  ]), [
    {
      videoId: 'abcdefghijk',
      albumId: 'MPREb_first',
      ytmusicVideoId: 'canonical01',
    },
  ]);
  assert.throws(
    () => parseYtmusicTargets([
      ['video_id', 'album_id', 'ytmusic_video_id'],
      ['abcdefghijk', 'MPREb_first', ''],
    ]),
    /Invalid YouTube Music mapping/,
  );
});

test('localized YouTube Music display counts convert to integer baselines', () => {
  assert.equal(parseYtmusicPlayCount('1638만회 재생'), 16_380_000);
  assert.equal(parseYtmusicPlayCount('9.4K plays'), 9_400);
  assert.equal(parseYtmusicPlayCount('1억회 재생'), 100_000_000);
});

test('album rows map canonical IDs back to Art Track IDs', () => {
  const result = {};
  collectYtmusicCounts({
    musicResponsiveListItemRenderer: {
      overlay: { watchEndpoint: { videoId: 'canonical01' } },
      flexColumns: [{ text: { runs: [{ text: '1638만회 재생' }] } }],
    },
  }, new Map([['canonical01', 'abcdefghijk']]), result);
  assert.deepEqual(result, { abcdefghijk: 16_380_000 });
});

test('catalog collection reads Links and fetches each configured album', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('docs.google.com')) {
      return new Response([
        'video_id,album_id,ytmusic_video_id',
        'abcdefghijk,MPREb_first,canonical01',
        'lmnopqrstuv,MPREb_second,canonical02',
      ].join('\n'));
    }
    const body = JSON.parse(options.body);
    const first = body.browseId === 'MPREb_first';
    return Response.json({
      musicResponsiveListItemRenderer: {
        overlay: {
          watchEndpoint: { videoId: first ? 'canonical01' : 'canonical02' },
        },
        flexColumns: [{
          text: { runs: [{ text: first ? '100만회 재생' : '2.5M plays' }] },
        }],
      },
    });
  };

  const result = await fetchYtmusicCounts({
    spreadsheetId: 'sheet-id',
    sheets: { links: 'Links' },
  }, fetchImpl, new Date('2026-07-31T00:00:00Z'));

  assert.deepEqual(result, {
    counts: {
      abcdefghijk: 1_000_000,
      lmnopqrstuv: 2_500_000,
    },
    missing: [],
  });
  assert.equal(calls.length, 3);
});

test('a missing track count returns the available catalog as a partial result', async () => {
  const fetchImpl = async (url, options) => {
    if (String(url).includes('docs.google.com')) {
      return new Response([
        'video_id,album_id,ytmusic_video_id',
        'abcdefghijk,MPREb_first,canonical01',
        'lmnopqrstuv,MPREb_first,canonical02',
      ].join('\n'));
    }
    assert.equal(JSON.parse(options.body).browseId, 'MPREb_first');
    return Response.json({
      musicResponsiveListItemRenderer: {
        overlay: { watchEndpoint: { videoId: 'canonical01' } },
        flexColumns: [{ text: { runs: [{ text: '100만회 재생' }] } }],
      },
    });
  };

  const result = await fetchYtmusicCounts({
    spreadsheetId: 'sheet-id',
    sheets: { links: 'Links' },
  }, fetchImpl, new Date('2026-07-31T00:00:00Z'));

  assert.deepEqual(result, {
    counts: { abcdefghijk: 1_000_000 },
    missing: ['lmnopqrstuv'],
  });
});

test('YouTube Music API responds 200 with counts and missing IDs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('docs.google.com')) {
      return new Response([
        'video_id,album_id,ytmusic_video_id',
        'abcdefghijk,MPREb_first,canonical01',
        'lmnopqrstuv,MPREb_first,canonical02',
      ].join('\n'));
    }
    assert.equal(JSON.parse(options.body).browseId, 'MPREb_first');
    return Response.json({
      musicResponsiveListItemRenderer: {
        overlay: { watchEndpoint: { videoId: 'canonical01' } },
        flexColumns: [{ text: { runs: [{ text: '100만회 재생' }] } }],
      },
    });
  };

  try {
    const { GET } = await import('../api/ytmusic.mjs?partial-result-test');
    const response = await GET();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.counts, { abcdefghijk: 1_000_000 });
    assert.deepEqual(body.missing, ['lmnopqrstuv']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
