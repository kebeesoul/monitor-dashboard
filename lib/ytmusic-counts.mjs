import { parseCsv, sheetCsvUrl } from './dashboard-data.mjs';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const ALBUM_ID_PATTERN = /^MPRE[A-Za-z0-9_-]+$/;

function headerIndexes(row) {
  const headers = row.map(value => String(value).trim().toLowerCase());
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

export function parseYtmusicTargets(rows) {
  if (!rows.length) throw new Error('Links data is empty');
  const indexes = headerIndexes(rows[0]);
  const required = ['video_id', 'album_id', 'ytmusic_video_id'];
  required.forEach(name => {
    if (indexes[name] == null) throw new Error(`Links header is missing: ${name}`);
  });

  return rows.slice(1).flatMap((row, index) => {
    const videoId = String(row[indexes.video_id] || '').trim();
    const albumId = String(row[indexes.album_id] || '').trim();
    const ytmusicVideoId = String(row[indexes.ytmusic_video_id] || '').trim();
    if (!ALBUM_ID_PATTERN.test(albumId)) return [];
    if (!VIDEO_ID_PATTERN.test(videoId) || !VIDEO_ID_PATTERN.test(ytmusicVideoId)) {
      throw new Error(`Invalid YouTube Music mapping at Links row ${index + 2}`);
    }
    return [{ videoId, albumId, ytmusicVideoId }];
  });
}

function findVideoId(node) {
  if (!node || typeof node !== 'object') return '';
  if (VIDEO_ID_PATTERN.test(String(node.videoId || ''))) return String(node.videoId);
  for (const value of Object.values(node)) {
    const id = findVideoId(value);
    if (id) return id;
  }
  return '';
}

function findPlayCountText(node) {
  if (typeof node === 'string') {
    return /(?:회\s*재생|plays?|views?)$/i.test(node.trim()) ? node.trim() : '';
  }
  if (!node || typeof node !== 'object') return '';
  for (const value of Object.values(node)) {
    const text = findPlayCountText(value);
    if (text) return text;
  }
  return '';
}

export function parseYtmusicPlayCount(value) {
  const text = String(value || '').replaceAll(',', '').trim();
  let match = text.match(/([\d.]+)\s*(천|만|억)?회(?:\s*재생)?/);
  let multipliers = { '': 1, 천: 1_000, 만: 10_000, 억: 100_000_000 };
  if (!match) {
    match = text.match(/([\d.]+)\s*([KMB])?\s*(?:plays?|views?)$/i);
    multipliers = { '': 1, K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  }
  if (!match) return null;
  const number = Number(match[1]);
  const unit = String(match[2] || '').toUpperCase();
  return Number.isFinite(number) ? Math.round(number * multipliers[unit]) : null;
}

export function collectYtmusicCounts(node, targets, result) {
  if (!node || typeof node !== 'object') return;
  if (node.musicResponsiveListItemRenderer) {
    const renderer = node.musicResponsiveListItemRenderer;
    const ytmusicVideoId = findVideoId(renderer);
    const videoId = targets.get(ytmusicVideoId);
    if (videoId) {
      const count = parseYtmusicPlayCount(findPlayCountText(renderer));
      if (count != null) result[videoId] = count;
    }
    return;
  }
  Object.values(node).forEach(value => collectYtmusicCounts(value, targets, result));
}

function clientVersion(now) {
  return `1.${now.toISOString().slice(0, 10).replaceAll('-', '')}.01.00`;
}

async function fetchAlbum(albumId, targets, fetchImpl, now) {
  const response = await fetchImpl(
    'https://music.youtube.com/youtubei/v1/browse?alt=json',
    {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
        Origin: 'https://music.youtube.com',
      },
      body: JSON.stringify({
        browseId: albumId,
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: clientVersion(now),
            hl: 'ko',
            gl: 'KR',
          },
          user: {},
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`YouTube Music HTTP ${response.status}`);
  const result = {};
  collectYtmusicCounts(await response.json(), targets, result);
  return result;
}

export async function fetchYtmusicCounts(config, fetchImpl = fetch, now = new Date()) {
  const linksResponse = await fetchImpl(
    sheetCsvUrl(config, config.sheets.links),
    { cache: 'no-store', signal: AbortSignal.timeout(10_000) },
  );
  if (!linksResponse.ok) throw new Error(`Links HTTP ${linksResponse.status}`);
  const tracks = parseYtmusicTargets(parseCsv(await linksResponse.text()));
  const byAlbum = new Map();
  tracks.forEach(track => {
    if (!byAlbum.has(track.albumId)) byAlbum.set(track.albumId, new Map());
    byAlbum.get(track.albumId).set(track.ytmusicVideoId, track.videoId);
  });

  const parts = await Promise.all(
    [...byAlbum].map(([albumId, targets]) => (
      fetchAlbum(albumId, targets, fetchImpl, now)
    )),
  );
  const counts = Object.assign({}, ...parts);
  const missing = tracks
    .filter(track => !Number.isFinite(counts[track.videoId]))
    .map(track => track.videoId);
  return { counts, missing };
}
