/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
const TICKERS = ['AAPL','NVDA','GOOG','MSFT','AMZN','AVGO','TSLA','META','BRK.B','WMT'];
const NAMES   = {
  AAPL:['김정훈 SHOW', '방송국'], NVDA:['아 띠BAR!','바 술집'], GOOG:['웃는 남자', '남성 전문 의류점'],
  MSFT:['내꺼 하는 법', '변호사 사무실'], AMZN:['해라 海!', '수산시장'], AVGO:['안쓰는 생활관', '부동산'],
  TSLA:['브로콜리 통', '야채 도매점'], META:['오케이, 알겠습니다!', '택배 회사'], 'BRK.B':['자꾸 니가 생각나', '결혼 전문 업체'],
  WMT:['롤모델은 아이리 칸나', '버츄얼 엔터테인먼트 회사']
};
const REFRESH_INTERVAL = 60000; // 60초
const INITIAL_BUDGET   = 10000;

// ⚠️  API 키는 모두 서버로 이동했습니다. 여기엔 백엔드 주소만 설정하세요.
const API_BASE = 'https://yurification-svggithubio-production.up.railway.app';   // 배포 시 실제 서버 주소로 변경

/* ─────────────────────────────────────────────
   AUTH STATE
───────────────────────────────────────────── */
let authToken    = localStorage.getItem('token')    || null;
let authUsername = localStorage.getItem('username') || null;

/* ─────────────────────────────────────────────
   GAME STATE
───────────────────────────────────────────── */
let budget         = INITIAL_BUDGET;
let prices         = {};
let prevPrices     = {};
let holdings       = {};
let avgCost        = {};
let selectedTicker = null;
let refreshTimer   = null;
let countdown      = REFRESH_INTERVAL / 1000;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const $   = id => document.getElementById(id);
const fmt      = n => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtShort = n => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const ts  = () => {
  const d = new Date();
  return [d.getHours(),d.getMinutes(),d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
};

function toast(msg, type='ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', 2600);
}

function addLog(msg, type='sys') {
  const log = $('tradeLog');
  if (!log) return;
  const el = document.createElement('div');
  el.className = 'log-entry ' + type;
  el.innerHTML = `<span class="log-time">${ts()}</span><span class="log-msg">${msg}</span>`;
  log.prepend(el);
  while (log.children.length > 80) log.removeChild(log.lastChild);
}

function setStatus(state) {
  const dot  = $('statusDot');
  const text = $('statusText');
  if (!dot || !text) return;
  dot.className = 'dot ' + state;
  if (state === 'live')    text.textContent = '실시간 연결됨';
  if (state === 'loading') text.textContent = '가격 갱신 중...';
  if (state === 'error')   text.textContent = '연결 오류';
}

// 인증 헤더
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

/* ─────────────────────────────────────────────
   AUTH SCREEN LOGIC
───────────────────────────────────────────── */
function switchTab(tab) {
  $('tabLogin').classList.toggle('active',    tab === 'login');
  $('tabRegister').classList.toggle('active', tab === 'register');
  $('formLogin').style.display    = tab === 'login'    ? '' : 'none';
  $('formRegister').style.display = tab === 'register' ? '' : 'none';
}

async function doLogin() {
  const user = $('loginUser').value.trim();
  const pass = $('loginPass').value;
  $('loginErr').textContent = '';
  if (!user || !pass) { $('loginErr').textContent = '아이디와 비밀번호를 입력하세요'; return; }

  try {
    // OAuth2 폼 형식으로 전송
    const body = new URLSearchParams({ username: user, password: pass });
    const res  = await fetch(`${API_BASE}/auth/login`, { method:'POST', body });
    const data = await res.json();
    if (!res.ok) { $('loginErr').textContent = data.detail || '로그인 실패'; return; }

    authToken    = data.access_token;
    authUsername = data.username;
    localStorage.setItem('token',    authToken);
    localStorage.setItem('username', authUsername);
    startGame();
  } catch(e) {
    $('loginErr').textContent = '서버 연결 실패 — 서버가 실행 중인지 확인하세요';
  }
}

async function doRegister() {
  const user = $('regUser').value.trim();
  const pass = $('regPass').value;
  $('regErr').textContent = '';
  if (user.length < 4) { $('regErr').textContent = '아이디는 4자 이상이어야 합니다'; return; }
  if (pass.length < 4) { $('regErr').textContent = '비밀번호는 4자 이상이어야 합니다'; return; }

  try {
    const res  = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (!res.ok) { $('regErr').textContent = data.detail || '회원가입 실패'; return; }

    authToken    = data.token;
    authUsername = data.username;
    localStorage.setItem('token',    authToken);
    localStorage.setItem('username', authUsername);
    startGame();
  } catch(e) {
    $('regErr').textContent = '서버 연결 실패 — 서버가 실행 중인지 확인하세요';
  }
}

function doLogout() {
  authToken = null; authUsername = null;
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  // 상태 초기화
  budget = INITIAL_BUDGET; prices = {}; prevPrices = {}; holdings = {}; avgCost = {};
  selectedTicker = null;
  clearInterval(refreshTimer);
  $('gameScreen').style.display = 'none';
  $('authScreen').style.display = 'flex';
}

// Enter 키 지원
document.addEventListener('DOMContentLoaded', () => {
  ['loginUser','loginPass'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  });
  ['regUser','regPass'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); });
  });
  $('inputQty').addEventListener('input', updateSelectedInfo);

  // 이미 로그인된 경우 바로 게임 시작
  if (authToken) {
    startGame();
  }
});

/* ─────────────────────────────────────────────
   GAME START (로그인 후 호출)
───────────────────────────────────────────── */
async function startGame() {
  $('authScreen').style.display = 'none';
  $('gameScreen').style.display = 'block';
  if ($('headerUser')) $('headerUser').textContent = authUsername || '';

  addLog(`${authUsername} — 게임 데이터 불러오는 중...`, 'sys');

  // 서버에서 저장된 상태 불러오기
  await loadState();

  // 가격 조회 후 렌더
  addLog('REAL STOCKEX 시작 (서버 프록시)', 'sys');
  fetchPrices().then(ok => {
    render();
    if (ok) addLog('가격 로드 완료 — 자동 갱신 시작 (1분 간격)', 'sys');
    startCountdown();
  });
}

/* ─────────────────────────────────────────────
   SERVER: 상태 불러오기 / 저장
───────────────────────────────────────────── */
async function loadState() {
  try {
    const res  = await fetch(`${API_BASE}/state`, { headers: authHeaders() });
    if (res.status === 401) { doLogout(); return; }
    const data = await res.json();
    budget   = data.budget   ?? INITIAL_BUDGET;
    holdings = data.holdings ?? {};
    avgCost  = data.avg_cost ?? {};
    addLog(`저장된 게임 상태 불러오기 완료`, 'sys');
  } catch(e) {
    addLog('상태 불러오기 실패 — 기본값으로 시작', 'err');
  }
}

async function saveState() {
  try {
    await fetch(`${API_BASE}/state`, {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ budget, holdings, avg_cost: avgCost })
    });
  } catch(e) {
    addLog('상태 저장 실패', 'err');
  }
}

/* ─────────────────────────────────────────────
   FETCH PRICES — 서버 프록시 사용 (API 키 없음)
───────────────────────────────────────────── */
async function fetchPrices() {
  setStatus('loading');
  try {
    const res = await fetch(`${API_BASE}/prices`, { headers: authHeaders() });
    if (res.status === 401) { doLogout(); return false; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.errors && data.errors.length)
      addLog(`일부 누락: ${data.errors.join(', ')}`, 'err');

    prevPrices = { ...prices };
    prices     = data.prices;
    setStatus('live');
    addLog(`가격 갱신 완료 (${Object.keys(prices).length}개 종목)`, 'sys');
    return true;
  } catch(err) {
    setStatus('error');
    addLog(`가격 갱신 실패: ${err.message}`, 'err');
    toast('가격 갱신 실패 — 서버를 확인하세요', 'bad');
    return false;
  }
}

/* ─────────────────────────────────────────────
   RENDER
───────────────────────────────────────────── */
function render() {
  $('headerBudget').textContent = fmt(budget);
  $('statCash').textContent     = fmtShort(budget);

  let assetVal = 0;
  for (const [t, qty] of Object.entries(holdings)) {
    if (qty > 0 && prices[t]) assetVal += qty * prices[t];
  }

  const total = budget + assetVal;
  const pnl   = total - INITIAL_BUDGET;

  $('statAsset').textContent = fmtShort(assetVal);
  $('statTotal').textContent = fmtShort(total);
  const pnlEl = $('statPnL');
  pnlEl.textContent = (pnl >= 0 ? '+' : '') + fmt(pnl);
  pnlEl.style.color = pnl > 0 ? 'var(--accent2)' : pnl < 0 ? 'var(--danger)' : 'var(--text-dim)';

  // table
  const tbody = $('stockTable');
  tbody.innerHTML = '';

  for (const t of TICKERS) {
    const price = prices[t];
    const prev  = prevPrices[t] || price;
    const qty   = holdings[t] || 0;
    if (!price) continue;

    const diff     = price - prev;
    const pct      = prev ? (diff / prev * 100).toFixed(2) : '0.00';
    const chgClass = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const sign     = diff > 0 ? '+' : '';
    const holdVal  = qty * price;

    const tr = document.createElement('tr');
    tr.id = `row-${t}`;
    if (t === selectedTicker) tr.classList.add('selected');
    tr.onclick = () => selectTicker(t);
    tr.innerHTML = `
      <td>
        <div class="ticker-badge">${NAMES[t][0]}</div>
        <div class="company-name">${NAMES[t][1]}</div>
      </td>
      <td class="r"><div class="price-val" id="pv-${t}">${fmt(price)}</div></td>
      <td class="r">
        <button class="chg-badge ${chgClass}" onclick="event.stopPropagation();openChart('${t}')" title="주간 차트 보기">
          ${sign}${diff.toFixed(2)} (${sign}${pct}%) <span style="font-size:10px;opacity:0.7;">📈</span>
        </button>
      </td>
      <td class="r"><div class="hold-qty ${qty===0?'zero':''}">${qty > 0 ? qty+'주' : '—'}</div></td>
      <td class="r"><div class="hold-val">${qty > 0 ? fmt(holdVal) : '—'}</div></td>
    `;
    tbody.appendChild(tr);
  }

  // flash changed rows
  for (const t of TICKERS) {
    if (!prevPrices[t] || !prices[t]) continue;
    const d = prices[t] - prevPrices[t];
    if (d === 0) continue;
    const row = $(`row-${t}`);
    if (!row) continue;
    row.classList.remove('row-up','row-down');
    void row.offsetWidth;
    row.classList.add(d > 0 ? 'row-up' : 'row-down');
    const pv = $(`pv-${t}`);
    if (pv) {
      pv.classList.remove('flash-up','flash-down');
      void pv.offsetWidth;
      pv.classList.add(d > 0 ? 'flash-up' : 'flash-down');
      setTimeout(() => pv.classList.remove('flash-up','flash-down'), 1000);
    }
  }

  updateSelectedInfo();

  const hasHoldings = Object.values(holdings).some(q => q > 0);
  $('holdingsPanel').style.display = hasHoldings ? 'block' : 'none';

  if (hasHoldings) {
    const list = $('holdingList');
    list.innerHTML = '';
    for (const [t, qty] of Object.entries(holdings)) {
      if (!qty) continue;
      const val  = qty * (prices[t] || 0);
      const avg  = avgCost[t] || 0;
      const pnlH = val - avg * qty;
      const el   = document.createElement('div');
      el.className = 'holding-item';
      el.innerHTML = `
        <span class="hi-ticker">${NAMES[t][0]}</span>
        <span class="hi-qty">${qty}주</span>
        <span class="hi-val" style="color:${pnlH>=0?'var(--accent2)':'var(--danger)'}">${fmt(val)}</span>
      `;
      list.appendChild(el);
    }
  }
}

function updateSelectedInfo() {
  const t  = selectedTicker;
  const si = $('selectedInfo');
  const cp = $('costPreview');
  if (!si || !cp) return;

  if (!t || !prices[t]) {
    si.innerHTML = `<div style="color:var(--text-muted);font-size:12px;font-family:'Share Tech Mono',monospace;padding:10px 0;">테이블에서 종목을 선택하세요</div>`;
    cp.innerHTML = '&nbsp;';
    return;
  }

  const price = prices[t];
  const prev  = prevPrices[t] || price;
  const diff  = price - prev;
  const pct   = prev ? (diff / prev * 100).toFixed(2) : '0.00';
  const sign  = diff >= 0 ? '+' : '';
  const clr   = diff > 0 ? 'var(--accent2)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)';

  si.innerHTML = `
    <div class="sel-name">${NAMES[t][1]}</div>
    <div class="sel-ticker">${NAMES[t][0]}</div>
    <div class="sel-price">${fmt(price)}</div>
    <div class="sel-chg" style="color:${clr}">${sign}${diff.toFixed(2)} (${sign}${pct}%)</div>
  `;

  const qty = parseInt($('inputQty').value) || 0;
  if (qty > 0) {
    const total = price * qty;
    cp.innerHTML = `총 금액: <span>${fmt(total)}</span> · 잔액: <span>${fmt(budget)}</span>`;
  } else {
    cp.innerHTML = '&nbsp;';
  }
}

function selectTicker(t) {
  selectedTicker = t;
  document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
  const row = $(`row-${t}`);
  if (row) row.classList.add('selected');
  updateSelectedInfo();
}

/* ─────────────────────────────────────────────
   TRADE ACTIONS
───────────────────────────────────────────── */
function buy() {
  const t   = selectedTicker;
  const qty = parseInt($('inputQty').value);
  if (!t)           { toast('종목을 선택하세요', 'bad'); return; }
  if (!qty || qty<1){ toast('수량을 올바르게 입력하세요', 'bad'); return; }
  if (!prices[t])   { toast('가격 정보가 없습니다', 'bad'); return; }

  const price = prices[t];
  const cost  = price * qty;

  if (cost > budget) {
    toast(`잔액 부족 (필요: ${fmt(cost)})`, 'bad');
    addLog(`[매수 실패] ${NAMES[t][0]} ${qty}주 — 잔액 부족`, 'err');
    return;
  }

  const prevQty = holdings[t] || 0;
  const prevAvg = avgCost[t]  || 0;
  holdings[t]   = prevQty + qty;
  avgCost[t]    = (prevAvg * prevQty + price * qty) / holdings[t];
  budget -= cost;

  toast(`${NAMES[t][0]} ${qty}주 매수 완료`, 'ok');
  addLog(`[매수] ${NAMES[t][0]} ${qty}주 × ${fmt(price)} = ${fmt(cost)}`, 'buy');
  render();
  saveState();   // 서버에 자동 저장
}

function sell() {
  const t   = selectedTicker;
  const qty = parseInt($('inputQty').value);
  if (!t)             { toast('종목을 선택하세요', 'bad'); return; }
  if (!qty || qty < 1){ toast('수량을 올바르게 입력하세요', 'bad'); return; }
  if (!prices[t])     { toast('가격 정보가 없습니다', 'bad'); return; }

  const held = holdings[t] || 0;
  if (held < qty) {
    toast(`보유 수량 부족 (보유: ${held}주)`, 'bad');
    addLog(`[매도 실패] ${NAMES[t][0]} ${qty}주 — 보유 부족`, 'err');
    return;
  }

  const price     = prices[t];
  const gain      = price * qty;
  const costBasis = (avgCost[t] || price) * qty;
  const pnlTrade  = gain - costBasis;

  holdings[t] = held - qty;
  budget += gain;

  const pnlStr = (pnlTrade >= 0 ? '+' : '') + fmt(pnlTrade);
  toast(`${NAMES[t][0]} ${qty}주 매도 완료 (손익 ${pnlStr})`, 'ok');
  addLog(`[매도] ${NAMES[t][0]} ${qty}주 × ${fmt(price)} = ${fmt(gain)} (손익 ${pnlStr})`, 'sell');
  render();
  saveState();   // 서버에 자동 저장
}

/* ─────────────────────────────────────────────
   COUNTDOWN & AUTO-REFRESH
───────────────────────────────────────────── */
function startCountdown() {
  countdown = REFRESH_INTERVAL / 1000;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    countdown--;
    const el = $('nextUpdate');
    if (el) el.textContent = `다음 갱신: ${countdown}초`;
    if (countdown <= 0) {
      clearInterval(refreshTimer);
      const el2 = $('nextUpdate');
      if (el2) el2.textContent = '갱신 중...';
      fetchPrices().then(ok => {
        if (ok) render();
        startCountdown();
      });
    }
  }, 1000);
}

/* ─────────────────────────────────────────────
   WEEKLY CHART — 서버 프록시 사용 (API 키 없음)
───────────────────────────────────────────── */
async function openChart(ticker) {
  const modal   = $('chartModal');
  const canvas  = $('chartCanvas');
  const loading = $('chartLoading');
  const statsEl = $('chartStats');

  modal.style.display   = 'flex';
  loading.style.display = 'block';
  canvas.style.display  = 'none';
  statsEl.style.display = 'none';
  $('chartTicker').textContent = NAMES[ticker][0];
  $('chartName').textContent   = NAMES[ticker][1] || '';
  $('chartSummary').innerHTML  = '';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    const res  = await fetch(`${API_BASE}/chart/${encodeURIComponent(ticker)}`, { headers: authHeaders() });
    if (res.status === 401) { doLogout(); return; }
    const data = await res.json();
    if (!data || !data.values || data.values.length === 0)
      throw new Error(data.message || '데이터 없음 (장 마감 또는 티커 오류)');

    const values = [...data.values].reverse();
    const closes = values.map(v => parseFloat(v.close));
    const labels = values.map(v => {
      const d = new Date(v.datetime);
      return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    });

    const minP   = Math.min(...closes);
    const maxP   = Math.max(...closes);
    const first  = closes[0];
    const last   = closes[closes.length - 1];
    const chg    = last - first;
    const chgPct = (chg / first * 100).toFixed(2);
    const isUp   = chg >= 0;
    const lineColor = isUp ? '#00ff88' : '#ff3b5c';

    $('cs-open').textContent = '$' + first.toFixed(2);
    $('cs-cur').textContent  = '$' + last.toFixed(2);
    $('cs-high').textContent = '$' + maxP.toFixed(2);
    $('cs-low').textContent  = '$' + minP.toFixed(2);
    const sign = isUp ? '+' : '';
    $('chartSummary').innerHTML =
      `<div style="font-size:16px;color:${lineColor}">${sign}${chg.toFixed(2)} (${sign}${chgPct}%)</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-top:2px;">최근 7일 기준</div>`;

    loading.style.display = 'none';
    canvas.style.display  = 'block';
    statsEl.style.display = 'block';

    drawChart(ctx, canvas, labels, closes, lineColor, minP, maxP);
  } catch(err) {
    loading.innerHTML = `<div style="color:#ff3b5c;font-family:'Share Tech Mono',monospace;font-size:13px;letter-spacing:1px;">⚠ ${err.message}</div>`;
  }
}

function drawChart(ctx, canvas, labels, data, lineColor, minP, maxP) {
  const dpr  = window.devicePixelRatio || 1;
  const cssW = canvas.parentElement.clientWidth;
  const cssH = 300;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);

  const W = cssW, H = cssH;
  const pad = { top: 20, right: 20, bottom: 44, left: 72 };
  const cw  = W - pad.left - pad.right;
  const ch  = H - pad.top  - pad.bottom;
  const n   = data.length;
  const range = maxP - minP || 1;

  const toX = i => pad.left + (i / (n - 1)) * cw;
  const toY = v => pad.top  + ch - ((v - minP) / range) * ch;

  ctx.fillStyle = '#070910';
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i <= 5; i++) {
    const y   = pad.top + (ch / 5) * i;
    const val = maxP - (range / 5) * i;
    ctx.strokeStyle = '#181e2c'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    ctx.fillStyle = '#4a5568'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText('$' + val.toFixed(2), pad.left - 8, y + 4);
  }

  const step = Math.max(1, Math.floor(n / 7));
  ctx.fillStyle = '#4a5568'; ctx.font = '10px Share Tech Mono, monospace'; ctx.textAlign = 'center';
  for (let i = 0; i < n; i += step)
    ctx.fillText(labels[i], toX(i), H - pad.bottom + 16);

  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, lineColor + '44'); grad.addColorStop(1, lineColor + '00');
  ctx.beginPath(); ctx.moveTo(toX(0), toY(data[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(data[i]));
  ctx.lineTo(toX(n - 1), pad.top + ch); ctx.lineTo(toX(0), pad.top + ch);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.moveTo(toX(0), toY(data[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(data[i]));
  ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  const lx = toX(n - 1), ly = toY(data[n - 1]);
  ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill();
  ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fillStyle = '#0d1017'; ctx.fill();

  canvas._cd = { data, labels, toX, toY, n, pad, W, H, lineColor, minP, maxP };
  canvas.onmousemove  = e => chartHover(ctx, canvas, e);
  canvas.onmouseleave = () => drawChart(ctx, canvas, labels, data, lineColor, minP, maxP);
}

function chartHover(ctx, canvas, e) {
  const cd = canvas._cd; if (!cd) return;
  const { data, labels, toX, toY, n, pad, W, H, lineColor } = cd;
  const rect = canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;

  let closest = 0, minD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(toX(i) - mx);
    if (d < minD) { minD = d; closest = i; }
  }

  drawChart(ctx, canvas, labels, data, lineColor, cd.minP, cd.maxP);

  const x = toX(closest), y = toY(data[closest]);
  ctx.strokeStyle = '#ffffff18'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
  ctx.setLineDash([]);

  const price = data[closest], label = labels[closest];
  const tw = 148, th = 44;
  let tx = x + 12, ty = y - th - 10;
  if (tx + tw > W - pad.right) tx = x - tw - 12;
  if (ty < pad.top) ty = y + 12;

  ctx.fillStyle = '#0d1017'; ctx.strokeStyle = lineColor + '99'; ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(tx, ty, tw, th, 3); else ctx.rect(tx, ty, tw, th);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = lineColor; ctx.font = 'bold 13px Share Tech Mono, monospace'; ctx.textAlign = 'left';
  ctx.fillText('$' + price.toFixed(2), tx + 10, ty + 17);
  ctx.fillStyle = '#4a5568'; ctx.font = '10px Share Tech Mono, monospace';
  ctx.fillText(label, tx + 10, ty + 32);
}

function closeChart(e) {
  if (e && e.currentTarget !== e.target) return;
  $('chartModal').style.display = 'none';
}
