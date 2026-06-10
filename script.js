/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
const TICKERS = ['AAPL','NVDA','GOOG','MSFT','AMZN','AVGO','TSLA','META','BRK.B','WMT'];
const NAMES   = {
  AAPL:['김정훈 SHOW', '엔터테인먼트 회사'], NVDA:['아 띠BAR!','바 술집'], GOOG:['웃는 남자', '남성 전문 의류점'],
  MSFT:['쓰담쓰담 해 줘잉~', '애견 카페'], AMZN:['해라 海!', '수산시장'], AVGO:['안쓰는 생활관', '부동산'],
  TSLA:['브로콜리 통', '야채 도매점'], META:['오케이, 알겠습니다!', '택배 회사'], 'BRK.B':['자꾸 니가 생각나', '결혼 전문 업체'],
  WMT:['이불 투척', '가구 전문점']
};
const REFRESH_INTERVAL = 60000; // 60초
const INITIAL_BUDGET   = 10000;

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let budget   = INITIAL_BUDGET;
let prices   = {};    // { ticker: number }
let prevPrices = {};  // { ticker: number }
let holdings = {};    // { ticker: number }
let avgCost  = {};    // { ticker: number }  매입 평균단가
let selectedTicker = null;
let refreshTimer   = null;
let countdown      = REFRESH_INTERVAL / 1000;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const fmt = n  => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtShort = n => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const ts = () => {
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
  const el  = document.createElement('div');
  el.className = 'log-entry ' + type;
  el.innerHTML = `<span class="log-time">${ts()}</span><span class="log-msg">${msg}</span>`;
  log.prepend(el);
  while (log.children.length > 80) log.removeChild(log.lastChild);
}

function setStatus(state) {
  const dot  = $('statusDot');
  const text = $('statusText');
  dot.className = 'dot ' + state;
  if (state === 'live')    text.textContent = '실시간 연결됨';
  if (state === 'loading') text.textContent = '가격 갱신 중...';
  if (state === 'error')   text.textContent = '연결 오류';
}

/* ─────────────────────────────────────────────
   FETCH PRICES via Finnhub API
───────────────────────────────────────────── */
let finnhubKey = 'd8jc4u9r01qh6g3pfl6gd8jc4u9r01qh6g3pfl70';

async function fetchSingle(ticker, key) {
  const symbol = ticker === 'BRK.B' ? 'BRK.B' : ticker;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  addLog(d.c)
  // d.c = current price
  if (!d || typeof d.c !== 'number' || d.c === 0) throw new Error(`No data for ${ticker}`);
  return d.c;
}

async function fetchPrices() {
  if (!finnhubKey) {
    return false;
  }
  setStatus('loading');
  try {
    // Fetch all tickers in parallel
    const results = await Promise.all(
      TICKERS.map(t => fetchSingle(t, finnhubKey).then(p => ({ t, p })).catch(e => ({ t, p: null, err: e.message })))
    );

    const newPrices = {};
    const failed = [];
    for (const { t, p, err } of results) {
      if (p !== null) newPrices[t] = p;
      else failed.push(`${t}(${err})`);
    }

    if (Object.keys(newPrices).length === 0) throw new Error('모든 종목 가격 로드 실패');

    if (failed.length) addLog(`일부 누락: ${failed.join(', ')}`, 'err');

    prevPrices = { ...prices };
    prices     = newPrices;
    setStatus('live');
    addLog(`Finnhub 가격 갱신 완료 (${Object.keys(newPrices).length}개 종목)`, 'sys');
    return true;

  } catch (err) {
    setStatus('error');
    addLog(`가격 갱신 실패: ${err.message}`, 'err');
    toast('가격 갱신 실패 — API 키를 확인하세요', 'bad');
    return false;
  }
}

/* ─────────────────────────────────────────────
   RENDER
───────────────────────────────────────────── */
function render() {
  // budget stats
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
      <td class="r">
        <div class="price-val" id="pv-${t}">${fmt(price)}</div>
      </td>
      <td class="r">
        <span class="chg-badge ${chgClass}">${sign}${diff.toFixed(2)} (${sign}${pct}%)</span>
      </td>
      <td class="r">
        <div class="hold-qty ${qty===0?'zero':''}">${qty > 0 ? qty+'주' : '—'}</div>
      </td>
      <td class="r">
        <div class="hold-val">${qty > 0 ? fmt(holdVal) : '—'}</div>
      </td>
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
    row.classList.remove('row-up', 'row-down');
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

  // selected info + cost preview
  updateSelectedInfo();

  // holdings panel
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
        <span class="hi-ticker">${t}</span>
        <span class="hi-qty">${qty}주</span>
        <span class="hi-val" style="color:${pnlH>=0?'var(--accent2)':'var(--danger)'}">${fmt(val)}</span>
      `;
      list.appendChild(el);
    }
  }
}

function updateSelectedInfo() {
  const t = selectedTicker;
  const si = $('selectedInfo');
  const cp = $('costPreview');

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
    addLog(`[매수 실패] ${t} ${qty}주 — 잔액 부족`, 'err');
    return;
  }

  // 평균 매입가 계산
  const prevQty = holdings[t] || 0;
  const prevAvg = avgCost[t]  || 0;
  holdings[t]   = prevQty + qty;
  avgCost[t]    = (prevAvg * prevQty + price * qty) / holdings[t];
  budget -= cost;

  toast(`${t} ${qty}주 매수 완료`, 'ok');
  addLog(`[매수] ${t} ${qty}주 × ${fmt(price)} = ${fmt(cost)}`, 'buy');
  render();
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
    addLog(`[매도 실패] ${t} ${qty}주 — 보유 부족`, 'err');
    return;
  }

  const price  = prices[t];
  const gain   = price * qty;
  const costBasis = (avgCost[t] || price) * qty;
  const pnlTrade  = gain - costBasis;

  holdings[t] = held - qty;
  budget += gain;

  const pnlStr = (pnlTrade >= 0 ? '+' : '') + fmt(pnlTrade);
  toast(`${t} ${qty}주 매도 완료 (손익 ${pnlStr})`, 'ok');
  addLog(`[매도] ${t} ${qty}주 × ${fmt(price)} = ${fmt(gain)} (손익 ${pnlStr})`, 'sell');
  render();
}

/* ─────────────────────────────────────────────
   COUNTDOWN & AUTO-REFRESH
───────────────────────────────────────────── */
function startCountdown() {
  countdown = REFRESH_INTERVAL / 1000;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    countdown--;
    $('nextUpdate').textContent = `다음 갱신: ${countdown}초`;
    if (countdown <= 0) {
      clearInterval(refreshTimer);
      $('nextUpdate').textContent = '갱신 중...';
      fetchPrices().then(ok => {
        if (ok) render();
        startCountdown();
      });
    }
  }, 1000);
}

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
$('inputQty').addEventListener('input', updateSelectedInfo);

addLog('REAL STOCKEX 시작 (Finnhub API)', 'sys');
if (!finnhubKey) {
  render();
  addLog('오류')
} else {
  fetchPrices().then(ok => {
    render();
    if (ok) addLog('가격 로드 완료 — 자동 갱신 시작 (1분 간격)', 'sys');
    startCountdown();
  });
}