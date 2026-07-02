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
  SHEET_CSV_URL: "",
  YT_API_KEY: ""
};
