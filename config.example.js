// config.js — 선택 설정 (비워도 대시보드는 정상 동작합니다)
//
// [B] 구글시트 실시간 연동:
//   구글시트에서 DailyDelta 탭을 "파일 → 공유 → 웹에 게시 → CSV" 로 게시한 뒤
//   그 URL을 아래 SHEET_CSV_URL 따옴표 안에 붙여넣으세요.
//   비어 있으면 로컬 data.json을 사용합니다.
//
// [C] 유튜브 실시간 조회수:
//   YouTube Data API v3 키를 YT_API_KEY에 넣으면
//   video id 조회 시 "오늘 실시간 값"이 그래프 끝에 붙습니다.
//   키가 없어도 아무 문제 없이 동작합니다.
window.DASH_CONFIG = {
  // DailyDelta 탭을 CSV로 읽는 라이브 URL (시트가 공개돼 있어 바로 동작)
  // 시트를 고치고 대시보드를 새로고침하면 최신 데이터가 반영됩니다.
  SHEET_CSV_URL: "https://docs.google.com/spreadsheets/d/19pyGwBOSEm62tyOi5s0_zh8CwgrsIX89GhZ7J7EQMRs/gviz/tq?tqx=out:csv&sheet=DailyDelta",

  // [새 곡 등록] Apps Script 웹앱 URL. 시트에 스크립트를 배포한 뒤(README 참고)
  // 나온 "…/exec" 주소를 여기에 붙여넣으면, URL 입력 → 미등록 영상 등록이 켜집니다.
  // 비어 있으면 등록 버튼이 "URL 미설정" 안내만 띄우고 나머지는 정상 동작합니다.
  SHEET_WRITE_URL: "",

  // [C] 유튜브 실시간 조회수 + 새 곡 자동채움(제목·채널명). 키 없어도 동작.
  YT_API_KEY: ""
};
