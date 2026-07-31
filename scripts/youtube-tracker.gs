/**
 * YouTube view collector for the BNM monitoring spreadsheet.
 *
 * Required Script Property:
 *   YOUTUBE_API_KEY
 */

var TRACKER_TIMEZONE = 'Asia/Seoul';
var TRACKER_SHEETS = {
  links: 'Links',
  matrix: 'Matrix',
  latest: 'Latest',
  daily: 'DailyDelta',
  log: 'CollectionLog',
};
var TRACKER_LOG_HEADERS = [
  'timestamp',
  'status',
  'links_count',
  'fetched_count',
  'matrix_added',
  'daily_inserted',
  'daily_updated',
  'missing_ids',
  'error',
];

function trackYouTubeViews() {
  var lock = LockService.getScriptLock();
  var locked = false;
  var logSheet = null;
  var logged = false;
  var state = {
    timestamp: new Date(),
    status: 'failed',
    links_count: 0,
    fetched_count: 0,
    matrix_added: 0,
    daily_inserted: 0,
    daily_updated: 0,
    missing_ids: '',
    error: '',
  };

  try {
    lock.waitLock(20000);
    locked = true;

    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    logSheet = ensureCollectionLog_(spreadsheet);
    var linksSheet = requireSheet_(spreadsheet, TRACKER_SHEETS.links);
    var matrixSheet = requireSheet_(spreadsheet, TRACKER_SHEETS.matrix);
    var latestSheet = requireSheet_(spreadsheet, TRACKER_SHEETS.latest);
    var dailySheet = requireSheet_(spreadsheet, TRACKER_SHEETS.daily);
    var linkRows = linksSheet.getDataRange().getValues();
    var tracks = parseLinkRows_(linkRows);
    state.links_count = tracks.length;

    if (!tracks.length) throw new Error('Links has no valid video_id values');

    var apiKey = PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY');
    if (!apiKey) throw new Error('Missing Script Property: YOUTUBE_API_KEY');

    var ids = sourceVideoIds_(tracks);
    var viewMap = fetchYouTubeViews_(ids, apiKey);
    var albumViewMap = fetchYouTubeMusicAlbumViews_(tracks);
    var fetchedTrackCount = tracks.filter(function(track) {
      return Object.prototype.hasOwnProperty.call(viewMap, track.video_id);
    }).length;
    var missingIds = ids.filter(function(id) {
      return !Object.prototype.hasOwnProperty.call(viewMap, id);
    });
    var missingAlbumIds = tracks.filter(function(track) {
      return track.album_id
        && !Object.prototype.hasOwnProperty.call(albumViewMap, track.video_id);
    }).map(function(track) {
      return 'ytmusic:' + track.video_id;
    });
    missingIds = missingIds.concat(missingAlbumIds);
    state.fetched_count = fetchedTrackCount;
    state.missing_ids = missingIds.join(',');

    if (!fetchedTrackCount) throw new Error('YouTube API returned no requested Art Tracks');
    if (missingAlbumIds.length) {
      throw new Error('YouTube Music returned no album play count: ' + missingAlbumIds.join(','));
    }

    var todayKey = koreanDateKey_(new Date());
    var matrixPlan = applyMatrixChanges_(matrixSheet, tracks, viewMap, todayKey);
    var dailyLastRow = Math.max(1, dailySheet.getLastRow());
    var dailyLastColumn = Math.max(10, dailySheet.getLastColumn());
    var dailyValues = dailySheet.getRange(1, 1, dailyLastRow, dailyLastColumn).getValues();
    attachTotalMetrics_(matrixPlan.entries, tracks, albumViewMap, dailyValues, todayKey);
    var latestCount = writeLatest_(latestSheet, matrixPlan.entries, todayKey);
    var dailyResult = writeDailyDelta_(dailySheet, matrixPlan.entries, todayKey);

    state.matrix_added = matrixPlan.matrixAdded;
    state.daily_inserted = dailyResult.inserted;
    state.daily_updated = dailyResult.updated;
    state.status = missingIds.length ? 'partial' : 'success';

    if (latestCount !== matrixPlan.entries.length) {
      throw new Error('Latest row count does not match fetched video count');
    }

    appendCollectionLog_(logSheet, state);
    logged = true;
    return state;
  } catch (error) {
    state.status = 'failed';
    state.error = String(error && error.stack ? error.stack : error);
    if (logSheet && !logged) {
      try {
        appendCollectionLog_(logSheet, state);
      } catch (logError) {
        state.error += ' | CollectionLog: ' + String(logError);
      }
    }
    throw error;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function parseLinkRows_(rows) {
  if (!rows || !rows.length) return [];

  var map = headerMapFromRow_(rows[0]);
  var required = ['video_id', 'artist', 'title', 'upload_date'];
  required.forEach(function(name) {
    if (map[name] == null) throw new Error('Links header is missing: ' + name);
  });

  var seen = {};
  var tracks = [];
  for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    var row = rows[rowIndex];
    var id = String(row[map.video_id] || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || seen[id]) continue;
    seen[id] = true;
    tracks.push({
      video_id: id,
      artist: String(row[map.artist] || '').trim(),
      title: String(row[map.title] || '').trim(),
      upload_date: normalizeDateValue_(row[map.upload_date]),
      mv_video_id: map.mv_video_id == null
        ? ''
        : validVideoIdOrBlank_(row[map.mv_video_id]),
      album_id: map.album_id == null
        ? ''
        : validAlbumIdOrBlank_(row[map.album_id]),
      total_baseline_date: map.total_baseline_date == null
        ? ''
        : normalizeDateValue_(row[map.total_baseline_date]),
    });
  }
  return tracks;
}

function validVideoIdOrBlank_(value) {
  var id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

function validAlbumIdOrBlank_(value) {
  var id = String(value || '').trim();
  return /^MPRE[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

function sourceVideoIds_(tracks) {
  var seen = {};
  var ids = [];
  tracks.forEach(function(track) {
    var id = track.video_id;
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });
  return ids;
}

function headerMapFromRow_(headers) {
  var map = {};
  for (var index = 0; index < headers.length; index++) {
    var name = String(headers[index] || '').trim().toLowerCase();
    if (name) map[name] = index;
  }
  return map;
}

function normalizeDateValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    if (typeof Utilities !== 'undefined') {
      return Utilities.formatDate(value, TRACKER_TIMEZONE, 'yyyy-MM-dd');
    }
    return value.toISOString().slice(0, 10);
  }
  return String(value || '').trim();
}

function chunk_(items, size) {
  var chunks = [];
  for (var index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function fetchYouTubeViews_(ids, apiKey) {
  var views = {};
  var batches = chunk_(ids, 50);

  batches.forEach(function(batch) {
    var response = fetchYouTubeBatch_(batch, apiKey);
    var body = JSON.parse(response.getContentText());
    (body.items || []).forEach(function(item) {
      var value = Number(item.statistics && item.statistics.viewCount);
      if (item.id && isFinite(value)) views[item.id] = value;
    });
  });

  return views;
}

function fetchYouTubeBatch_(ids, apiKey) {
  var endpoint = 'https://www.googleapis.com/youtube/v3/videos'
    + '?part=statistics&id=' + encodeURIComponent(ids.join(','))
    + '&key=' + encodeURIComponent(apiKey);
  var lastError = null;

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var response = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
      var status = response.getResponseCode();
      if (status >= 200 && status < 300) return response;
      lastError = new Error('YouTube API HTTP ' + status);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) Utilities.sleep(attempt * 1000);
  }

  throw lastError || new Error('YouTube API request failed');
}

function fetchYouTubeMusicAlbumViews_(tracks) {
  var targetsByAlbum = {};
  tracks.forEach(function(track) {
    if (!track.album_id) return;
    if (!targetsByAlbum[track.album_id]) targetsByAlbum[track.album_id] = {};
    targetsByAlbum[track.album_id][track.video_id] = true;
  });

  var views = {};
  Object.keys(targetsByAlbum).forEach(function(albumId) {
    var response = fetchYouTubeMusicAlbum_(albumId);
    collectAlbumPlayCounts_(
      JSON.parse(response.getContentText()),
      targetsByAlbum[albumId],
      views
    );
  });
  return views;
}

function fetchYouTubeMusicAlbum_(albumId) {
  var endpoint = 'https://music.youtube.com/youtubei/v1/browse?alt=json';
  var clientVersion = '1.'
    + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMdd')
    + '.01.00';
  var payload = JSON.stringify({
    browseId: albumId,
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: clientVersion,
        hl: 'ko',
        gl: 'KR',
      },
      user: {},
    },
  });
  var lastError = null;

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { Origin: 'https://music.youtube.com' },
        payload: payload,
        muteHttpExceptions: true,
      });
      var status = response.getResponseCode();
      if (status >= 200 && status < 300) return response;
      lastError = new Error('YouTube Music HTTP ' + status + ': ' + albumId);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) Utilities.sleep(attempt * 1000);
  }

  throw lastError || new Error('YouTube Music request failed: ' + albumId);
}

function collectAlbumPlayCounts_(node, targetIds, result) {
  if (!node || typeof node !== 'object') return;
  if (node.musicResponsiveListItemRenderer) {
    var renderer = node.musicResponsiveListItemRenderer;
    var videoId = findVideoId_(renderer);
    if (videoId && targetIds[videoId]) {
      var text = findPlayCountText_(renderer);
      var count = parseYouTubeMusicPlayCount_(text);
      if (count != null) result[videoId] = count;
    }
    return;
  }
  Object.keys(node).forEach(function(key) {
    collectAlbumPlayCounts_(node[key], targetIds, result);
  });
}

function findVideoId_(node) {
  if (!node || typeof node !== 'object') return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(String(node.videoId || ''))) {
    return String(node.videoId);
  }
  var keys = Object.keys(node);
  for (var index = 0; index < keys.length; index++) {
    var id = findVideoId_(node[keys[index]]);
    if (id) return id;
  }
  return '';
}

function findPlayCountText_(node) {
  if (typeof node === 'string') {
    return /회\s*재생$/.test(node.trim()) ? node.trim() : '';
  }
  if (!node || typeof node !== 'object') return '';
  var keys = Object.keys(node);
  for (var index = 0; index < keys.length; index++) {
    var text = findPlayCountText_(node[keys[index]]);
    if (text) return text;
  }
  return '';
}

function parseYouTubeMusicPlayCount_(value) {
  var text = String(value || '').replace(/,/g, '').trim();
  var match = text.match(/([\d.]+)\s*(천|만|억)?회(?:\s*재생)?/);
  if (!match) return null;
  var number = Number(match[1]);
  if (!isFinite(number)) return null;
  var multiplier = { '': 1, '천': 1000, '만': 10000, '억': 100000000 };
  return Math.round(number * multiplier[match[2] || '']);
}

function planMatrixChanges_(matrixValues, tracks, viewMap, todayKey) {
  var rows = matrixValues.map(function(row) { return row.slice(); });
  if (!rows.length) rows = [['title', 'video_id']];
  if (!rows[0].length) rows[0] = ['title', 'video_id'];

  var header = rows[0];
  var todayIndex = findDateColumnIndex_(header, todayKey);
  var createdTodayColumn = todayIndex < 0;
  if (createdTodayColumn) todayIndex = lastNamedHeaderIndex_(header) + 1;
  var previousIndex = findPreviousDateColumnIndex_(header, todayKey);
  var idToRowIndex = {};

  for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    var matrixId = String(rows[rowIndex][1] || '').trim();
    if (matrixId && idToRowIndex[matrixId] == null) idToRowIndex[matrixId] = rowIndex;
  }

  var addedRows = [];
  var entries = [];
  tracks.forEach(function(track) {
    var currentRowIndex = idToRowIndex[track.video_id];
    if (currentRowIndex == null) {
      currentRowIndex = rows.length;
      idToRowIndex[track.video_id] = currentRowIndex;
      rows.push([track.title, track.video_id]);
      addedRows.push([track.title, track.video_id]);
    }

    if (!Object.prototype.hasOwnProperty.call(viewMap, track.video_id)) return;
    var row = rows[currentRowIndex];
    var views = Number(viewMap[track.video_id]);
    var previousViews = previousIndex < 0 ? null : parseMatrixView_(row[previousIndex]);
    var delta = previousViews == null ? 0 : views - previousViews;
    var rate = previousViews > 0 ? delta / previousViews : 0;
    row[todayIndex] = previousViews == null
      ? formatInteger_(views)
      : formatInteger_(views) + ' (' + formatSignedInteger_(delta) + ')';
    entries.push({
      video_id: track.video_id,
      artist: track.artist,
      title: track.title,
      upload_date: track.upload_date,
      views: views,
      delta: delta,
      rate: rate,
    });
  });

  return {
    todayColumn: todayIndex + 1,
    todayHeader: matrixDateHeader_(todayKey),
    createdTodayColumn: createdTodayColumn,
    previousColumn: previousIndex < 0 ? null : previousIndex + 1,
    matrixAdded: addedRows.length,
    addedRows: addedRows,
    todayValues: rows.slice(1).map(function(row) {
      return [row[todayIndex] == null ? '' : row[todayIndex]];
    }),
    entries: entries,
  };
}

function applyMatrixChanges_(sheet, tracks, viewMap, todayKey) {
  var lastRow = Math.max(1, sheet.getLastRow());
  var lastColumn = Math.max(2, sheet.getLastColumn());
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var plan = planMatrixChanges_(values, tracks, viewMap, todayKey);

  if (plan.createdTodayColumn) {
    sheet.getRange(1, plan.todayColumn).setValue(plan.todayHeader);
  }
  if (plan.addedRows.length) {
    sheet.getRange(lastRow + 1, 1, plan.addedRows.length, 2).setValues(plan.addedRows);
  }
  if (plan.todayValues.length) {
    sheet.getRange(2, plan.todayColumn, plan.todayValues.length, 1)
      .setValues(plan.todayValues);
  }
  return plan;
}

function findDateColumnIndex_(headers, dateKey) {
  for (var index = 2; index < headers.length; index++) {
    if (dateKeyFromValue_(headers[index]) === dateKey) return index;
  }
  return -1;
}

function findPreviousDateColumnIndex_(headers, todayKey) {
  var previousIndex = -1;
  var previousKey = '';
  for (var index = 2; index < headers.length; index++) {
    var key = dateKeyFromValue_(headers[index]);
    if (key && key < todayKey && key > previousKey) {
      previousKey = key;
      previousIndex = index;
    }
  }
  return previousIndex;
}

function lastNamedHeaderIndex_(headers) {
  var index = headers.length - 1;
  while (index >= 0 && String(headers[index] || '').trim() === '') index--;
  return Math.max(1, index);
}

function parseMatrixView_(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  var text = String(value || '').trim();
  if (!text) return null;
  var match = text.replace(/,/g, '').match(/^-?\d+/);
  return match ? Number(match[0]) : null;
}

function formatInteger_(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatSignedInteger_(value) {
  return (value >= 0 ? '+' : '-') + formatInteger_(Math.abs(value));
}

function matrixDateHeader_(dateKey) {
  return dateKey + ' 00:00 (' + weekdayKorean_(dateKey) + ')';
}

function attachTotalMetrics_(entries, tracks, albumViewMap, dailyValues, todayKey) {
  var trackById = {};
  tracks.forEach(function(track) { trackById[track.video_id] = track; });
  var previousTotals = previousTotalsById_(dailyValues, todayKey);

  entries.forEach(function(entry) {
    var track = trackById[entry.video_id];
    if (!track) return;
    if (
      track.album_id
      && !Object.prototype.hasOwnProperty.call(albumViewMap, entry.video_id)
    ) return;

    var totalViews = track.album_id
      ? Number(albumViewMap[entry.video_id])
      : entry.views;
    var previous = previousTotals[entry.video_id];
    var newlyMappedAlbum = track.album_id
      && previous
      && previous.totalViews === previous.views;
    var baselineToday = track.album_id
      && track.total_baseline_date === todayKey;
    var delta = previous == null || newlyMappedAlbum || baselineToday
      ? 0
      : totalViews - previous.totalViews;
    entry.total_views = totalViews;
    entry.total_delta = delta;
    entry.total_rate = previous && previous.totalViews > 0
      ? delta / previous.totalViews
      : 0;
  });
}

function previousTotalsById_(dailyValues, todayKey) {
  if (!dailyValues || !dailyValues.length) return {};
  var map = headerMapFromRow_(dailyValues[0]);
  if (
    map.date == null
    || map.video_id == null
    || map.views == null
    || map.total_views == null
  ) return {};

  var latest = {};
  for (var rowIndex = 1; rowIndex < dailyValues.length; rowIndex++) {
    var row = dailyValues[rowIndex];
    var dateKey = dateKeyFromValue_(row[map.date]);
    var id = String(row[map.video_id] || '').trim();
    var views = numericCell_(row[map.views]);
    var totalViews = numericCell_(row[map.total_views]);
    if (
      !dateKey
      || dateKey >= todayKey
      || !id
      || views == null
      || totalViews == null
    ) continue;
    if (!latest[id] || dateKey > latest[id].dateKey) {
      latest[id] = {
        dateKey: dateKey,
        views: views,
        totalViews: totalViews,
      };
    }
  }

  var totals = {};
  Object.keys(latest).forEach(function(id) {
    totals[id] = {
      views: latest[id].views,
      totalViews: latest[id].totalViews,
    };
  });
  return totals;
}

function numericCell_(value) {
  if (value == null || String(value).trim() === '') return null;
  var number = Number(String(value).replace(/,/g, ''));
  return isFinite(number) ? number : null;
}

function writeLatest_(sheet, entries, todayKey) {
  var ordered = entries.slice().sort(function(left, right) {
    var rightDelta = right.total_delta == null ? right.delta : right.total_delta;
    var leftDelta = left.total_delta == null ? left.delta : left.total_delta;
    return rightDelta - leftDelta;
  });
  var sheetDate = toSheetDate_(todayKey);
  var values = [[
    'date',
    'title',
    'video_id',
    'delta',
    'views',
    'increase-rate',
    'total_delta',
    'total_views',
    'total_increase-rate',
  ]];

  ordered.forEach(function(entry) {
    values.push([
      sheetDate,
      entry.title,
      entry.video_id,
      entry.delta,
      entry.views,
      entry.rate,
      entry.total_delta == null ? '' : entry.total_delta,
      entry.total_views == null ? '' : entry.total_views,
      entry.total_rate == null ? '' : entry.total_rate,
    ]);
  });

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  if (ordered.length) {
    sheet.getRange(2, 1, ordered.length, 1).setNumberFormat('yyyy-mm-dd h:mm');
    sheet.getRange(2, 4, ordered.length, 2).setNumberFormat('#,##0');
    sheet.getRange(2, 6, ordered.length, 1).setNumberFormat('0.00%');
    sheet.getRange(2, 7, ordered.length, 2).setNumberFormat('#,##0');
    sheet.getRange(2, 9, ordered.length, 1).setNumberFormat('0.00%');
  }
  return ordered.length;
}

function planDailyUpserts_(dailyValues, entries, todayKey) {
  var existing = {};
  for (var rowIndex = 1; rowIndex < dailyValues.length; rowIndex++) {
    var row = dailyValues[rowIndex];
    var key = dateKeyFromValue_(row[0]) + '|' + String(row[2] || '').trim();
    if (key !== '|' && existing[key] == null) existing[key] = rowIndex + 1;
  }

  var updates = [];
  var inserts = [];
  entries.forEach(function(entry) {
    var values = [
      todayKey,
      entry.title,
      entry.video_id,
      entry.delta,
      entry.views,
      entry.rate,
      entry.total_delta == null ? '' : entry.total_delta,
      entry.total_views == null ? '' : entry.total_views,
      entry.total_rate == null ? '' : entry.total_rate,
    ];
    var rowNumber = existing[todayKey + '|' + entry.video_id];
    if (rowNumber == null) {
      inserts.push(values);
    } else {
      updates.push({ rowNumber: rowNumber, values: values });
    }
  });
  return { updates: updates, inserts: inserts };
}

function writeDailyDelta_(sheet, entries, todayKey) {
  var headers = [
    'date',
    'artist',
    'video_id',
    'delta',
    'views',
    'increase-rate',
    '요일',
    'total_delta',
    'total_views',
    'total_increase-rate',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(1, 1, lastRow, headers.length).getValues();
  var plan = planDailyUpserts_(values, entries, todayKey);
  var sheetDate = toSheetDate_(todayKey);

  plan.updates.forEach(function(update) {
    var row = update.values.slice();
    row[0] = sheetDate;
    sheet.getRange(update.rowNumber, 1, 1, 6).setValues([row.slice(0, 6)]);
    sheet.getRange(update.rowNumber, 8, 1, 3).setValues([row.slice(6, 9)]);
  });
  if (plan.inserts.length) {
    var inserts = plan.inserts.map(function(row) {
      var copy = row.slice();
      copy[0] = sheetDate;
      return copy;
    });
    sheet.getRange(lastRow + 1, 1, inserts.length, 6)
      .setValues(inserts.map(function(row) { return row.slice(0, 6); }));
    sheet.getRange(lastRow + 1, 8, inserts.length, 3)
      .setValues(inserts.map(function(row) { return row.slice(6, 9); }));
  }

  var touched = plan.updates.map(function(update) { return update.rowNumber; });
  for (var index = 0; index < plan.inserts.length; index++) touched.push(lastRow + 1 + index);
  touched.forEach(function(rowNumber) {
    sheet.getRange(rowNumber, 1).setNumberFormat('yyyy-mm-dd h:mm');
    sheet.getRange(rowNumber, 4, 1, 2).setNumberFormat('#,##0');
    sheet.getRange(rowNumber, 6).setNumberFormat('0.00%');
    sheet.getRange(rowNumber, 8, 1, 2).setNumberFormat('#,##0');
    sheet.getRange(rowNumber, 10).setNumberFormat('0.00%');
  });

  return { inserted: plan.inserts.length, updated: plan.updates.length };
}

function koreanDateKey_(date) {
  return Utilities.formatDate(date, TRACKER_TIMEZONE, 'yyyy-MM-dd');
}

function dateKeyFromValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    if (typeof Utilities !== 'undefined') {
      return Utilities.formatDate(value, TRACKER_TIMEZONE, 'yyyy-MM-dd');
    }
    return value.toISOString().slice(0, 10);
  }
  var match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function weekdayKorean_(dateKey) {
  var parts = dateKey.split('-').map(Number);
  var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return ['일', '월', '화', '수', '목', '금', '토'][day];
}

function toSheetDate_(dateKey) {
  return new Date(dateKey + 'T00:00:00+09:00');
}

function requireSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function ensureCollectionLog_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(TRACKER_SHEETS.log);
  if (!sheet) sheet = spreadsheet.insertSheet(TRACKER_SHEETS.log);
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, TRACKER_LOG_HEADERS.length).setValues([TRACKER_LOG_HEADERS]);
  }
  return sheet;
}

function appendCollectionLog_(sheet, state) {
  var row = TRACKER_LOG_HEADERS.map(function(name) { return state[name]; });
  sheet.appendRow(row);
}
