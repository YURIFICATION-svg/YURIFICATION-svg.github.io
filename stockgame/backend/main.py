"""
REAL STOCKEX — FastAPI Backend
- JWT 로그인/회원가입
- 사용자별 budget / holdings / avgCost 저장
- API 키를 서버에서만 보관하여 프론트엔드에 노출하지 않음
"""

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
import httpx, os
from datetime import datetime, timedelta
from typing import Optional
import jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from database import SessionLocal, engine
import models

# ── DB 테이블 생성 ──────────────────────────────────────────
models.Base.metadata.create_all(bind=engine)

# ── 환경 변수 ───────────────────────────────────────────────
SECRET_KEY     = os.getenv("SECRET_KEY")
FINNHUB_KEY    = os.getenv("FINNHUB_KEY")
TD_KEY         = os.getenv("TD_KEY")
ALGORITHM      = "HS256"
TOKEN_EXPIRE_H = 72   # 토큰 유효 시간 (시간)

# ── FastAPI 앱 ──────────────────────────────────────────────
app = FastAPI(title="Real StockEx API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yurification-svg.github.io"],   # 배포 시 실제 도메인으로 제한하세요
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 인증 유틸 ───────────────────────────────────────────────
pwd_ctx  = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2   = OAuth2PasswordBearer(tokenUrl="/auth/login")

def hash_pw(pw: str)   -> str:  return pwd_ctx.hash(pw)
def verify_pw(pw, h)   -> bool: return pwd_ctx.verify(pw, h)

def create_token(user_id: int) -> str:
    exp = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_H)
    return jwt.encode({"sub": str(user_id), "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)

def get_db():
    db = SessionLocal()
    try:    yield db
    finally: db.close()

def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> models.User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    user = db.query(models.User).filter(models.User.id == uid).first()
    if not user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")
    return user

# ── Pydantic 스키마 ─────────────────────────────────────────
class RegisterReq(BaseModel):
    username: str
    password: str

class SaveStateReq(BaseModel):
    budget:   float
    holdings: dict   # { "AAPL": 5, ... }
    avg_cost: dict   # { "AAPL": 182.5, ... }

# ── 인증 엔드포인트 ─────────────────────────────────────────
@app.post("/auth/register", summary="회원가입")
def register(req: RegisterReq, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == req.username).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 아이디입니다")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 4자 이상이어야 합니다")
    user = models.User(username=req.username, password_hash=hash_pw(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_token(user.id)
    return {"token": token, "username": user.username}

@app.post("/auth/login", summary="로그인")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form.username).first()
    if not user or not verify_pw(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다")
    token = create_token(user.id)
    return {"access_token": token, "token_type": "bearer", "username": user.username}

@app.get("/auth/me", summary="내 정보 확인")
def me(user: models.User = Depends(current_user)):
    return {"id": user.id, "username": user.username}

# ── 게임 상태 저장/불러오기 ─────────────────────────────────
@app.get("/state", summary="게임 상태 불러오기")
def get_state(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    state = db.query(models.GameState).filter(models.GameState.user_id == user.id).first()
    if not state:
        # 최초 로그인 시 기본값 반환
        return {"budget": 10000.0, "holdings": {}, "avg_cost": {}}
    return {"budget": state.budget, "holdings": state.holdings, "avg_cost": state.avg_cost}

@app.post("/state", summary="게임 상태 저장")
def save_state(req: SaveStateReq, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    state = db.query(models.GameState).filter(models.GameState.user_id == user.id).first()
    if state:
        state.budget   = req.budget
        state.holdings = req.holdings
        state.avg_cost = req.avg_cost
    else:
        state = models.GameState(
            user_id=user.id,
            budget=req.budget,
            holdings=req.holdings,
            avg_cost=req.avg_cost
        )
        db.add(state)
    db.commit()
    return {"ok": True}

# ── 주가 프록시 (Finnhub) ────────────────────────────────────
TICKERS = ['AAPL','NVDA','GOOG','MSFT','AMZN','AVGO','TSLA','META','BRK.B','WMT']

@app.get("/prices", summary="실시간 주가 조회 (Finnhub 프록시)")
async def get_prices(user: models.User = Depends(current_user)):
    """프론트엔드 대신 서버가 Finnhub API를 호출 → API 키 노출 없음"""
    results = {}
    errors  = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for ticker in TICKERS:
            try:
                url = f"https://finnhub.io/api/v1/quote?symbol={ticker}&token={FINNHUB_KEY}"
                r   = await client.get(url)
                d   = r.json()
                if d and isinstance(d.get("c"), (int, float)) and d["c"] != 0:
                    results[ticker] = round(d["c"], 4)
                else:
                    errors.append(ticker)
            except Exception as e:
                errors.append(f"{ticker}({e})")
    if not results:
        raise HTTPException(status_code=502, detail="모든 종목 가격 로드 실패")
    return {"prices": results, "errors": errors}

# ── 차트 프록시 (Twelve Data) ────────────────────────────────
@app.get("/chart/{ticker}", summary="주간 차트 데이터 (Twelve Data 프록시)")
async def get_chart(ticker: str, user: models.User = Depends(current_user)):
    """Twelve Data API 프록시 — API 키를 서버에서만 사용"""
    if ticker not in TICKERS:
        raise HTTPException(status_code=400, detail="지원하지 않는 종목입니다")
    url = (
        f"https://api.twelvedata.com/time_series"
        f"?symbol={ticker}&interval=1h&outputsize=168&apikey={TD_KEY}"
    )
    async with httpx.AsyncClient(timeout=15.0) as client:
        r    = await client.get(url)
        data = r.json()
    if not data or data.get("status") == "error" or not data.get("values"):
        raise HTTPException(status_code=502, detail=data.get("message", "차트 데이터 없음"))
    return data   # values 배열 그대로 전달
