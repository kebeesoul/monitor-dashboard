/**
 * BNM 대시보드 — 새 곡 등록 수신용 Google Apps Script
 * ------------------------------------------------------------------
 * 대시보드의 [등록] 버튼이 보낸 아티스트·곡명·URL을 받아
 * 시트의 'Links' 탭 빈 행(위에서부터)에 한 줄 채웁니다.
 *
 * ▣ 설치 방법 (1회, 5분)
 *  1) 대상 구글시트 열기 → 상단 메뉴 [확장 프로그램] → [Apps Script]
 *  2) 기본 코드 전부 지우고, 이 파일 내용을 통째로 붙여넣기 → 저장(💾)
 *  3) 우측 상단 [배포] → [새 배포] → 유형 [웹 앱]
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자"  ← 반드시 (페이지가 로그인 없이 보내야 함)
 *  4) [배포] → 권한 승인 → 나온 "웹 앱 URL(…/exec)" 복사
 *  5) 그 URL을 config.js 의 SHEET_WRITE_URL 따옴표 안에 붙여넣기 → 끝
 *
 * ▣ 어디에 쌓이나
 *  아래 TAB_NAME 탭(기본 'Links')에서 헤더 이름(video_id/artist/title/youtube_url)으로
 *  열을 찾아, video_id가 비어 있는 "가장 위쪽 행"부터 채웁니다. 빈 행이 없으면 맨 아래에 추가.
 *  같은 video_id는 중복 추가하지 않습니다. (Links의 앞 빈 열이 있어도 헤더명으로 찾아 안전)
 */

var TAB_NAME = 'Links';

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var id = String(body.video_id || '').trim();
    var artist = String(body.artist || '').trim();
    var title = String(body.title || '').trim();
    var url = String(body.youtube_url || '').trim() ||
              (id ? 'https://www.youtube.com/watch?v=' + id : '');

    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ ok: false, reason: 'bad_id' });
    if (!artist || !title) return json({ ok: false, reason: 'missing_fields' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000); // 동시 등록 시 행 꼬임 방지
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(TAB_NAME) || createTab(ss, TAB_NAME);
      var map = headerMap(sh); // 헤더 이름 → 열 인덱스(0-base)
      if (map.video_id == null) return json({ ok: false, reason: 'no_video_id_column' });

      var lastRow = sh.getLastRow();
      var idColValues = lastRow > 1
        ? sh.getRange(2, map.video_id + 1, lastRow - 1, 1).getValues()
        : [];

      // 중복 검사
      for (var i = 0; i < idColValues.length; i++) {
        if (String(idColValues[i][0]).trim() === id) return json({ ok: false, reason: 'duplicate' });
      }

      // 빈 행(위에서부터) 찾기: video_id 칸이 비어 있는 첫 행
      var target = null;
      for (var j = 0; j < idColValues.length; j++) {
        if (String(idColValues[j][0]).trim() === '') { target = j + 2; break; }
      }
      if (target == null) target = lastRow + 1; // 빈 행 없으면 맨 아래

      // 헤더 열 위치에만 값 기록 (다른 열은 건드리지 않음)
      setCell(sh, target, map.video_id, id);
      if (map.artist != null) setCell(sh, target, map.artist, artist);
      if (map.title != null) setCell(sh, target, map.title, title);
      if (map.youtube_url != null) setCell(sh, target, map.youtube_url, url);

      return json({ ok: true, video_id: id, row: target });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, reason: 'error', message: String(err) });
  }
}

// 배포 확인용 — 브라우저로 …/exec 열면 상태가 보임
function doGet() {
  return json({ ok: true, service: 'BNM register', tab: TAB_NAME });
}

// TAB_NAME 탭이 없을 때만 생성 (기본 Links 헤더 형태)
function createTab(ss, name) {
  var sh = ss.insertSheet(name);
  sh.appendRow(['', 'video_id', 'artist', 'title', '', 'youtube_url']);
  return sh;
}

function headerMap(sh) {
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var map = {};
  for (var i = 0; i < head.length; i++) {
    var k = String(head[i]).trim().toLowerCase();
    if (k) map[k] = i;
  }
  return map;
}

function setCell(sh, row, colIndex0, val) {
  sh.getRange(row, colIndex0 + 1).setValue(val);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
