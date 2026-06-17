# REAL STOCKEX — 가상 주식 투자 게임

## 프로젝트 구조

```
stockgame/
├── backend/
│   ├── main.py          # FastAPI 서버 (라우터, 프록시)
│   ├── models.py        # SQLAlchemy DB 모델 (User, GameState)
│   ├── database.py      # SQLite 연결 설정
│   ├── requirements.txt
│   └── .env             # API 키 보관 (git 제외)
├── frontend/
│   ├── index.html       # 로그인 UI + 게임 화면
│   ├── styles.css
│   └── script.js        # 서버 통신 전용 (API 키 없음)
└── .gitignore
```

---

## 백엔드 실행 방법

```bash
cd backend

# 가상환경 생성 및 패키지 설치
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# .env 파일에 API 키 설정 (이미 작성됨)
# SECRET_KEY, FINNHUB_KEY, TD_KEY 확인

# 서버 시작
uvicorn main:app --reload --port 8000
```

서버가 시작되면 http://localhost:8000/docs 에서 API 문서를 확인할 수 있습니다.

---

## 프론트엔드 실행 방법

`frontend/index.html`을 브라우저에서 열면 됩니다.
(로컬 파일로 직접 열거나, VS Code Live Server 등 사용)

> **주의:** `script.js` 상단의 `API_BASE`가 백엔드 주소와 일치해야 합니다.
> ```js
> const API_BASE = 'http://localhost:8000';
> ```

---

## API 엔드포인트 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/register` | 회원가입 |
| POST | `/auth/login` | 로그인 (JWT 발급) |
| GET  | `/auth/me` | 내 정보 확인 |
| GET  | `/state` | 게임 상태 불러오기 |
| POST | `/state` | 게임 상태 저장 |
| GET  | `/prices` | 실시간 주가 (Finnhub 프록시) |
| GET  | `/chart/{ticker}` | 주간 차트 (Twelve Data 프록시) |

---

## 보안 포인트

- **API 키**는 `.env`에만 저장, 프론트엔드에 절대 노출되지 않음
- **비밀번호**는 bcrypt로 해시 저장
- **JWT 토큰**으로 모든 게임 API 보호 (만료: 72시간)
- `.env`와 `*.db`는 `.gitignore`로 git 제외

---

## 배포 시 변경 사항

1. `.env`의 `SECRET_KEY`를 긴 랜덤 문자열로 교체
2. `main.py`의 `allow_origins=["*"]`를 실제 도메인으로 제한
3. `script.js`의 `API_BASE`를 실제 서버 주소로 변경
4. DB는 SQLite → PostgreSQL 교체 권장 (`database.py`의 `DATABASE_URL` 수정)
