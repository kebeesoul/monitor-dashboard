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
    const mvId = indexes.mv_video_id == null
      ? ''
      : String(row[indexes.mv_video_id] || '').trim();
    const albumId = indexes.album_id == null
      ? ''
      : String(row[indexes.album_id] || '').trim();
    const totalBaselineDate = indexes.total_baseline_date == null
      ? ''
      : String(row[indexes.total_baseline_date] || '').trim();
    if (VIDEO_ID_PATTERN.test(id) && artist && title && DATE_PATTERN.test(uploadDate)) {
      videos.set(id, {
        artist,
        title,
        uploadDate,
        mvId: VIDEO_ID_PATTERN.test(mvId) ? mvId : '',
        albumId: /^MPRE[A-Za-z0-9_-]+$/.test(albumId) ? albumId : '',
        totalBaselineDate: DATE_PATTERN.test(totalBaselineDate) ? totalBaselineDate : '',
      });
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

function numberFromCell(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function totalHistoryFromPoints(points) {
  const totals = points.filter(point => Number.isFinite(point.totalViews));
  return totals.map((point, index) => {
    const previous = index > 0 ? totals[index - 1] : null;
    const totalDelta = Number.isFinite(point.recordedTotalDelta)
      ? point.recordedTotalDelta
      : previous
        ? point.totalViews - previous.totalViews
        : 0;
    const baseline = point.totalViews - totalDelta;
    const totalRate = baseline > 0
      ? Math.round((totalDelta / baseline) * 10000) / 100
      : 0;
    return { date: point.date, totalViews: point.totalViews, totalDelta, totalRate };
  });
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
    const totalViews = indexes.total_views == null
      ? null
      : numberFromCell(row[indexes.total_views]);
    const recordedTotalDelta = indexes.total_delta == null
      ? null
      : numberFromCell(row[indexes.total_delta]);
    if (!DATE_PATTERN.test(date) || !listed.has(id) || !Number.isFinite(views)) continue;

    const key = `${id}|${date}`;
    const previous = byDay.get(key);
    if (
      !previous
      || views > previous.views
      || (views === previous.views && (totalViews ?? -Infinity) > (previous.totalViews ?? -Infinity))
    ) {
      byDay.set(key, { id, date, views, totalViews, recordedTotalDelta });
    }
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
    const totalsByDate = new Map(
      totalHistoryFromPoints(points).map(point => [point.date, point]),
    );
    const history = points.map((point, index) => {
      const previous = index > 0 ? points[index - 1] : null;
      const delta = previous ? point.views - previous.views : 0;
      const rate = previous && previous.views > 0
        ? Math.round((delta / previous.views) * 10000) / 100
        : 0;
      const historyPoint = {
        date: point.date,
        ...weekdayOf(point.date),
        views: point.views,
        delta,
        rate,
      };
      const totalPoint = totalsByDate.get(point.date);
      if (totalPoint) {
        historyPoint.totalViews = totalPoint.totalViews;
        historyPoint.totalDelta = totalPoint.totalDelta;
        historyPoint.totalRate = totalPoint.totalRate;
      }
      return historyPoint;
    });

    const video = {
      id,
      artist: metadata.artist,
      title: metadata.title,
      uploadDate: metadata.uploadDate,
      mvId: metadata.mvId || null,
      albumId: metadata.albumId || null,
      totalSource: metadata.albumId ? 'youtube_music_album' : 'video_fallback',
      url: `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      currentViews: history.at(-1).views,
      history,
    };
    const latestTotal = history.filter(point => Number.isFinite(point.totalViews)).at(-1);
    if (latestTotal) video.currentTotalViews = latestTotal.totalViews;
    videos.push(video);
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
    const totalHistory = video.history
      .filter(point => Number.isFinite(point.totalViews))
      .map(point => ({
        date: point.date,
        delta: point.totalDelta,
        rate: point.totalRate,
      }));
    if (totalHistory.length) {
      const latestTotal = totalHistory.at(-1);
      video.monitoring.latestTotalRate = latestTotal.date === dateRange.end
        ? latestTotal.rate
        : null;
      video.monitoring.totalGrowth = {
        1: growthInWindow(totalHistory, dateRange.end, 1),
        7: growthInWindow(totalHistory, dateRange.end, 7),
        30: growthInWindow(totalHistory, dateRange.end, 30),
      };
    }
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
        || (
          point.totalViews != null
          && (
            !Number.isFinite(point.totalViews)
            || !Number.isFinite(point.totalDelta)
            || !Number.isFinite(point.totalRate)
          )
        )
      ))
      || (
        video.currentTotalViews != null
        && (
          !Number.isFinite(video.currentTotalViews)
          || ![1, 7, 30].every(days => (
            Number.isFinite(video.monitoring?.totalGrowth?.[days]?.increase)
            && Number.isInteger(video.monitoring?.totalGrowth?.[days]?.observedDays)
          ))
        )
      )
    ) {
      throw new Error(`영상 모니터링 지표가 올바르지 않습니다: ${video.id || 'unknown'}`);
    }
  }
  if (JSON.stringify(data.weekdaySummary) !== JSON.stringify(buildWeekdaySummary(data.videos))) {
    throw new Error('요일별 집계가 올바르지 않습니다');
  }
  return data;
}
