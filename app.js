// ATL Ticker Analyzer — Main App Controller

import { fetchAllData } from './api.js';
import { runAnalysis } from './indicators.js';
import { generateSignal } from './signals.js';
import {
  initChart, initRSIChart, initMACDChart,
  setupOverlayCanvas, renderAll,
} from './chart.js';

// ── State ─────────────────────────────────────────────────────
let currentSymbol = '';
let currentTF     = '1h';
let isLoading     = false;
let rawData       = null;
let analysis      = null;
let signal        = null;
let refreshTimer  = null;

// ── DOM Refs ──────────────────────────────────────────────────
const dom = {
  searchInput:      () => document.getElementById('search-input'),
  searchBtn:        () => document.getElementById('search-btn'),
  tfButtons:        () => document.querySelectorAll('[data-tf]'),
  loadingOverlay:   () => document.getElementById('loading-overlay'),
  loadingMsg:       () => document.getElementById('loading-msg'),
  errorBanner:      () => document.getElementById('error-banner'),
  errorText:        () => document.getElementById('error-text'),
  symbolDisplay:    () => document.getElementById('symbol-display'),
  priceDisplay:     () => document.getElementById('price-display'),
  change24h:        () => document.getElementById('change-24h'),
  biasChip:         () => document.getElementById('bias-chip'),
  scoreRing:        () => document.getElementById('score-ring'),
  scoreNumber:      () => document.getElementById('score-number'),
  drawerPanel:      () => document.getElementById('drawer-panel'),
  drawerTitle:      () => document.getElementById('drawer-title'),
  drawerContent:    () => document.getElementById('drawer-content'),
  drawerClose:      () => document.getElementById('drawer-close'),
  chartContainer:   () => document.getElementById('chart-container'),
  rsiContainer:     () => document.getElementById('rsi-container'),
  macdContainer:    () => document.getElementById('macd-container'),
  volContainer:     () => document.getElementById('vol-profile-container'),
  fundingMini:      () => document.getElementById('funding-mini'),
  oiMini:           () => document.getElementById('oi-mini'),
  liqContainer:     () => document.getElementById('liq-container'),
  statsBar:         () => document.getElementById('stats-bar'),
  cardGrid:         () => document.getElementById('card-grid'),
  refreshBtn:       () => document.getElementById('refresh-btn'),
  lastUpdated:      () => document.getElementById('last-updated'),
};

// ── Loading Messages ──────────────────────────────────────────
const LOADING_MSGS = [
  'Scanning exchange feeds…',
  'Fetching OHLCV candles…',
  'Pulling order book…',
  'Analyzing market structure…',
  'Detecting order blocks…',
  'Mapping FVGs…',
  'Computing RSI divergence…',
  'Running confluence engine…',
  'Generating trade setup…',
];
let loadMsgIdx = 0;
let loadMsgTimer = null;

function startLoadingCycle(msg) {
  stopLoadingCycle();
  const el = dom.loadingMsg();
  if (!el) return;
  el.textContent = msg || LOADING_MSGS[0];
  loadMsgIdx = 0;
  loadMsgTimer = setInterval(() => {
    loadMsgIdx = (loadMsgIdx + 1) % LOADING_MSGS.length;
    if (el) el.textContent = LOADING_MSGS[loadMsgIdx];
  }, 900);
}
function stopLoadingCycle() {
  if (loadMsgTimer) { clearInterval(loadMsgTimer); loadMsgTimer = null; }
}

function setLoading(v, msg) {
  isLoading = v;
  const overlay = dom.loadingOverlay();
  if (!overlay) return;
  if (v) {
    overlay.classList.add('active');
    startLoadingCycle(msg);
  } else {
    overlay.classList.remove('active');
    stopLoadingCycle();
  }
}

function showError(msg) {
  const banner = dom.errorBanner();
  const text   = dom.errorText();
  if (!banner || !text) return;
  text.textContent = msg;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 5000);
}

// ── Main Analysis Flow ────────────────────────────────────────
async function analyze(symbol, tf = currentTF) {
  if (isLoading) return;
  if (!symbol) return showError('Please enter a symbol (e.g. BTC)');

  symbol = symbol.trim().toUpperCase().replace(/USDT$/i, '');
  currentSymbol = symbol;
  currentTF     = tf;

  setLoading(true);

  try {
    rawData  = await fetchAllData(symbol, tf);
    analysis = runAnalysis(rawData);

    if (!analysis) throw new Error('Insufficient candle data — try a different timeframe or symbol');

    signal = generateSignal(rawData, analysis);

    renderUI(symbol, rawData, analysis, signal);
    renderAll(analysis);

    updateStatsBar(rawData, analysis);
    buildCardGrid(analysis, signal, rawData);
    updateLastUpdated();

    // Auto-refresh every 30s
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => analyze(currentSymbol, currentTF), 30000);

  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to fetch data. Check the symbol and try again.');
  } finally {
    setLoading(false);
  }
}

// ── Render Header ─────────────────────────────────────────────
function renderUI(symbol, data, analysis, signal) {
  const ticker = data.ticker;
  const price  = ticker?.price || analysis.price;
  const chg    = ticker?.price24h || 0;

  const sd = dom.symbolDisplay();
  const pd = dom.priceDisplay();
  const c24= dom.change24h();
  const bc = dom.biasChip();

  if (sd) sd.textContent = `${symbol} / USDT`;
  if (pd) pd.textContent = `$${formatPrice(price)}`;

  if (c24) {
    c24.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    c24.className   = `change-badge ${chg >= 0 ? 'pos' : 'neg'}`;
  }

  if (bc && signal) {
    bc.textContent   = signal.biasLabel;
    bc.style.color   = signal.biasColor;
    bc.style.borderColor = signal.biasColor;
  }

  renderScoreRing(signal?.normalizedScore || 0, signal?.biasColor || '#ffd54f');
}

function renderScoreRing(score, color) {
  const ring = dom.scoreRing();
  const num  = dom.scoreNumber();
  if (!ring || !num) return;

  const abs    = Math.abs(score);
  const offset = 283 - (abs / 100) * 283;

  ring.style.stroke           = color;
  ring.style.strokeDashoffset = offset;
  num.textContent  = (score > 0 ? '+' : '') + score;
  num.style.color  = color;
}

// ── Stats Bar ─────────────────────────────────────────────────
function updateStatsBar(data, analysis) {
  const bar = dom.statsBar();
  if (!bar) return;

  const t = data.ticker;
  const stats = [
    { label: 'Mark Price',    value: t ? `$${formatPrice(t.markPrice)}` : '—' },
    { label: 'Index Price',   value: t ? `$${formatPrice(t.indexPrice)}` : '—' },
    { label: 'Funding Rate',  value: t ? `${t.fundingRate.toFixed(4)}%` : '—', color: t?.fundingRate < 0 ? '#00e676' : t?.fundingRate > 0.05 ? '#ff4444' : '#8892a0' },
    { label: 'Open Interest', value: t?.openInterest ? formatLarge(t.openInterest) : '—' },
    { label: 'Volume 24H',    value: t ? formatLarge(t.turnover24h) + ' USDT' : '—' },
    { label: 'ATR (14)',      value: analysis.lastATR ? `$${formatPrice(analysis.lastATR)}` : '—' },
    { label: 'RSI (14)',      value: analysis.lastRSI != null ? analysis.lastRSI.toFixed(1) : '—', color: analysis.lastRSI > 70 ? '#ff4444' : analysis.lastRSI < 30 ? '#00e676' : '#8892a0' },
    { label: 'Structure',     value: analysis.structure?.trend || '—', color: analysis.structure?.trend === 'bull' ? '#00e676' : '#ff4444' },
    { label: 'Premium/Disc',  value: analysis.premDisc?.zone?.toUpperCase() || '—', color: analysis.premDisc?.zone === 'discount' ? '#00e676' : analysis.premDisc?.zone === 'premium' ? '#ff4444' : '#ffd54f' },
    { label: 'HTF Bias',      value: analysis.htfStructure?.trend || '—', color: analysis.htfStructure?.trend === 'bull' ? '#00e676' : '#ff4444' },
  ];

  bar.innerHTML = stats.map(s => `
    <div class="stat-item">
      <span class="stat-label">${s.label}</span>
      <span class="stat-value" style="color:${s.color || '#e8edf2'}">${s.value}</span>
    </div>
  `).join('');
}

// ── Card Grid ─────────────────────────────────────────────────
function buildCardGrid(analysis, signal, data) {
  const grid = dom.cardGrid();
  if (!grid) return;

  const cards = [
    buildStructureCard(analysis, signal),
    buildOrderBlockCard(analysis),
    buildFVGCard(analysis),
    buildPremDiscCard(analysis),
    buildDerivativesCard(data, analysis),
    buildLiquidationCard(analysis),
    buildSetupCard(signal),
    buildRSICard(analysis),
    buildOBCard(analysis),
  ];

  grid.innerHTML = cards.join('');

  // Bind click-to-drawer
  grid.querySelectorAll('[data-drawer]').forEach(el => {
    el.addEventListener('click', () => openDrawer(el.dataset.drawer, analysis, signal, data));
  });
}

function buildStructureCard(analysis, signal) {
  const trend = analysis.structure?.trend || 'neutral';
  const htf   = analysis.htfStructure?.trend || '—';
  const events = analysis.structure?.events?.slice(-3) || [];
  const color  = trend === 'bull' ? '#00e676' : trend === 'bear' ? '#ff4444' : '#ffd54f';
  return `
  <div class="card" data-drawer="structure">
    <div class="card-header">
      <span class="card-icon">⚡</span>
      <span class="card-title">Market Structure</span>
      <span class="card-badge" style="color:${color}">${trend.toUpperCase()}</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>MTF Trend</span><span style="color:${color}">${trend.toUpperCase()}</span></div>
      <div class="card-row"><span>HTF Bias</span><span style="color:${htf === 'bull' ? '#00e676' : htf === 'bear' ? '#ff4444' : '#ffd54f'}">${htf.toUpperCase()}</span></div>
      <div class="card-row"><span>Last Event</span><span>${events[events.length - 1]?.type || '—'}</span></div>
    </div>
    <div class="card-footer">Click for full analysis →</div>
  </div>`;
}

function buildOrderBlockCard(analysis) {
  const fresh = analysis.orderBlocks.filter(ob => ob.state === 'fresh');
  const demand = fresh.filter(ob => ob.type === 'demand').length;
  const supply = fresh.filter(ob => ob.type === 'supply').length;
  return `
  <div class="card" data-drawer="orderblocks">
    <div class="card-header">
      <span class="card-icon">🧱</span>
      <span class="card-title">Order Blocks</span>
      <span class="card-badge">${fresh.length} Active</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Demand OBs</span><span style="color:#00e676">${demand}</span></div>
      <div class="card-row"><span>Supply OBs</span><span style="color:#ff4444">${supply}</span></div>
      <div class="card-row"><span>Mitigated</span><span style="color:#5a6470">${analysis.orderBlocks.filter(ob => ob.state === 'mitigated').length}</span></div>
    </div>
    <div class="card-footer">Click for zones →</div>
  </div>`;
}

function buildFVGCard(analysis) {
  const fvgs = analysis.fvgs;
  const bull = fvgs.filter(f => f.dir === 'bull').length;
  const bear = fvgs.filter(f => f.dir === 'bear').length;
  return `
  <div class="card" data-drawer="fvg">
    <div class="card-header">
      <span class="card-icon">📐</span>
      <span class="card-title">Fair Value Gaps</span>
      <span class="card-badge">${fvgs.length} Active</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Bullish FVGs</span><span style="color:#00e676">${bull}</span></div>
      <div class="card-row"><span>Bearish FVGs</span><span style="color:#ff4444">${bear}</span></div>
      <div class="card-row"><span>Largest Gap</span><span>${fvgs.length ? fvgs.reduce((m,f) => f.size > m.size ? f : m, fvgs[0]).size.toFixed(2) + '%' : '—'}</span></div>
    </div>
    <div class="card-footer">Click for gaps →</div>
  </div>`;
}

function buildPremDiscCard(analysis) {
  const pd = analysis.premDisc;
  if (!pd) return `<div class="card"><div class="card-header"><span class="card-title">Premium/Discount</span></div><div class="card-body"><div class="card-row"><span>Data unavailable</span></div></div></div>`;
  const zoneColor = pd.zone === 'discount' ? '#00e676' : pd.zone === 'premium' ? '#ff4444' : '#ffd54f';
  return `
  <div class="card" data-drawer="premdisc">
    <div class="card-header">
      <span class="card-icon">🎯</span>
      <span class="card-title">Premium / Discount</span>
      <span class="card-badge" style="color:${zoneColor}">${pd.zone.toUpperCase()}</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Range Position</span><span>${(pd.position * 100).toFixed(1)}%</span></div>
      <div class="card-row"><span>Equilibrium</span><span>$${formatPrice(pd.fib50)}</span></div>
      <div class="card-row"><span>Range High</span><span>$${formatPrice(pd.rangeHigh)}</span></div>
    </div>
    <div class="card-footer">Click for Fibonacci levels →</div>
  </div>`;
}

function buildDerivativesCard(data, analysis) {
  const t = data.ticker;
  const fr = t?.fundingRate || 0;
  const frColor = fr < -0.01 ? '#00e676' : fr > 0.05 ? '#ff4444' : '#8892a0';
  const oiLen = data.oiHistory.length;
  const oiTrend = oiLen >= 2
    ? data.oiHistory[oiLen - 1].oi > data.oiHistory[0].oi ? '▲ Rising' : '▼ Falling'
    : '—';
  return `
  <div class="card" data-drawer="derivatives">
    <div class="card-header">
      <span class="card-icon">📡</span>
      <span class="card-title">Derivatives</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Funding Rate</span><span style="color:${frColor}">${fr.toFixed(4)}%</span></div>
      <div class="card-row"><span>Open Interest</span><span>${oiTrend}</span></div>
      <div class="card-row"><span>Taker Flow</span><span style="color:${data.takerFlow?.takerBias > 0 ? '#00e676' : '#ff4444'}">${data.takerFlow?.takerBias?.toFixed(1) || '—'}% net ${data.takerFlow?.takerBias > 0 ? 'buy' : 'sell'}</span></div>
    </div>
    <div class="card-footer">Click for derivatives analysis →</div>
  </div>`;
}

function buildLiquidationCard(analysis) {
  const liq = analysis.liqLevels;
  return `
  <div class="card" data-drawer="liquidation">
    <div class="card-header">
      <span class="card-icon">💥</span>
      <span class="card-title">Liquidation Map</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Swing High</span><span>$${formatPrice(liq.swingHigh)}</span></div>
      <div class="card-row"><span>Swing Low</span><span>$${formatPrice(liq.swingLow)}</span></div>
      <div class="card-row"><span>10× Short Liq</span><span style="color:#ff4444">$${formatPrice(liq.shortLiqs[3].price)}</span></div>
    </div>
    <div class="card-footer">Click for full liquidation levels →</div>
  </div>`;
}

function buildSetupCard(signal) {
  if (!signal?.setup) return `<div class="card"><div class="card-header"><span class="card-title">Trade Setup</span></div><div class="card-body"><div class="card-row"><span>Insufficient confluence for setup</span></div></div></div>`;
  const s = signal.setup;
  const isLong = s.direction === 'LONG';
  const color = isLong ? '#00e676' : '#ff4444';
  return `
  <div class="card highlight" data-drawer="setup">
    <div class="card-header">
      <span class="card-icon">${isLong ? '⬆' : '⬇'}</span>
      <span class="card-title">Trade Setup</span>
      <span class="card-badge" style="color:${color}">${s.direction}</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Entry</span><span>$${formatPrice(s.entry)}</span></div>
      <div class="card-row"><span>Stop Loss</span><span style="color:#ff4444">$${formatPrice(s.sl)}</span></div>
      <div class="card-row"><span>TP1 / TP2 / TP3</span><span style="color:#00e676">${s.rr1}R / ${s.rr2}R / ${s.rr3}R</span></div>
    </div>
    <div class="card-footer">Click for full setup + reasoning →</div>
  </div>`;
}

function buildRSICard(analysis) {
  const rsi = analysis.lastRSI;
  const divs = analysis.divs;
  const rsiColor = rsi > 70 ? '#ff4444' : rsi < 30 ? '#00e676' : '#a78bfa';
  return `
  <div class="card" data-drawer="rsi">
    <div class="card-header">
      <span class="card-icon">📊</span>
      <span class="card-title">RSI + MACD</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>RSI (14)</span><span style="color:${rsiColor}">${rsi?.toFixed(1) || '—'}</span></div>
      <div class="card-row"><span>MACD Signal</span><span style="color:${analysis.lastMACD.histogram > 0 ? '#00e676' : '#ff4444'}">${analysis.lastMACD.histogram > 0 ? 'Bullish' : 'Bearish'}</span></div>
      <div class="card-row"><span>Divergence</span><span style="color:${divs.length ? (divs[divs.length-1].type === 'bullish' ? '#00e676' : '#ff4444') : '#5a6470'}">${divs.length ? divs[divs.length-1].type + ' div' : 'None'}</span></div>
    </div>
    <div class="card-footer">Click for momentum analysis →</div>
  </div>`;
}

function buildOBCard(analysis) {
  const ob = analysis.obAnalysis;
  if (!ob) return `<div class="card"><div class="card-header"><span class="card-title">Order Book</span></div><div class="card-body"><div class="card-row"><span>Data unavailable</span></div></div></div>`;
  const biasColor = ob.bias === 'bullish' ? '#00e676' : ob.bias === 'bearish' ? '#ff4444' : '#ffd54f';
  return `
  <div class="card" data-drawer="orderbook">
    <div class="card-header">
      <span class="card-icon">📖</span>
      <span class="card-title">Order Book</span>
      <span class="card-badge" style="color:${biasColor}">${ob.bias.toUpperCase()}</span>
    </div>
    <div class="card-body">
      <div class="card-row"><span>Bid Depth</span><span style="color:#00e676">${(ob.bidAskRatio * 100).toFixed(0)}%</span></div>
      <div class="card-row"><span>Bid Walls</span><span>${ob.bidWalls.length} detected</span></div>
      <div class="card-row"><span>Ask Walls</span><span>${ob.askWalls.length} detected</span></div>
    </div>
    <div class="card-footer">Click for depth analysis →</div>
  </div>`;
}

// ── Drawer System ─────────────────────────────────────────────
function openDrawer(type, analysis, signal, data) {
  const panel   = dom.drawerPanel();
  const title   = dom.drawerTitle();
  const content = dom.drawerContent();
  if (!panel || !title || !content) return;

  const { html, titleText } = buildDrawerContent(type, analysis, signal, data);
  title.textContent   = titleText;
  content.innerHTML   = html;
  panel.classList.add('open');
}

function closeDrawer() {
  dom.drawerPanel()?.classList.remove('open');
}

function buildDrawerContent(type, analysis, signal, data) {
  switch (type) {
    case 'structure': return drawerStructure(analysis);
    case 'orderblocks': return drawerOrderBlocks(analysis);
    case 'fvg': return drawerFVG(analysis);
    case 'premdisc': return drawerPremDisc(analysis);
    case 'derivatives': return drawerDerivatives(data, analysis);
    case 'liquidation': return drawerLiquidation(analysis);
    case 'setup': return drawerSetup(signal, analysis);
    case 'rsi': return drawerRSI(analysis);
    case 'orderbook': return drawerOrderBook(analysis);
    default: return { html: '<p>No content</p>', titleText: type };
  }
}

function drawerStructure(analysis) {
  const { structure, htfStructure } = analysis;
  const events = structure?.events?.slice(-8) || [];
  const rows = events.reverse().map(ev => `
    <div class="drawer-row">
      <span class="tag ${ev.type === 'CHoCH' ? 'tag-warn' : ev.dir === 'bull' ? 'tag-bull' : 'tag-bear'}">${ev.type}</span>
      <span>${ev.dir === 'bull' ? '↑ Bullish' : '↓ Bearish'}</span>
      <span>$${formatPrice(ev.price)}</span>
    </div>`).join('');

  const msScore = signal?.scores?.structure;

  return {
    titleText: '⚡ Market Structure Analysis',
    html: `
    <div class="drawer-section">
      <div class="drawer-label">TREND STATE</div>
      <div class="drawer-big" style="color:${structure?.trend === 'bull' ? '#00e676' : '#ff4444'}">${structure?.trend?.toUpperCase() || 'NEUTRAL'}</div>
      <div class="drawer-sub">HTF (4H): ${htfStructure?.trend?.toUpperCase() || 'N/A'}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">RECENT STRUCTURE EVENTS</div>
      ${rows || '<div class="drawer-empty">No structure events detected yet</div>'}
    </div>
    <div class="drawer-section">
      <div class="drawer-label">CONFLUENCE ANALYSIS</div>
      ${(signal?.scores?.structure?.reasons || ['Structure analysis requires a symbol to be loaded']).map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}
    </div>`,
  };
}

function drawerOrderBlocks(analysis) {
  const obs = analysis.orderBlocks;
  const rows = obs.slice().reverse().map(ob => `
    <div class="drawer-ob ${ob.type === 'demand' ? 'ob-demand' : 'ob-supply'}">
      <div class="ob-header">
        <span class="tag ${ob.type === 'demand' ? 'tag-bull' : 'tag-bear'}">${ob.type.toUpperCase()} OB</span>
        <span class="tag tag-info">${ob.structureType}</span>
        <span class="ob-state ${ob.state}">${ob.state.toUpperCase()}</span>
      </div>
      <div class="ob-levels">
        <span>High: $${formatPrice(ob.high)}</span>
        <span>Low: $${formatPrice(ob.low)}</span>
        <span>Range: ${((ob.high - ob.low) / ob.low * 100).toFixed(2)}%</span>
      </div>
      <div class="ob-reason">
        ${ob.type === 'demand'
          ? `Last bearish candle before bullish impulse — institutional demand likely resting in this zone ($${formatPrice(ob.low)}–$${formatPrice(ob.high)}). A retest here with a bullish engulf is a high-probability entry.`
          : `Last bullish candle before bearish impulse — institutional supply likely resting in this zone ($${formatPrice(ob.low)}–$${formatPrice(ob.high)}). A retest here with a bearish engulf is a high-probability short entry.`}
      </div>
    </div>`).join('');

  return {
    titleText: '🧱 Order Block Analysis',
    html: `
    <div class="drawer-section">
      <div class="drawer-label">WHAT IS AN ORDER BLOCK?</div>
      <div class="drawer-explain">An Order Block is the last opposite-colored candle before a significant impulse move. It represents where institutions placed large orders, and price typically returns to these zones to fill remaining orders before continuing.</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">DETECTED ORDER BLOCKS (${obs.length})</div>
      ${rows || '<div class="drawer-empty">No order blocks detected</div>'}
    </div>
    ${(signal?.scores?.orderBlocks?.reasons || []).map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}`,
  };
}

function drawerFVG(analysis) {
  const fvgs = analysis.fvgs;
  const rows = fvgs.slice().reverse().map(f => `
    <div class="drawer-ob ${f.dir === 'bull' ? 'ob-demand' : 'ob-supply'}">
      <div class="ob-header">
        <span class="tag ${f.dir === 'bull' ? 'tag-bull' : 'tag-bear'}">${f.dir.toUpperCase()} FVG</span>
        <span>${f.size.toFixed(3)}% gap</span>
      </div>
      <div class="ob-levels">
        <span>Top: $${formatPrice(f.top)}</span>
        <span>Bottom: $${formatPrice(f.bottom)}</span>
        <span>Mid: $${formatPrice(f.mid)}</span>
      </div>
      <div class="ob-reason">
        ${f.dir === 'bull'
          ? `Price gapped up — no trading occurred between $${formatPrice(f.bottom)} and $${formatPrice(f.top)}. Acts as a magnet, expect price to fill this gap before resuming upward.`
          : `Price gapped down — no trading between $${formatPrice(f.bottom)} and $${formatPrice(f.top)}. Overhead resistance — bears defending this zone.`}
      </div>
    </div>`).join('');

  return {
    titleText: '📐 Fair Value Gaps',
    html: `
    <div class="drawer-section">
      <div class="drawer-explain">A Fair Value Gap (imbalance) occurs when a 3-candle sequence leaves a price range untouched. Price is drawn back to fill these gaps as the market seeks equilibrium.</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">ACTIVE FVGs (${fvgs.length})</div>
      ${rows || '<div class="drawer-empty">No unfilled FVGs detected</div>'}
    </div>`,
  };
}

function drawerPremDisc(analysis) {
  const pd = analysis.premDisc;
  if (!pd) return { titleText: 'Premium / Discount', html: '<p>No data</p>' };

  const levels = [
    { label: 'Range High (100%)', price: pd.rangeHigh, color: '#ff4444' },
    { label: 'Fibonacci 70.5%',   price: pd.fib705,    color: '#ff7c7c' },
    { label: 'Fibonacci 61.8% (Premium)',   price: pd.fib618,    color: '#ff4444' },
    { label: 'Fibonacci 50% (EQ)',price: pd.fib50,     color: '#ffd54f' },
    { label: 'Fibonacci 38.2% (Discount)',  price: pd.fib382,    color: '#00e676' },
    { label: 'Fibonacci 23.6%',   price: pd.fib236,    color: '#69f0ae' },
    { label: 'Range Low (0%)',    price: pd.rangeLow,  color: '#00e676' },
  ];

  const current = pd.position * 100;
  const zone    = pd.zone;

  return {
    titleText: '🎯 Premium / Discount Zones',
    html: `
    <div class="drawer-section">
      <div class="drawer-label">CURRENT ZONE</div>
      <div class="drawer-big" style="color:${zone === 'discount' ? '#00e676' : zone === 'premium' ? '#ff4444' : '#ffd54f'}">${zone.toUpperCase()}</div>
      <div class="drawer-sub">Position: ${current.toFixed(1)}% of range</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">FIBONACCI LEVELS</div>
      ${levels.map(l => `
        <div class="drawer-row">
          <span style="color:${l.color}">${l.label}</span>
          <span>$${formatPrice(l.price)}</span>
        </div>`).join('')}
    </div>
    <div class="drawer-section">
      <div class="drawer-explain">
        Smart Money uses the range between a significant high and low. The upper half (above 50%) is PREMIUM — price is expensive. The lower half (below 50%) is DISCOUNT — price is cheap. ICT teaches buying in discount and selling in premium zones.
      </div>
    </div>
    ${(signal?.scores?.premDisc?.reasons || []).map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}`,
  };
}

function drawerDerivatives(data, analysis) {
  const t = data.ticker;
  const fr = t?.fundingRate || 0;
  const hist = data.fundingHist.slice(-10);
  const oiData = data.oiHistory.slice(-8);

  return {
    titleText: '📡 Derivatives Intelligence',
    html: `
    <div class="drawer-section">
      <div class="drawer-label">FUNDING RATE</div>
      <div class="drawer-big" style="color:${fr < -0.01 ? '#00e676' : fr > 0.05 ? '#ff4444' : '#ffd54f'}">${fr.toFixed(4)}%</div>
      <div class="drawer-explain">${fr < -0.05 ? '🔥 Extremely negative — shorts paying longs. High risk of short squeeze. Historically bullish contrarian signal.' : fr < -0.01 ? 'Negative funding — mild bearish sentiment in derivatives. Support for spot longs.' : fr > 0.1 ? '⚠️ Very high positive funding — longs heavily paying shorts. Overheated — long liquidation risk.' : fr > 0.03 ? 'Elevated funding — market leaning long. Watch for leverage purge.' : 'Neutral funding — no significant derivatives-driven pressure.'}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">RECENT FUNDING HISTORY</div>
      ${hist.map(h => `<div class="drawer-row"><span>${new Date(h.time * 1000).toLocaleDateString()}</span><span style="color:${h.rate < 0 ? '#00e676' : '#ff4444'}">${h.rate.toFixed(4)}%</span></div>`).join('')}
    </div>
    <div class="drawer-section">
      <div class="drawer-label">OPEN INTEREST SNAPSHOTS</div>
      ${oiData.map(o => `<div class="drawer-row"><span>${new Date(o.time * 1000).toLocaleTimeString()}</span><span>${formatLarge(o.oi)}</span></div>`).join('')}
    </div>
    ${(signal?.scores?.derivatives?.reasons || []).map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}`,
  };
}

function drawerLiquidation(analysis) {
  const liq = analysis.liqLevels;
  return {
    titleText: '💥 Liquidation Level Map',
    html: `
    <div class="drawer-section">
      <div class="drawer-explain">Based on recent swing high/low. These levels mark where leveraged positions become underwater and force-closed, creating cascading liquidations and sharp price moves.</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">SHORT LIQUIDATION LEVELS (above swing high)</div>
      ${liq.shortLiqs.map(l => `
        <div class="drawer-row">
          <span style="color:#ff4444">${l.label}</span>
          <span>$${formatPrice(l.price)}</span>
          <span style="color:#5a6470">+${((l.price / liq.swingHigh - 1) * 100).toFixed(1)}%</span>
        </div>`).join('')}
    </div>
    <div class="drawer-section">
      <div class="drawer-label">LONG LIQUIDATION LEVELS (below swing low)</div>
      ${liq.longLiqs.map(l => `
        <div class="drawer-row">
          <span style="color:#00e676">${l.label}</span>
          <span>$${formatPrice(l.price)}</span>
          <span style="color:#5a6470">${((l.price / liq.swingLow - 1) * 100).toFixed(1)}%</span>
        </div>`).join('')}
    </div>`,
  };
}

function drawerSetup(signal, analysis) {
  if (!signal?.setup) return { titleText: 'Trade Setup', html: '<div class="drawer-empty">No setup generated — confluence insufficient. Score below threshold or NEUTRAL bias.</div>' };
  const s = signal.setup;
  const isLong = s.direction === 'LONG';

  return {
    titleText: `${isLong ? '⬆' : '⬇'} ${s.direction} Trade Setup`,
    html: `
    <div class="setup-grid">
      <div class="setup-level entry"><div class="level-label">ENTRY</div><div class="level-price">$${formatPrice(s.entry)}</div><div class="level-reason">${s.entryReason}</div></div>
      <div class="setup-level sl"><div class="level-label">STOP LOSS</div><div class="level-price">$${formatPrice(s.sl)}</div><div class="level-reason">${s.slReason}</div></div>
      <div class="setup-level tp1"><div class="level-label">TP1 — ${s.rr1}R</div><div class="level-price">$${formatPrice(s.tp1)}</div><div class="level-reason">${s.tp1Reason}</div></div>
      <div class="setup-level tp2"><div class="level-label">TP2 — ${s.rr2}R</div><div class="level-price">$${formatPrice(s.tp2)}</div><div class="level-reason">${s.tp2Reason}</div></div>
      <div class="setup-level tp3"><div class="level-label">TP3 — ${s.rr3}R</div><div class="level-price">$${formatPrice(s.tp3)}</div><div class="level-reason">${s.tp3Reason}</div></div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">INVALIDATION</div>
      <div class="drawer-reason" style="color:#ff9090">⚠ ${s.invalidationReason}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">BULL SCENARIO</div>
      <div class="drawer-explain">${s.bullScenario}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">BEAR SCENARIO</div>
      <div class="drawer-explain">${s.bearScenario}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">CONFLUENCE SCORE</div>
      <div class="confluence-bars">
        ${Object.entries(signal.scores).map(([k, s]) => `
          <div class="conf-bar-row">
            <span class="conf-label">${k}</span>
            <div class="conf-bar-wrap">
              <div class="conf-bar-fill" style="width:${Math.abs(s.score / 2) * 100}%;background:${s.score > 0 ? '#00e676' : s.score < 0 ? '#ff4444' : '#5a6470'}"></div>
            </div>
            <span class="conf-score" style="color:${s.score > 0 ? '#00e676' : s.score < 0 ? '#ff4444' : '#5a6470'}">${s.score > 0 ? '+' : ''}${s.score.toFixed(1)}</span>
          </div>`).join('')}
      </div>
    </div>`,
  };
}

function drawerRSI(analysis) {
  const rsi = analysis.lastRSI;
  const divs = analysis.divs;
  return {
    titleText: '📊 RSI + MACD Momentum',
    html: `
    <div class="drawer-section">
      <div class="drawer-label">RSI (14)</div>
      <div class="drawer-big" style="color:${rsi > 70 ? '#ff4444' : rsi < 30 ? '#00e676' : '#a78bfa'}">${rsi?.toFixed(2) || '—'}</div>
      <div class="rsi-scale">
        <div class="rsi-bar">
          <div class="rsi-fill" style="left:${rsi || 50}%;"></div>
          <span class="rsi-marker" style="left:30%">30</span>
          <span class="rsi-marker" style="left:70%">70</span>
        </div>
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">MACD (12/26/9)</div>
      <div class="drawer-row"><span>MACD Line</span><span style="color:#00bfff">${analysis.lastMACD.line?.toFixed(4) || '—'}</span></div>
      <div class="drawer-row"><span>Signal Line</span><span style="color:#ff7c7c">${analysis.lastMACD.signal?.toFixed(4) || '—'}</span></div>
      <div class="drawer-row"><span>Histogram</span><span style="color:${analysis.lastMACD.histogram > 0 ? '#00e676' : '#ff4444'}">${analysis.lastMACD.histogram?.toFixed(4) || '—'}</span></div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">RSI DIVERGENCES</div>
      ${divs.length
        ? divs.map(d => `<div class="drawer-ob ${d.type === 'bullish' ? 'ob-demand' : 'ob-supply'}"><div class="ob-header"><span class="tag ${d.type === 'bullish' ? 'tag-bull' : 'tag-bear'}">${d.type.toUpperCase()} DIVERGENCE</span></div><div class="ob-reason">Price at $${formatPrice(d.priceNow)} (${d.priceNow > d.pricePrev ? 'higher' : 'lower'}) while RSI went from ${d.rsiPrev.toFixed(1)} → ${d.rsiNow.toFixed(1)} (${d.rsiNow > d.rsiPrev ? 'higher' : 'lower'}) — ${d.type === 'bullish' ? 'hidden buying pressure beneath the surface' : 'hidden selling pressure, momentum exhaustion'}.</div></div>`).join('')
        : '<div class="drawer-empty">No RSI divergences detected in recent candles</div>'}
    </div>
    ${(signal?.scores?.rsi?.reasons || []).map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}`,
  };
}

function drawerOrderBook(analysis) {
  const ob = analysis.obAnalysis;
  if (!ob) return { titleText: 'Order Book', html: '<div class="drawer-empty">Order book data unavailable</div>' };

  return {
    titleText: '📖 Order Book Depth Analysis',
    html: `
    <div class="drawer-section">
      <div class="drawer-label">DEPTH BREAKDOWN</div>
      <div class="depth-bar-wrap">
        <div class="depth-bid" style="width:${(ob.bidAskRatio * 100).toFixed(1)}%">Bids ${(ob.bidAskRatio * 100).toFixed(0)}%</div>
        <div class="depth-ask" style="width:${((1 - ob.bidAskRatio) * 100).toFixed(1)}%">Asks ${((1 - ob.bidAskRatio) * 100).toFixed(0)}%</div>
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">LARGE BID WALLS</div>
      ${ob.bidWalls.length
        ? ob.bidWalls.slice(0, 5).map(w => `<div class="drawer-row"><span>$${formatPrice(w.price)}</span><span style="color:#00e676">${w.size.toFixed(1)} lots</span></div>`).join('')
        : '<div class="drawer-empty">No significant bid walls</div>'}
    </div>
    <div class="drawer-section">
      <div class="drawer-label">LARGE ASK WALLS</div>
      ${ob.askWalls.length
        ? ob.askWalls.slice(0, 5).map(w => `<div class="drawer-row"><span>$${formatPrice(w.price)}</span><span style="color:#ff4444">${w.size.toFixed(1)} lots</span></div>`).join('')
        : '<div class="drawer-empty">No significant ask walls</div>'}
    </div>
    ${(signal?.scores?.orderBook?.reasons || []).map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}`,
  };
}

// ── Helpers ────────────────────────────────────────────────────
function formatPrice(p) {
  if (!p) return '0';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
}
function formatLarge(n) {
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return n?.toFixed(2) || '0';
}
function updateLastUpdated() {
  const el = dom.lastUpdated();
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ── Boot ───────────────────────────────────────────────────────
function boot() {
  // Init charts
  const chartEl   = dom.chartContainer();
  const rsiEl     = dom.rsiContainer();
  const macdEl    = dom.macdContainer();

  if (chartEl) {
    initChart(chartEl);
    setupOverlayCanvas(chartEl);
  }
  if (rsiEl)  initRSIChart(rsiEl);
  if (macdEl) initMACDChart(macdEl);

  // Search
  const input = dom.searchInput();
  const btn   = dom.searchBtn();
  if (btn) btn.addEventListener('click', () => analyze(input?.value || ''));
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') analyze(input.value);
  });

  // Timeframe buttons
  dom.tfButtons().forEach(btn => {
    btn.addEventListener('click', () => {
      dom.tfButtons().forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTF = btn.dataset.tf;
      if (currentSymbol) analyze(currentSymbol, currentTF);
    });
  });

  // Drawer close
  dom.drawerClose()?.addEventListener('click', closeDrawer);
  dom.drawerPanel()?.addEventListener('click', e => {
    if (e.target === dom.drawerPanel()) closeDrawer();
  });

  // Refresh button
  dom.refreshBtn()?.addEventListener('click', () => analyze(currentSymbol || input?.value || ''));

  // Expose signal for drawer
  window.__atl_signal = null;
  window.openDrawer   = (type) => openDrawer(type, analysis, signal, rawData);

  // Auto-load BTC on start
  if (input) input.value = 'BTC';
  setTimeout(() => analyze('BTC'), 300);
}

window.addEventListener('DOMContentLoaded', boot);
export { analyze, formatPrice, formatLarge };
