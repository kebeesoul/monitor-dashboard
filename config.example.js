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
  YT_API_KEY: ""
};
