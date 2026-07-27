const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (field || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function headerIndexes(row) {
  const headers = row.map(value => String(value).trim().toLowerCase());
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function listedVideos(rows) {
  if (!rows.length) throw new Error('Links 데이터가 비어 있습니다');
  const indexes = headerIndexes(rows[0]);
  if (
    indexes.video_id == null
    || indexes.artist == null
    || indexes.title == null
    || indexes.upload_date == null
  ) {
    throw new Error('Links 열 구조가 예상과 다릅니다');
  }

  const videos = new Map();
  for (const row of rows.slice(1)) {
    const id = String(row[indexes.video_id] || '').trim();
    const artist = String(row[indexes.artist] || '').trim();
    const title = String(row[indexes.title] || '').trim();
    const uploadDate = String(row[indexes.upload_date] || '').trim();
    if (VIDEO_ID_PATTERN.test(id) && artist && title && DATE_PATTERN.test(uploadDate)) {
      videos.set(id, { artist, title, uploadDate });
    }
  }
  if (!videos.size) throw new Error('Links에 유효한 영상 목록이 없습니다');
  return videos;
}

function dateBefore(date, days) {
  return new Date(new Date(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

function weekdayOf(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekdayIndex = day === 0 ? 7 : day;
  return { weekday: WEEKDAYS[weekdayIndex - 1], weekdayIndex };
}

function buildWeekdaySummary(videos) {
  const buckets = WEEKDAYS.map((weekday, index) => ({
    weekday,
    weekdayIndex: index + 1,
    sampleCount: 0,
    totalDelta: 0,
    dates: new Set(),
  }));

  for (const video of videos) {
    for (const point of video.history) {
      const bucket = buckets[point.weekdayIndex - 1];
      bucket.sampleCount++;
      bucket.totalDelta += point.delta;
      bucket.dates.add(point.date);
    }
  }

  return buckets.map(({ dates, ...bucket }) => ({
    ...bucket,
    averageDelta: dates.size ? Math.round(bucket.totalDelta / dates.size) : 0,
  }));
}

function growthInWindow(history, endDate, days) {
  const startDate = dateBefore(endDate, days - 1);
  let increase = 0;
  let observedDays = 0;

  history.forEach((point, index) => {
    if (point.date < startDate || point.date > endDate) return;
    increase += point.delta;
    if (index > 0) observedDays++;
  });
  return { increase, observedDays };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildMonitoring(history, asOf) {
  const latest = history.at(-1);
  const growth = {
    1: growthInWindow(history, asOf, 1),
    7: growthInWindow(history, asOf, 7),
    30: growthInWindow(history, asOf, 30),
  };
  const alerts = [];

  if (latest.date < asOf) alerts.push('missing');
  if (history.length < 8) alerts.push('new');

  if (history.length >= 8) {
    const previousDeltas = history
      .slice(Math.max(1, history.length - 8), -1)
      .map(point => point.delta);
    const baseline = median(previousDeltas);
    if (baseline > 0 && latest.delta > 0 && latest.delta >= baseline * 2) {
      alerts.push('spike');
    }
  }

  if (history.length >= 15) {
    const previousEnd = dateBefore(asOf, 7);
    const previousGrowth = growthInWindow(history, previousEnd, 7).increase;
    if (previousGrowth > 0) {
      if (growth[7].increase >= previousGrowth * 1.2) {
        alerts.push('accelerating');
      } else if (growth[7].increase <= previousGrowth * 0.8) {
        alerts.push('decelerating');
      }
    }
  }

  return {
    asOf,
    latestRate: latest.date === asOf ? latest.rate : null,
    growth,
    alerts,
  };
}

export function buildDashboardData(dailyRows, linkRows, generatedAt = new Date().toISOString()) {
  if (!dailyRows.length) throw new Error('DailyDelta 데이터가 비어 있습니다');
  const indexes = headerIndexes(dailyRows[0]);
  if (indexes.date == null || indexes.video_id == null || indexes.views == null) {
    throw new Error('DailyDelta 열 구조가 예상과 다릅니다');
  }

  const listed = listedVideos(linkRows);
  const byDay = new Map();
  for (const row of dailyRows.slice(1)) {
    const date = String(row[indexes.date] || '').trim().slice(0, 10).replace(/[./]/g, '-');
    const id = String(row[indexes.video_id] || '').trim();
    const views = Number(String(row[indexes.views] || '').replace(/,/g, ''));
    if (!DATE_PATTERN.test(date) || !listed.has(id) || !Number.isFinite(views)) continue;

    const key = `${id}|${date}`;
    const previous = byDay.get(key);
    if (!previous || views > previous.views) byDay.set(key, { id, date, views });
  }

  const byVideo = new Map();
  for (const point of byDay.values()) {
    if (!byVideo.has(point.id)) byVideo.set(point.id, []);
    byVideo.get(point.id).push(point);
  }

  const videos = [];
  for (const [id, points] of byVideo) {
    const metadata = listed.get(id);
    points.sort((left, right) => left.date.localeCompare(right.date));
    const history = points.map((point, index) => {
      const previous = index > 0 ? points[index - 1] : null;
      const delta = previous ? point.views - previous.views : 0;
      const rate = previous && previous.views > 0
        ? Math.round((delta / previous.views) * 10000) / 100
        : 0;
      return { date: point.date, ...weekdayOf(point.date), views: point.views, delta, rate };
    });

    videos.push({
      id,
      artist: metadata.artist,
      title: metadata.title,
      uploadDate: metadata.uploadDate,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      currentViews: history.at(-1).views,
      history,
    });
  }

  if (!videos.length) throw new Error('DailyDelta와 Links에 일치하는 유효 데이터가 없습니다');
  videos.sort((left, right) => right.currentViews - left.currentViews);
  const dates = videos.flatMap(video => video.history.map(point => point.date));
  const dateRange = {
    start: dates.reduce((left, right) => left < right ? left : right),
    end: dates.reduce((left, right) => left > right ? left : right),
  };
  videos.forEach(video => {
    video.monitoring = buildMonitoring(video.history, dateRange.end);
  });

  return {
    generatedAt,
    dateRange,
    weekdaySummary: buildWeekdaySummary(videos),
    videos,
  };
}

export function sheetCsvUrl(config, sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('sheet', sheetName);
  return url.toString();
}

export async function fetchDashboardData(config, fetchImpl = fetch) {
  const dailyUrl = sheetCsvUrl(config, config.sheets.daily);
  const linksUrl = sheetCsvUrl(config, config.sheets.links);
  const options = { cache: 'no-store', signal: AbortSignal.timeout(10000) };
  const [dailyResponse, linksResponse] = await Promise.all([
    fetchImpl(dailyUrl, options),
    fetchImpl(linksUrl, options),
  ]);

  if (!dailyResponse.ok || !linksResponse.ok) {
    throw new Error(`Google Sheet 응답 오류: DailyDelta ${dailyResponse.status}, Links ${linksResponse.status}`);
  }

  return buildDashboardData(
    parseCsv(await dailyResponse.text()),
    parseCsv(await linksResponse.text()),
  );
}

export function validateDashboardData(data) {
  if (!data || !Array.isArray(data.videos) || !data.videos.length) {
    throw new Error('대시보드 데이터가 비어 있습니다');
  }
  if (!data.dateRange?.start || !data.dateRange?.end) {
    throw new Error('대시보드 날짜 범위가 없습니다');
  }
  for (const video of data.videos) {
    if (
      !String(video.artist || '').trim()
      || !DATE_PATTERN.test(video.uploadDate)
      || video.monitoring?.asOf !== data.dateRange.end
      || !Array.isArray(video.monitoring?.alerts)
      || ![1, 7, 30].every(days => (
        Number.isFinite(video.monitoring?.growth?.[days]?.increase)
        && Number.isInteger(video.monitoring?.growth?.[days]?.observedDays)
      ))
      || video.history.some(point => (
        !DATE_PATTERN.test(point.date)
        || !Number.isInteger(point.weekdayIndex)
        || point.weekday !== WEEKDAYS[point.weekdayIndex - 1]
      ))
    ) {
      throw new Error(`영상 모니터링 지표가 올바르지 않습니다: ${video.id || 'unknown'}`);
    }
  }
  if (JSON.stringify(data.weekdaySummary) !== JSON.stringify(buildWeekdaySummary(data.videos))) {
    throw new Error('요일별 집계가 올바르지 않습니다');
  }
  return data;
}
