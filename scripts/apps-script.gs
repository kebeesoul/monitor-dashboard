/**
 * BNM 대시보드 — 새 곡 등록 수신용 Google Apps Script
 * ------------------------------------------------------------------
 * 이 스크립트를 "구글시트에 붙여넣고 웹앱으로 배포"하면,
 * 대시보드의 [새 곡 등록] 버튼이 이 주소로 데이터를 보내 시트에 한 줄 추가합니다.
 *
 * ▣ 설치 방법 (1회, 5분)
 *  1) 대상 구글시트 열기 → 상단 메뉴 [확장 프로그램] → [Apps Script]
 *  2) 기본 코드 전부 지우고, 이 파일 내용을 통째로 붙여넣기 → 저장(💾)
 *  3) 우측 상단 [배포] → [새 배포] → 유형 [웹 앱] 선택
 *       - 설명: 아무거나 (예: BNM register)
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자"  ← 반드시 이걸로 (페이지가 로그인 없이 보내야 함)
 *  4) [배포] → 권한 승인(내 계정) → 나온 "웹 앱 URL(…/exec)" 복사
 *  5) 그 URL을 config.js 의 SHEET_WRITE_URL 따옴표 안에 붙여넣기 → 끝
 *
 * ▣ 어디에 쌓이나
 *  아래 TAB_NAME 탭(기본 'NewVideos')에 timestamp/video_id/artist/title/youtube_url 한 줄씩.
 *  탭이 없으면 자동 생성합니다. 같은 video_id는 중복 추가하지 않습니다.
 *  ※ 기존 'Links' 탭에 바로 넣고 싶으면 TAB_NAME 을 'Links' 로 바꾸세요.
 *    (Links는 헤더 이름으로 열을 찾아 쓰므로 앞 빈 열이 있어도 안전합니다.)
 */

var TAB_NAME = 'NewVideos';

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

      // 중복 검사: video_id 열 기준
      if (map.video_id != null && sh.getLastRow() > 1) {
        var col = sh.getRange(2, map.video_id + 1, sh.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < col.length; i++) {
          if (String(col[i][0]).trim() === id) return json({ ok: false, reason: 'duplicate' });
        }
      }

      // 헤더 순서 그대로 한 줄 구성 (없는 열은 빈칸)
      var width = sh.getLastColumn();
      var row = new Array(width).fill('');
      setCol(row, map, 'timestamp', new Date());
      setCol(row, map, 'video_id', id);
      setCol(row, map, 'artist', artist);
      setCol(row, map, 'title', title);
      setCol(row, map, 'youtube_url', url);
      sh.appendRow(row);

      return json({ ok: true, video_id: id });
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

function createTab(ss, name) {
  var sh = ss.insertSheet(name);
  sh.appendRow(['timestamp', 'video_id', 'artist', 'title', 'youtube_url']);
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

function setCol(row, map, key, val) {
  if (map[key] != null) row[map[key]] = val;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
