# 국가 간 조직문화 인식 조사

강의실 환경에서 30~40명 규모의 실시간 설문을 진행하기 위한 풀스택 웹앱입니다.
참가자는 모바일에서 QR로 설문에 응답하고, 강사는 16:9 모니터의 실시간 대시보드에서
응답이 들어오는 즉시 집계 결과를 확인합니다.

## 구성

| URL | 용도 | 화면 |
|---|---|---|
| `/` | 설문 페이지 | 모바일 우선, QR 링크 대상 |
| `/dashboard` | 실시간 집계 대시보드 | 1920×1080 (16:9), 강의실 모니터용 |
| `/qr` | QR 안내 화면 | 강의 시작 전 모니터에 띄워두는 안내 |

| API | 메서드 | 설명 |
|---|---|---|
| `/api/submit` | POST | 응답 저장 (JSON: `{ answers: {1..15: 1-5}, pref?: string }`) |
| `/api/results` | GET | 전체 응답 JSON |
| `/api/stream` | GET | Server-Sent Events (대시보드 자동 갱신용) |
| `/api/reset` | POST | 응답 초기화 (헤더 `x-admin-token` 필요, 자동 백업됨) |
| `/api/export` | GET | CSV 내보내기 (`?token=…`) |

## 실행

```bash
npm install
npm start
```

브라우저에서:
- 설문: <http://localhost:3000/>
- 대시보드: <http://localhost:3000/dashboard>
- QR 안내: <http://localhost:3000/qr>

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `ADMIN_TOKEN` | `admin` | `/api/reset`, `/api/export` 보호용 토큰 |
| `PUBLIC_URL` | (자동 감지) | QR 등에서 사용할 외부 도메인 |

## 강의실 운영 흐름

1. **준비** — 서버 실행 후, 모니터에 `/qr` 페이지를 띄워둡니다.
   참가자들이 QR을 스캔할 수 있도록 충분히 큰 화면에 표시.

2. **응답** — 참가자들이 모바일로 설문(`/`)에 접속해 15문항 + 선택 문항에 응답.
   제출 시 모바일에는 "응답이 제출되었습니다" 카드만 표시됩니다. (개인 결과 X)

3. **공유** — 모니터를 `/dashboard`로 전환. 새 응답이 들어올 때마다 카운트가
   살짝 튀어오르며 카테고리/선택 분포가 자동 업데이트됩니다.

4. **종료/내보내기** — 다음과 같이 CSV로 결과를 받을 수 있습니다.
   ```bash
   curl "http://localhost:3000/api/export?token=admin" -o survey-results.csv
   ```

## 대시보드 단축키

- `R` — 새로고침
- `F` — 전체화면 / 해제
- `Q` — QR 안내 페이지로 이동
- 우하단 `⌥ RESET` 버튼 — 응답 초기화 (토큰 확인 후 백업본 자동 생성)

## 데이터 저장

- 응답은 `data/responses.json`에 누적 저장됩니다.
- `/api/reset` 호출 시 `data/backup-<timestamp>.json`으로 자동 백업한 뒤 비웁니다.
- 별도 DB 없이 동작합니다. 30~40명 규모에 충분합니다.

## 배포 (개인 서버)

가장 단순한 형태:

```bash
# 서버에서
git clone <this-repo>  # 또는 파일 업로드
cd korean-org-culture-survey
npm install
PORT=3000 ADMIN_TOKEN="<강한토큰>" PUBLIC_URL="https://survey.example.com" \
  npm start
```

PM2 등으로 데몬화하고 Nginx로 HTTPS 리버스 프록시하는 것을 권장합니다.

```nginx
# /etc/nginx/sites-available/survey
server {
    listen 443 ssl http2;
    server_name survey.example.com;

    # SSL 설정 ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE를 위한 설정
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

PM2:

```bash
npm install -g pm2
pm2 start server.js --name survey -- \
  --env PORT=3000 --env ADMIN_TOKEN=mysecret
pm2 save
pm2 startup
```

## 카테고리 매핑

| Code | 영역 | 문항 |
|---|---|---|
| A | 위계성 | 1, 2, 3 |
| B | 갈등 회피 / 조화 지향 | 4, 5, 10, 12 |
| C | 수평성 / 전문성 기반 수용 | 6, 11 |
| D | 관계주의 | 7, 8, 9 |
| E | 헌신 / 일 중심성 | 13, 14, 15 |

## 파일 구조

```
.
├── server.js            # Express 서버 (SSE 포함)
├── package.json
├── README.md
├── public/
│   ├── index.html       # 설문 페이지 (참가자용)
│   ├── dashboard.html   # 실시간 집계 (16:9)
│   └── qr.html          # QR 안내 페이지
└── data/
    ├── responses.json   # 응답 저장 (자동 생성)
    └── backup-*.json    # 초기화 시 자동 백업
```
