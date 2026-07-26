# BNM YouTube 음원 모니터링 대시보드

공개 Google Sheet의 `DailyDelta`와 `Links`를 읽어 영상별 조회수와 추세를 보여주는 읽기 전용 웹 대시보드입니다.

## 로컬에서 HTML 보기

```bash
npm run sync
npm run dev
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:8901
```

- `npm run sync`: Google Sheet 최신 데이터를 `data.json`과 `index_standalone.html`에 저장
- `npm run dev`: 정적 HTML과 `/api/dashboard`를 함께 제공
- 종료: 실행 중인 터미널에서 `Ctrl+C`

`python3 -m http.server`도 정적 스냅샷 확인에는 사용할 수 있지만 `/api/dashboard`를 제공하지 않으므로 개발 시에는 `npm run dev`를 사용합니다.

## 데이터 규칙

단일 설정 파일은 `dashboard.config.json`입니다.

1. `DailyDelta`가 날짜·video_id·조회수의 원본입니다.
2. `Links`가 공개 영상 목록, 아티스트, 표시 제목, YouTube 업로드일의 원본입니다.
3. 두 탭에 모두 존재하는 유효한 11자 video_id만 표시합니다.
4. `DailyDelta`의 가장 이른 유효 날짜가 자동 시작일입니다.
5. 같은 영상·날짜의 중복 행은 가장 큰 조회수를 사용합니다.
6. 첫 포인트의 delta와 rate는 0이며 이후 값은 조회수 차이로 재계산합니다.
7. URL과 썸네일은 video_id로 생성합니다.

날짜를 코드에 하드코딩하거나 로컬 Excel을 원본으로 사용하지 않습니다.

## 실행 구조

```text
Browser
  -> /api/dashboard
  -> Vercel Function 또는 로컬 dev server
  -> Google Sheet DailyDelta + Links
  -> 검증·정규화된 JSON
```

Google Sheet 요청이 실패하면 API는 배포 시점의 `data.json`을 반환합니다. API 자체가 없는 단순 정적 서버에서도 `index.html`은 `data.json`으로 폴백합니다.

## 주요 명령

```bash
npm run dev      # 로컬 서버
npm run sync     # Google Sheet -> 스냅샷/standalone 생성
npm run build    # sync와 동일, Vercel 빌드용
npm test         # 데이터 규칙 테스트
```

## Vercel 배포

### 권장: Git 저장소 연결

1. 이 폴더를 GitHub, GitLab 또는 Bitbucket 저장소에 올립니다.
2. Vercel에서 **Add New Project**를 선택합니다.
3. 저장소를 Import합니다.
4. Framework Preset은 **Other**를 사용합니다.
5. Build Command는 `npm run build`로 설정합니다.
6. Production 배포 후 제공된 `*.vercel.app` 주소를 확인합니다.
7. 필요하면 Project Settings의 Domains에서 자체 도메인을 연결합니다.

Git 연결 후 브랜치와 Pull Request는 Preview Deployment로, 기본 브랜치는 Production으로 운영합니다.

### CLI 배포

```bash
npx vercel
npx vercel --prod
```

첫 명령은 Preview, 두 번째 명령은 Production 배포입니다. Production 배포는 실제 공개 URL을 변경하므로 로컬 검증 후 실행합니다.

## 공개 운영 원칙

- 공개 웹은 읽기 전용입니다.
- Google Sheet 쓰기 URL과 API 키를 브라우저에 넣지 않습니다.
- Google Sheet는 공개 읽기가 가능해야 합니다.
- API 응답은 Vercel CDN에서 5분 캐시하고 장애 시 stale 응답을 허용합니다.
- `data.json`은 마지막 정상 데이터를 제공하는 배포 스냅샷입니다.
- 새 곡 등록과 관리 기능은 별도 인증된 관리자 시스템으로 분리합니다.

## 파일 구조

```text
index.html                    공개 대시보드
index_standalone.html         내장 스냅샷 오프라인 버전
api/dashboard.mjs             Vercel 읽기 전용 API
lib/dashboard-data.mjs        데이터 파싱·검증·정규화
scripts/dev-server.mjs        로컬 HTML/API 서버
scripts/build-data.mjs        최신 스냅샷 생성
dashboard.config.json         Google Sheet 단일 설정
data.json                     장애 대응 스냅샷
vercel.json                   보안 헤더 설정
tests/data-cutoff.test.mjs    데이터 규칙 테스트
```
