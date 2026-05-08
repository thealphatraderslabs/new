// ATL Ticker Analyzer — Main App Controller v2
// Changes from v1:
//   - Auto-refresh REMOVED. Refresh is manual only (button or TF switch).
//   - buildCardGrid() replaced by buildIntelTabs() — 4 tabs, all inline.
//   - Decision Bar populated on every analyze() call.

import { fetchAllData } from './api.js?v=2';
import { runAnalysis } from './indicators.js?v=2';
import { generateSignal } from './signals.js?v=2';
import {
  initChart, initRSIChart, initMACDChart,
  setupOverlayCanvas, renderAll,
} from './chart.js?v=2';

// ── State ──────────────────────────────────────────────────────
let currentSymbol = '';
let currentTF     = '1h';
let isLoading     = false;
let rawData       = null;
let analysis      = null;
let signal        = null;

// ── DOM Refs ───────────────────────────────────────────────────
const dom = {
  searchInput:    () => document.getElementById('search-input'),
  searchBtn:      () => document.getElementById('search-btn'),
  tfButtons:      () => document.querySelectorAll('[data-tf]'),
  loadingOverlay: () => document.getElementById('loading-overlay'),
  loadingMsg:     () => document.getElementById('loading-msg'),
  errorBanner:    () => document.getElementById('error-banner'),
  errorText:      () => document.getElementById('error-text'),
  symbolDisplay:  () => document.getElementById('symbol-display'),
  priceDisplay:   () => document.getElementById('price-display'),
  change24h:      () => document.getElementById('change-24h'),
  biasChip:       () => document.getElementById('bias-chip'),
  scoreRing:      () => document.getElementById('score-ring'),
  scoreNumber:    () => document.getElementById('score-number'),
  drawerPanel:    () => document.getElementById('drawer-panel'),
  drawerTitle:    () => document.getElementById('drawer-title'),
  drawerContent:  () => document.getElementById('drawer-content'),
  drawerClose:    () => document.getElementById('drawer-close'),
  chartContainer: () => document.getElementById('chart-container'),
  rsiContainer:   () => document.getElementById('rsi-container'),
  macdContainer:  () => document.getElementById('macd-container'),
  volContainer:   () => document.getElementById('vol-profile-container'),
  fundingMini:    () => document.getElementById('funding-mini'),
  oiMini:         () => document.getElementById('oi-mini'),
  liqContainer:   () => document.getElementById('liq-container'),
  statsBar:       () => document.getElementById('stats-bar'),
  refreshBtn:     () => document.getElementById('refresh-btn'),
  lastUpdated:    () => document.getElementById('last-updated'),
  // Decision Bar
  dbBias:         () => document.getElementById('db-bias-val'),
  dbEntry:        () => document.getElementById('db-entry-val'),
  dbSL:           () => document.getElementById('db-sl-val'),
  dbTP:           () => document.getElementById('db-tp-val'),
  dbStruct:       () => document.getElementById('db-struct-val'),
  dbZone:         () => document.getElementById('db-zone-val'),
  dbInvalid:      () => document.getElementById('db-invalid-val'),
  dbSlotBias:     () => document.getElementById('db-slot-bias'),
  // Tab panes
  tabSetup:       () => document.getElementById('tab-setup'),
  tabStructure:   () => document.getElementById('tab-structure'),
  tabLevels:      () => document.getElementById('tab-levels'),
  tabDerivatives: () => document.getElementById('tab-derivatives'),
};

// ── Loading ────────────────────────────────────────────────────
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
let loadMsgIdx = 0, loadMsgTimer = null;

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
  if (v) { overlay.classList.add('active'); startLoadingCycle(msg); }
  else   { overlay.classList.remove('active'); stopLoadingCycle(); }
}
function showError(msg) {
  const banner = dom.errorBanner();
  const text   = dom.errorText();
  if (!banner || !text) return;
  text.textContent = msg;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 5000);
}

// ── Main Analysis Flow ─────────────────────────────────────────
async function analyze(symbol, tf = currentTF) {
  if (isLoading) return;
  if (!symbol || !symbol.trim()) return showError('Please enter a symbol (e.g. BTC)');

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
    renderAll(
      analysis, rawData,
      dom.chartContainer(), dom.rsiContainer(), dom.macdContainer(),
      dom.volContainer(), dom.fundingMini(), dom.oiMini(), dom.liqContainer()
    );

    updateStatsBar(rawData, analysis);
    populateDecisionBar(analysis, signal);
    buildIntelTabs(analysis, signal, rawData);
    updateLastUpdated();

  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to fetch data. Check the symbol and try again.');
  } finally {
    setLoading(false);
  }
}

// ── Hero Strip ─────────────────────────────────────────────────
function renderUI(symbol, data, analysis, signal) {
  const ticker = data.ticker;
  const price  = ticker?.price || analysis.price;
  const chg    = ticker?.price24h || 0;

  const sd = dom.symbolDisplay();
  const pd = dom.priceDisplay();
  const c24 = dom.change24h();
  const bc = dom.biasChip();

  if (sd) sd.textContent = `${symbol} / USDT`;
  if (pd) pd.textContent = `$${formatPrice(price)}`;
  if (c24) {
    c24.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    c24.className   = `change-badge ${chg >= 0 ? 'pos' : 'neg'}`;
  }
  if (bc && signal) {
    bc.textContent       = signal.biasLabel;
    bc.style.color       = signal.biasColor;
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
  num.textContent = (score > 0 ? '+' : '') + score;
  num.style.color = color;
}

// ── Stats Bar ──────────────────────────────────────────────────
function updateStatsBar(data, analysis) {
  const bar = dom.statsBar();
  if (!bar) return;
  const t = data.ticker;
  const stats = [
    { label: 'Mark Price',   value: t ? `$${formatPrice(t.markPrice)}` : '—' },
    { label: 'Index Price',  value: t ? `$${formatPrice(t.indexPrice)}` : '—' },
    { label: 'Funding Rate', value: t ? `${t.fundingRate.toFixed(4)}%` : '—', color: t?.fundingRate < 0 ? '#00e676' : t?.fundingRate > 0.05 ? '#ff4444' : '#8892a0' },
    { label: 'Open Interest',value: t?.openInterest ? formatLarge(t.openInterest) : '—' },
    { label: 'Volume 24H',   value: t ? formatLarge(t.turnover24h) + ' USDT' : '—' },
    { label: 'ATR (14)',     value: analysis.lastATR ? `$${formatPrice(analysis.lastATR)}` : '—' },
    { label: 'RSI (14)',     value: analysis.lastRSI != null ? analysis.lastRSI.toFixed(1) : '—', color: analysis.lastRSI > 70 ? '#ff4444' : analysis.lastRSI < 30 ? '#00e676' : '#8892a0' },
    { label: 'Structure',    value: analysis.structure?.trend || '—', color: analysis.structure?.trend === 'bull' ? '#00e676' : '#ff4444' },
    { label: 'Premium/Disc', value: analysis.premDisc?.zone?.toUpperCase() || '—', color: analysis.premDisc?.zone === 'discount' ? '#00e676' : analysis.premDisc?.zone === 'premium' ? '#ff4444' : '#ffd54f' },
    { label: 'HTF Bias',     value: analysis.htfStructure?.trend || '—', color: analysis.htfStructure?.trend === 'bull' ? '#00e676' : '#ff4444' },
  ];
  bar.innerHTML = stats.map(s => `
    <div class="stat-item">
      <span class="stat-label">${s.label}</span>
      <span class="stat-value" style="color:${s.color || '#e8edf2'}">${s.value}</span>
    </div>`).join('');
}

// ── Decision Bar ───────────────────────────────────────────────
// Populates the always-visible strip with the full trade read.
// No clicking required — this is the first thing a user sees.
function populateDecisionBar(analysis, signal) {
  const s       = signal?.setup;
  const trend   = analysis.structure?.trend || 'neutral';
  const pd      = analysis.premDisc;

  // BIAS
  const biasEl  = dom.dbBias();
  const slotEl  = dom.dbSlotBias();
  if (biasEl) {
    biasEl.textContent  = signal?.biasLabel || '—';
    biasEl.style.color  = signal?.biasColor || '#8892a0';
  }
  if (slotEl) {
    slotEl.style.borderBottomColor = signal?.biasColor || 'transparent';
  }

  // ENTRY ZONE
  const entryEl = dom.dbEntry();
  if (entryEl) {
    entryEl.textContent = s ? `$${formatPrice(s.entry)}` : '—';
    entryEl.style.color = s ? (s.direction === 'LONG' ? '#00e676' : '#ff4444') : '#8892a0';
  }

  // SL
  const slEl = dom.dbSL();
  if (slEl) slEl.textContent = s ? `$${formatPrice(s.sl)}` : '—';

  // TP
  const tpEl = dom.dbTP();
  if (tpEl) {
    tpEl.textContent = s
      ? `$${formatPrice(s.tp1)} / $${formatPrice(s.tp2)} / $${formatPrice(s.tp3)}`
      : '— / — / —';
  }

  // STRUCTURE
  const structEl = dom.dbStruct();
  if (structEl) {
    const htf  = analysis.htfStructure?.trend || '—';
    const mtf  = trend;
    structEl.textContent = `MTF: ${mtf.toUpperCase()} · HTF: ${htf.toUpperCase()}`;
    structEl.style.color = mtf === 'bull' ? '#00e676' : mtf === 'bear' ? '#ff4444' : '#ffd54f';
  }

  // P/D ZONE
  const zoneEl = dom.dbZone();
  if (zoneEl && pd) {
    zoneEl.textContent = `${pd.zone.toUpperCase()} (${(pd.position * 100).toFixed(0)}%)`;
    zoneEl.style.color = pd.zone === 'discount' ? '#00e676' : pd.zone === 'premium' ? '#ff4444' : '#ffd54f';
  } else if (zoneEl) {
    zoneEl.textContent = '—';
  }

  // INVALIDATION
  const invEl = dom.dbInvalid();
  if (invEl) {
    invEl.textContent = s?.invalidationReason
      ? truncate(s.invalidationReason, 55)
      : 'No active setup — wait for structure confirmation';
  }
}

// ── Intel Tabs — main render ───────────────────────────────────
// Replaces buildCardGrid. All 4 tabs populated inline, zero extra clicks.
function buildIntelTabs(analysis, signal, data) {
  populateTabSetup(analysis, signal, data);
  populateTabStructure(analysis, signal);
  populateTabLevels(analysis, signal);
  populateTabDerivatives(data, analysis, signal);
}

// ────────────────────────────────────────────────────────────────
// TAB 1 · TRADE SETUP
// Entry / SL / TPs + confluence bars + scenarios
// ────────────────────────────────────────────────────────────────
function populateTabSetup(analysis, signal, data) {
  const pane = dom.tabSetup();
  if (!pane) return;
  const s = signal?.setup;

  if (!s) {
    pane.innerHTML = `
      <div class="tab-notice">
        <div class="tab-notice-icon">⏳</div>
        <div class="tab-notice-title">No Setup Generated</div>
        <div class="tab-notice-sub">Confluence is insufficient for a trade setup right now.
        Score: <strong style="color:${signal?.biasColor || '#ffd54f'}">${signal?.normalizedScore || 0}</strong> · Bias: ${signal?.biasLabel || 'NEUTRAL'}<br><br>
        Wait for a BOS/CHoCH, a retest of a fresh Order Block, and a qualifying FVG fill before entering.</div>
      </div>
      ${buildConfluenceBars(signal)}`;
    return;
  }

  const isLong  = s.direction === 'LONG';
  const dirColor = isLong ? '#00e676' : '#ff4444';

  pane.innerHTML = `
    <!-- Direction header -->
    <div class="setup-direction-bar" style="background:${isLong ? 'rgba(0,230,118,0.06)' : 'rgba(255,68,68,0.06)'}; border-color:${dirColor}">
      <span class="setup-dir-label" style="color:${dirColor}">${isLong ? '⬆ LONG' : '⬇ SHORT'}</span>
      <span class="setup-dir-score">Score: <strong style="color:${signal.biasColor}">${signal.normalizedScore > 0 ? '+' : ''}${signal.normalizedScore}</strong></span>
    </div>

    <!-- Level cards: entry / sl / tps -->
    <div class="setup-levels">
      <div class="setup-level entry">
        <div class="level-label">ENTRY</div>
        <div class="level-price">$${formatPrice(s.entry)}</div>
        <div class="level-reason">${s.entryReason}</div>
      </div>
      <div class="setup-level sl">
        <div class="level-label">STOP LOSS</div>
        <div class="level-price">$${formatPrice(s.sl)}</div>
        <div class="level-reason">${s.slReason}</div>
      </div>
      <div class="setup-level tp1">
        <div class="level-label">TP1 — ${s.rr1}R</div>
        <div class="level-price">$${formatPrice(s.tp1)}</div>
        <div class="level-reason">${s.tp1Reason}</div>
      </div>
      <div class="setup-level tp2">
        <div class="level-label">TP2 — ${s.rr2}R</div>
        <div class="level-price">$${formatPrice(s.tp2)}</div>
        <div class="level-reason">${s.tp2Reason}</div>
      </div>
      <div class="setup-level tp3">
        <div class="level-label">TP3 — ${s.rr3}R</div>
        <div class="level-price">$${formatPrice(s.tp3)}</div>
        <div class="level-reason">${s.tp3Reason}</div>
      </div>
    </div>

    <!-- Invalidation -->
    <div class="tab-block">
      <div class="tab-block-label">⚠ INVALIDATION</div>
      <div class="tab-block-body tab-warn-text">${s.invalidationReason}</div>
    </div>

    <!-- Scenarios -->
    <div class="tab-two-col">
      <div class="tab-block">
        <div class="tab-block-label" style="color:#00e676">BULL SCENARIO</div>
        <div class="tab-block-body">${s.bullScenario}</div>
      </div>
      <div class="tab-block">
        <div class="tab-block-label" style="color:#ff4444">BEAR SCENARIO</div>
        <div class="tab-block-body">${s.bearScenario}</div>
      </div>
    </div>

    <!-- Confluence breakdown -->
    <div class="tab-block">
      <div class="tab-block-label">CONFLUENCE BREAKDOWN</div>
      ${buildConfluenceBars(signal)}
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────
// TAB 2 · STRUCTURE & ORDER BLOCKS
// Market structure events + OBs with inline reason
// ────────────────────────────────────────────────────────────────
function populateTabStructure(analysis, signal) {
  const pane = dom.tabStructure();
  if (!pane) return;

  const trend    = analysis.structure?.trend || 'neutral';
  const htf      = analysis.htfStructure?.trend || '—';
  const events   = analysis.structure?.events?.slice(-6).reverse() || [];
  const obs      = analysis.orderBlocks || [];
  const freshOBs = obs.filter(ob => ob.state === 'fresh');
  const divs     = analysis.divs || [];

  const trendColor = trend === 'bull' ? '#00e676' : trend === 'bear' ? '#ff4444' : '#ffd54f';
  const htfColor   = htf   === 'bull' ? '#00e676' : htf   === 'bear' ? '#ff4444' : '#ffd54f';

  pane.innerHTML = `
    <!-- Trend state summary -->
    <div class="tab-two-col">
      <div class="tab-stat-block">
        <div class="tab-stat-label">MTF TREND (${currentTF})</div>
        <div class="tab-stat-value" style="color:${trendColor}">${trend.toUpperCase()}</div>
      </div>
      <div class="tab-stat-block">
        <div class="tab-stat-label">HTF TREND (4H)</div>
        <div class="tab-stat-value" style="color:${htfColor}">${htf.toUpperCase()}</div>
      </div>
    </div>

    <!-- Structure events -->
    <div class="tab-block">
      <div class="tab-block-label">RECENT STRUCTURE EVENTS</div>
      ${events.length
        ? events.map(ev => `
          <div class="tab-event-row">
            <span class="tag ${ev.type === 'CHoCH' ? 'tag-warn' : ev.dir === 'bull' ? 'tag-bull' : 'tag-bear'}">${ev.type}</span>
            <span class="tab-event-dir" style="color:${ev.dir === 'bull' ? '#00e676' : '#ff4444'}">${ev.dir === 'bull' ? '↑ Bullish' : '↓ Bearish'}</span>
            <span class="tab-event-price">$${formatPrice(ev.price)}</span>
          </div>`).join('')
        : '<div class="tab-empty">No structure events detected yet</div>'}
    </div>

    <!-- Fresh Order Blocks -->
    <div class="tab-block">
      <div class="tab-block-label">FRESH ORDER BLOCKS (${freshOBs.length})</div>
      ${freshOBs.length
        ? freshOBs.map(ob => `
          <div class="tab-ob ${ob.type === 'demand' ? 'tab-ob-demand' : 'tab-ob-supply'}">
            <div class="tab-ob-header">
              <span class="tag ${ob.type === 'demand' ? 'tag-bull' : 'tag-bear'}">${ob.type.toUpperCase()}</span>
              <span class="tab-ob-type">${ob.structureType}</span>
              <span class="tab-ob-range">$${formatPrice(ob.low)} – $${formatPrice(ob.high)}</span>
            </div>
            <div class="tab-ob-reason">
              ${ob.type === 'demand'
                ? `Demand zone at $${formatPrice(ob.low)}–$${formatPrice(ob.high)}. Last bearish candle before bullish impulse. Watch for bullish engulf on retest.`
                : `Supply zone at $${formatPrice(ob.low)}–$${formatPrice(ob.high)}. Last bullish candle before bearish impulse. Watch for bearish rejection on retest.`}
            </div>
          </div>`).join('')
        : '<div class="tab-empty">No fresh order blocks in current range</div>'}
    </div>

    <!-- Mitigated OBs summary -->
    ${obs.filter(ob => ob.state === 'mitigated').length
      ? `<div class="tab-block">
          <div class="tab-block-label">MITIGATED OBs — ${obs.filter(ob => ob.state === 'mitigated').length} zones</div>
          <div class="tab-muted-text">These zones have been tapped by price and are no longer active. Price may re-test but reliability is lower.</div>
         </div>`
      : ''}

    <!-- RSI Divergences -->
    <div class="tab-block">
      <div class="tab-block-label">RSI DIVERGENCES</div>
      ${divs.length
        ? divs.map(d => `
          <div class="tab-ob ${d.type === 'bullish' ? 'tab-ob-demand' : 'tab-ob-supply'}">
            <div class="tab-ob-header">
              <span class="tag ${d.type === 'bullish' ? 'tag-bull' : 'tag-bear'}">${d.type.toUpperCase()} DIV</span>
            </div>
            <div class="tab-ob-reason">
              Price at $${formatPrice(d.priceNow)} (${d.priceNow > d.pricePrev ? 'higher high' : 'lower low'}) while RSI moved from ${d.rsiPrev.toFixed(1)} → ${d.rsiNow.toFixed(1)} (${d.rsiNow > d.rsiPrev ? 'higher' : 'lower'}).
              ${d.type === 'bullish' ? 'Hidden buying pressure — momentum building under the surface.' : 'Momentum exhaustion — distribution likely.'}
            </div>
          </div>`).join('')
        : '<div class="tab-empty">No RSI divergences detected in recent candles</div>'}
    </div>

    <!-- Structure confluence reasons -->
    ${buildReasonBlock(signal?.scores?.structure?.reasons, 'STRUCTURE CONFLUENCE')}
  `;
}

// ────────────────────────────────────────────────────────────────
// TAB 3 · LEVELS & FVGs
// Premium/Discount + Fibonacci + FVGs + Liquidation map
// ────────────────────────────────────────────────────────────────
function populateTabLevels(analysis, signal) {
  const pane = dom.tabLevels();
  if (!pane) return;

  const pd  = analysis.premDisc;
  const fvgs = analysis.fvgs || [];
  const liq  = analysis.liqLevels;

  const zoneColor = !pd ? '#ffd54f' : pd.zone === 'discount' ? '#00e676' : pd.zone === 'premium' ? '#ff4444' : '#ffd54f';

  const fibLevels = pd ? [
    { label: 'Range High',        pct: '100%', price: pd.rangeHigh, color: '#ff4444' },
    { label: '70.5%',             pct: '70.5%',price: pd.fib705,    color: '#ff7c7c' },
    { label: '61.8% — Premium',   pct: '61.8%',price: pd.fib618,    color: '#ffa0a0' },
    { label: '50% — Equilibrium', pct: '50.0%',price: pd.fib50,     color: '#ffd54f' },
    { label: '38.2% — Discount',  pct: '38.2%',price: pd.fib382,    color: '#69f0ae' },
    { label: '23.6%',             pct: '23.6%',price: pd.fib236,    color: '#00e676' },
    { label: 'Range Low',         pct: '0%',   price: pd.rangeLow,  color: '#00e676' },
  ] : [];

  pane.innerHTML = `
    <!-- Premium / Discount -->
    <div class="tab-block">
      <div class="tab-block-label">PREMIUM / DISCOUNT ZONE</div>
      ${pd ? `
        <div class="tab-two-col" style="margin-bottom:10px">
          <div class="tab-stat-block">
            <div class="tab-stat-label">CURRENT ZONE</div>
            <div class="tab-stat-value" style="color:${zoneColor}">${pd.zone.toUpperCase()}</div>
          </div>
          <div class="tab-stat-block">
            <div class="tab-stat-label">RANGE POSITION</div>
            <div class="tab-stat-value" style="color:${zoneColor}">${(pd.position * 100).toFixed(1)}%</div>
          </div>
        </div>
        <div class="tab-pd-explain">
          ${pd.zone === 'discount'
            ? '📌 Price is in a DISCOUNT zone (below 50%). Smart money looks to buy here. Favorable for longs if structure confirms.'
            : pd.zone === 'premium'
            ? '📌 Price is in a PREMIUM zone (above 50%). Smart money looks to sell here. Favorable for shorts if structure confirms.'
            : '📌 Price is at EQUILIBRIUM (near 50%). Market is fairly valued — wait for a directional move away from this zone.'}
        </div>` : '<div class="tab-empty">Premium/Discount data unavailable</div>'}
    </div>

    <!-- Fibonacci Levels -->
    ${pd ? `
    <div class="tab-block">
      <div class="tab-block-label">FIBONACCI LEVELS</div>
      <div class="tab-fib-grid">
        ${fibLevels.map(l => `
          <div class="tab-fib-row">
            <span class="tab-fib-pct" style="color:${l.color}">${l.pct}</span>
            <span class="tab-fib-label">${l.label}</span>
            <span class="tab-fib-price">$${formatPrice(l.price)}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Fair Value Gaps -->
    <div class="tab-block">
      <div class="tab-block-label">FAIR VALUE GAPS (${fvgs.length} active)</div>
      ${fvgs.length
        ? fvgs.slice().reverse().map(f => `
          <div class="tab-ob ${f.dir === 'bull' ? 'tab-ob-demand' : 'tab-ob-supply'}">
            <div class="tab-ob-header">
              <span class="tag ${f.dir === 'bull' ? 'tag-bull' : 'tag-bear'}">${f.dir.toUpperCase()} FVG</span>
              <span class="tab-ob-type">${f.size.toFixed(3)}% gap</span>
              <span class="tab-ob-range">$${formatPrice(f.bottom)} – $${formatPrice(f.top)}</span>
            </div>
            <div class="tab-ob-reason">
              ${f.dir === 'bull'
                ? `Bullish imbalance — no trading between $${formatPrice(f.bottom)} and $${formatPrice(f.top)}. Price tends to fill this gap before resuming up.`
                : `Bearish imbalance — no trading between $${formatPrice(f.bottom)} and $${formatPrice(f.top)}. Acts as overhead resistance.`}
            </div>
          </div>`).join('')
        : '<div class="tab-empty">No unfilled FVGs detected in current range</div>'}
    </div>

    <!-- Liquidation Map -->
    ${liq ? `
    <div class="tab-block">
      <div class="tab-block-label">LIQUIDATION MAP</div>
      <div class="tab-explain-text">Estimated leverage liquidation levels based on recent swing high/low. These act as liquidity targets — price often hunts these levels before reversing.</div>
      <div class="tab-liq-grid">
        <div class="tab-liq-col">
          <div class="tab-liq-header" style="color:#ff4444">SHORT LIQUIDATIONS</div>
          ${liq.shortLiqs.map(l => `
            <div class="tab-liq-row">
              <span>${l.label}</span>
              <span style="color:#ff4444">$${formatPrice(l.price)}</span>
              <span class="tab-muted-text">+${((l.price / liq.swingHigh - 1) * 100).toFixed(1)}%</span>
            </div>`).join('')}
        </div>
        <div class="tab-liq-col">
          <div class="tab-liq-header" style="color:#00e676">LONG LIQUIDATIONS</div>
          ${liq.longLiqs.map(l => `
            <div class="tab-liq-row">
              <span>${l.label}</span>
              <span style="color:#00e676">$${formatPrice(l.price)}</span>
              <span class="tab-muted-text">${((l.price / liq.swingLow - 1) * 100).toFixed(1)}%</span>
            </div>`).join('')}
        </div>
      </div>
    </div>` : ''}
  `;
}

// ────────────────────────────────────────────────────────────────
// TAB 4 · DERIVATIVES
// Funding + OI + Taker flow + Order book depth
// ────────────────────────────────────────────────────────────────
function populateTabDerivatives(data, analysis, signal) {
  const pane = dom.tabDerivatives();
  if (!pane) return;

  const t   = data.ticker;
  const fr  = t?.fundingRate || 0;
  const frColor = fr < -0.01 ? '#00e676' : fr > 0.05 ? '#ff4444' : '#8892a0';

  const oiData    = data.oiHistory || [];
  const oiLen     = oiData.length;
  const oiTrend   = oiLen >= 2
    ? oiData[oiLen - 1].oi > oiData[0].oi ? '▲ Rising' : '▼ Falling'
    : '—';
  const oiTrendColor = oiTrend.includes('Rising') ? '#00e676' : '#ff4444';

  const tf  = data.takerFlow;
  const ob  = analysis.obAnalysis;
  const hist = data.fundingHist?.slice(-8) || [];

  const frExplain = fr < -0.05
    ? '🔥 Extremely negative — shorts heavily paying longs. High short squeeze risk. Historically bullish contrarian signal.'
    : fr < -0.01
    ? 'Negative funding — mild bearish sentiment in derivatives. Supportive for spot longs.'
    : fr > 0.1
    ? '⚠ Very high positive funding — longs paying shorts heavily. Overheated — long liquidation risk elevated.'
    : fr > 0.03
    ? 'Elevated positive funding — market leaning long. Watch for leverage flush.'
    : 'Neutral funding rate — no significant derivatives-driven pressure in either direction.';

  pane.innerHTML = `
    <!-- Funding Rate -->
    <div class="tab-two-col">
      <div class="tab-stat-block">
        <div class="tab-stat-label">CURRENT FUNDING</div>
        <div class="tab-stat-value" style="color:${frColor}">${fr.toFixed(4)}%</div>
      </div>
      <div class="tab-stat-block">
        <div class="tab-stat-label">OPEN INTEREST</div>
        <div class="tab-stat-value" style="color:${oiTrendColor}">${oiTrend}</div>
      </div>
    </div>
    <div class="tab-block" style="margin-top:0">
      <div class="tab-explain-text">${frExplain}</div>
    </div>

    <!-- Funding history -->
    <div class="tab-block">
      <div class="tab-block-label">FUNDING RATE HISTORY (last ${hist.length})</div>
      ${hist.length
        ? `<div class="tab-funding-bars">
            ${hist.map(h => {
              const pct = Math.min(Math.abs(h.rate) / 0.1 * 100, 100);
              const col = h.rate < 0 ? '#00e676' : '#ff4444';
              return `<div class="tab-funding-bar-row">
                <span class="tab-funding-date">${new Date(h.time * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' })}</span>
                <div class="tab-funding-bar-wrap">
                  <div class="tab-funding-bar-fill" style="width:${pct}%;background:${col}"></div>
                </div>
                <span class="tab-funding-val" style="color:${col}">${h.rate.toFixed(4)}%</span>
              </div>`;
            }).join('')}
           </div>`
        : '<div class="tab-empty">No funding history available</div>'}
    </div>

    <!-- OI Snapshots -->
    <div class="tab-block">
      <div class="tab-block-label">OPEN INTEREST SNAPSHOTS</div>
      ${oiData.slice(-6).map(o => `
        <div class="tab-event-row">
          <span style="color:#5a6470">${new Date(o.time * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
          <span>${formatLarge(o.oi)}</span>
        </div>`).join('') || '<div class="tab-empty">No OI history available</div>'}
    </div>

    <!-- Taker Flow -->
    ${tf ? `
    <div class="tab-block">
      <div class="tab-block-label">TAKER FLOW BIAS</div>
      <div class="depth-bar-wrap">
        <div class="depth-bid" style="width:${(tf.buyRatio * 100).toFixed(1)}%">Buy ${(tf.buyRatio * 100).toFixed(0)}%</div>
        <div class="depth-ask" style="width:${(tf.sellRatio * 100).toFixed(1)}%">Sell ${(tf.sellRatio * 100).toFixed(0)}%</div>
      </div>
      <div class="tab-event-row" style="margin-top:6px">
        <span>Net taker bias</span>
        <span style="color:${tf.takerBias > 0 ? '#00e676' : '#ff4444'}">${tf.takerBias > 0 ? '+' : ''}${tf.takerBias.toFixed(1)}% net ${tf.takerBias > 0 ? 'buy' : 'sell'}</span>
      </div>
    </div>` : ''}

    <!-- Order Book Depth -->
    ${ob ? `
    <div class="tab-block">
      <div class="tab-block-label">ORDER BOOK DEPTH — ${ob.bias.toUpperCase()}</div>
      <div class="depth-bar-wrap">
        <div class="depth-bid" style="width:${(ob.bidAskRatio * 100).toFixed(1)}%">Bids ${(ob.bidAskRatio * 100).toFixed(0)}%</div>
        <div class="depth-ask" style="width:${((1 - ob.bidAskRatio) * 100).toFixed(1)}%">Asks ${((1 - ob.bidAskRatio) * 100).toFixed(0)}%</div>
      </div>
      <div class="tab-two-col" style="margin-top:8px">
        <div class="tab-block" style="margin-bottom:0">
          <div class="tab-block-label" style="color:#00e676">BID WALLS (${ob.bidWalls.length})</div>
          ${ob.bidWalls.slice(0,4).map(w => `
            <div class="tab-event-row">
              <span>$${formatPrice(w.price)}</span>
              <span style="color:#00e676">${w.size.toFixed(1)}</span>
            </div>`).join('') || '<span class="tab-muted-text">None detected</span>'}
        </div>
        <div class="tab-block" style="margin-bottom:0">
          <div class="tab-block-label" style="color:#ff4444">ASK WALLS (${ob.askWalls.length})</div>
          ${ob.askWalls.slice(0,4).map(w => `
            <div class="tab-event-row">
              <span>$${formatPrice(w.price)}</span>
              <span style="color:#ff4444">${w.size.toFixed(1)}</span>
            </div>`).join('') || '<span class="tab-muted-text">None detected</span>'}
        </div>
      </div>
    </div>` : ''}

    ${buildReasonBlock(signal?.scores?.derivatives?.reasons, 'DERIVATIVES CONFLUENCE')}
  `;
}

// ── Shared sub-components ──────────────────────────────────────
function buildConfluenceBars(signal) {
  if (!signal?.scores) return '<div class="tab-empty">No confluence data</div>';
  return `
    <div class="confluence-bars">
      ${Object.entries(signal.scores).map(([k, s]) => `
        <div class="conf-bar-row">
          <span class="conf-label">${k}</span>
          <div class="conf-bar-wrap">
            <div class="conf-bar-fill" style="width:${Math.abs(s.score / 2) * 100}%;background:${s.score > 0 ? '#00e676' : s.score < 0 ? '#ff4444' : '#5a6470'}"></div>
          </div>
          <span class="conf-score" style="color:${s.score > 0 ? '#00e676' : s.score < 0 ? '#ff4444' : '#5a6470'}">${s.score > 0 ? '+' : ''}${s.score.toFixed(1)}</span>
        </div>`).join('')}
    </div>`;
}

function buildReasonBlock(reasons, label) {
  if (!reasons?.length) return '';
  return `
    <div class="tab-block">
      <div class="tab-block-label">${label}</div>
      ${reasons.map(r => `<div class="drawer-reason">▸ ${r}</div>`).join('')}
    </div>`;
}

// ── Drawer System (still available — click from tabs if needed) ─
function openDrawer(type) {
  const panel   = dom.drawerPanel();
  const title   = dom.drawerTitle();
  const content = dom.drawerContent();
  if (!panel || !title || !content) return;
  const { html, titleText } = buildDrawerContent(type, analysis, signal, rawData);
  title.textContent = titleText;
  content.innerHTML = html;
  panel.classList.add('open');
}
function closeDrawer() {
  dom.drawerPanel()?.classList.remove('open');
}
function buildDrawerContent(type, analysis, signal, data) {
  switch (type) {
    case 'structure':   return drawerStructure(analysis);
    case 'orderblocks': return drawerOrderBlocks(analysis);
    case 'fvg':         return drawerFVG(analysis);
    case 'premdisc':    return drawerPremDisc(analysis);
    case 'derivatives': return drawerDerivatives(data, analysis);
    case 'liquidation': return drawerLiquidation(analysis);
    case 'setup':       return drawerSetup(signal, analysis);
    case 'rsi':         return drawerRSI(analysis);
    case 'orderbook':   return drawerOrderBook(analysis);
    default:            return { html: '<p>No content</p>', titleText: type };
  }
}

function drawerStructure(analysis) {
  const { structure, htfStructure } = analysis;
  const events = structure?.events?.slice(-8).reverse() || [];
  const rows = events.map(ev => `
    <div class="drawer-row">
      <span class="tag ${ev.type === 'CHoCH' ? 'tag-warn' : ev.dir === 'bull' ? 'tag-bull' : 'tag-bear'}">${ev.type}</span>
      <span>${ev.dir === 'bull' ? '↑ Bullish' : '↓ Bearish'}</span>
      <span>$${formatPrice(ev.price)}</span>
    </div>`).join('');
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
      ${rows || '<div class="drawer-empty">No events detected</div>'}
    </div>
    ${buildReasonBlock(signal?.scores?.structure?.reasons, 'STRUCTURE CONFLUENCE')}`,
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
      <div class="ob-levels"><span>High: $${formatPrice(ob.high)}</span><span>Low: $${formatPrice(ob.low)}</span><span>${((ob.high - ob.low) / ob.low * 100).toFixed(2)}%</span></div>
      <div class="ob-reason">${ob.type === 'demand' ? `Demand zone $${formatPrice(ob.low)}–$${formatPrice(ob.high)}. Institutional buying expected on retest.` : `Supply zone $${formatPrice(ob.low)}–$${formatPrice(ob.high)}. Institutional selling expected on retest.`}</div>
    </div>`).join('');
  return {
    titleText: '🧱 Order Blocks',
    html: `<div class="drawer-section"><div class="drawer-label">ORDER BLOCKS (${obs.length})</div>${rows || '<div class="drawer-empty">None detected</div>'}</div>`,
  };
}
function drawerFVG(analysis) {
  const fvgs = analysis.fvgs;
  const rows = fvgs.slice().reverse().map(f => `
    <div class="drawer-ob ${f.dir === 'bull' ? 'ob-demand' : 'ob-supply'}">
      <div class="ob-header"><span class="tag ${f.dir === 'bull' ? 'tag-bull' : 'tag-bear'}">${f.dir.toUpperCase()} FVG</span><span>${f.size.toFixed(3)}%</span></div>
      <div class="ob-levels"><span>Top: $${formatPrice(f.top)}</span><span>Bottom: $${formatPrice(f.bottom)}</span><span>Mid: $${formatPrice(f.mid)}</span></div>
      <div class="ob-reason">${f.dir === 'bull' ? `Bullish imbalance — magnet for price to fill $${formatPrice(f.bottom)}–$${formatPrice(f.top)}.` : `Bearish imbalance — overhead resistance at $${formatPrice(f.bottom)}–$${formatPrice(f.top)}.`}</div>
    </div>`).join('');
  return { titleText: '📐 Fair Value Gaps', html: `<div class="drawer-section"><div class="drawer-label">ACTIVE FVGs (${fvgs.length})</div>${rows || '<div class="drawer-empty">None</div>'}</div>` };
}
function drawerPremDisc(analysis) {
  const pd = analysis.premDisc;
  if (!pd) return { titleText: 'Premium / Discount', html: '<p>No data</p>' };
  const zoneColor = pd.zone === 'discount' ? '#00e676' : pd.zone === 'premium' ? '#ff4444' : '#ffd54f';
  const levels = [
    { label: 'Range High (100%)', price: pd.rangeHigh, color: '#ff4444' },
    { label: '70.5%',             price: pd.fib705,    color: '#ff7c7c' },
    { label: '61.8% (Premium)',   price: pd.fib618,    color: '#ffa0a0' },
    { label: '50% (EQ)',          price: pd.fib50,     color: '#ffd54f' },
    { label: '38.2% (Discount)',  price: pd.fib382,    color: '#69f0ae' },
    { label: '23.6%',             price: pd.fib236,    color: '#00e676' },
    { label: 'Range Low (0%)',    price: pd.rangeLow,  color: '#00e676' },
  ];
  return {
    titleText: '🎯 Premium / Discount',
    html: `
    <div class="drawer-section"><div class="drawer-label">ZONE</div><div class="drawer-big" style="color:${zoneColor}">${pd.zone.toUpperCase()}</div><div class="drawer-sub">${(pd.position * 100).toFixed(1)}% of range</div></div>
    <div class="drawer-section"><div class="drawer-label">FIBONACCI LEVELS</div>${levels.map(l => `<div class="drawer-row"><span style="color:${l.color}">${l.label}</span><span>$${formatPrice(l.price)}</span></div>`).join('')}</div>`,
  };
}
function drawerDerivatives(data, analysis) {
  const t = data.ticker;
  const fr = t?.fundingRate || 0;
  const hist = data.fundingHist?.slice(-10) || [];
  const oiData = data.oiHistory?.slice(-8) || [];
  return {
    titleText: '📡 Derivatives Intelligence',
    html: `
    <div class="drawer-section"><div class="drawer-label">FUNDING RATE</div><div class="drawer-big" style="color:${fr < -0.01 ? '#00e676' : fr > 0.05 ? '#ff4444' : '#ffd54f'}">${fr.toFixed(4)}%</div></div>
    <div class="drawer-section"><div class="drawer-label">FUNDING HISTORY</div>${hist.map(h => `<div class="drawer-row"><span>${new Date(h.time * 1000).toLocaleDateString()}</span><span style="color:${h.rate < 0 ? '#00e676' : '#ff4444'}">${h.rate.toFixed(4)}%</span></div>`).join('')}</div>
    <div class="drawer-section"><div class="drawer-label">OI SNAPSHOTS</div>${oiData.map(o => `<div class="drawer-row"><span>${new Date(o.time * 1000).toLocaleTimeString()}</span><span>${formatLarge(o.oi)}</span></div>`).join('')}</div>`,
  };
}
function drawerLiquidation(analysis) {
  const liq = analysis.liqLevels;
  return {
    titleText: '💥 Liquidation Map',
    html: `
    <div class="drawer-section"><div class="drawer-label">SHORT LIQUIDATIONS</div>${liq.shortLiqs.map(l => `<div class="drawer-row"><span style="color:#ff4444">${l.label}</span><span>$${formatPrice(l.price)}</span><span style="color:#5a6470">+${((l.price / liq.swingHigh - 1) * 100).toFixed(1)}%</span></div>`).join('')}</div>
    <div class="drawer-section"><div class="drawer-label">LONG LIQUIDATIONS</div>${liq.longLiqs.map(l => `<div class="drawer-row"><span style="color:#00e676">${l.label}</span><span>$${formatPrice(l.price)}</span><span style="color:#5a6470">${((l.price / liq.swingLow - 1) * 100).toFixed(1)}%</span></div>`).join('')}</div>`,
  };
}
function drawerSetup(signal, analysis) {
  if (!signal?.setup) return { titleText: 'Trade Setup', html: '<div class="drawer-empty">No setup — confluence insufficient.</div>' };
  const s = signal.setup;
  const isLong = s.direction === 'LONG';
  return {
    titleText: `${isLong ? '⬆' : '⬇'} ${s.direction} Setup`,
    html: `
    <div class="setup-grid">
      <div class="setup-level entry"><div class="level-label">ENTRY</div><div class="level-price">$${formatPrice(s.entry)}</div><div class="level-reason">${s.entryReason}</div></div>
      <div class="setup-level sl"><div class="level-label">STOP LOSS</div><div class="level-price">$${formatPrice(s.sl)}</div><div class="level-reason">${s.slReason}</div></div>
      <div class="setup-level tp1"><div class="level-label">TP1 — ${s.rr1}R</div><div class="level-price">$${formatPrice(s.tp1)}</div><div class="level-reason">${s.tp1Reason}</div></div>
      <div class="setup-level tp2"><div class="level-label">TP2 — ${s.rr2}R</div><div class="level-price">$${formatPrice(s.tp2)}</div><div class="level-reason">${s.tp2Reason}</div></div>
      <div class="setup-level tp3"><div class="level-label">TP3 — ${s.rr3}R</div><div class="level-price">$${formatPrice(s.tp3)}</div><div class="level-reason">${s.tp3Reason}</div></div>
    </div>
    <div class="drawer-section"><div class="drawer-label">INVALIDATION</div><div class="drawer-reason" style="color:#ff9090">⚠ ${s.invalidationReason}</div></div>
    <div class="drawer-section"><div class="drawer-label">CONFLUENCE</div>${buildConfluenceBars(signal)}</div>`,
  };
}
function drawerRSI(analysis) {
  const rsi = analysis.lastRSI;
  const divs = analysis.divs;
  return {
    titleText: '📊 RSI + MACD',
    html: `
    <div class="drawer-section"><div class="drawer-label">RSI (14)</div><div class="drawer-big" style="color:${rsi > 70 ? '#ff4444' : rsi < 30 ? '#00e676' : '#a78bfa'}">${rsi?.toFixed(2) || '—'}</div></div>
    <div class="drawer-section"><div class="drawer-label">MACD</div>
      <div class="drawer-row"><span>MACD Line</span><span style="color:#00bfff">${analysis.lastMACD.line?.toFixed(4) || '—'}</span></div>
      <div class="drawer-row"><span>Signal</span><span style="color:#ff7c7c">${analysis.lastMACD.signal?.toFixed(4) || '—'}</span></div>
      <div class="drawer-row"><span>Histogram</span><span style="color:${analysis.lastMACD.histogram > 0 ? '#00e676' : '#ff4444'}">${analysis.lastMACD.histogram?.toFixed(4) || '—'}</span></div>
    </div>
    <div class="drawer-section"><div class="drawer-label">DIVERGENCES</div>${divs.length ? divs.map(d => `<div class="drawer-reason">▸ ${d.type.toUpperCase()} — RSI ${d.rsiPrev.toFixed(1)} → ${d.rsiNow.toFixed(1)}</div>`).join('') : '<div class="drawer-empty">None detected</div>'}</div>`,
  };
}
function drawerOrderBook(analysis) {
  const ob = analysis.obAnalysis;
  if (!ob) return { titleText: 'Order Book', html: '<div class="drawer-empty">No data</div>' };
  return {
    titleText: '📖 Order Book',
    html: `
    <div class="drawer-section">
      <div class="depth-bar-wrap">
        <div class="depth-bid" style="width:${(ob.bidAskRatio*100).toFixed(1)}%">Bids ${(ob.bidAskRatio*100).toFixed(0)}%</div>
        <div class="depth-ask" style="width:${((1-ob.bidAskRatio)*100).toFixed(1)}%">Asks ${((1-ob.bidAskRatio)*100).toFixed(0)}%</div>
      </div>
    </div>
    <div class="drawer-section"><div class="drawer-label">BID WALLS</div>${ob.bidWalls.slice(0,5).map(w=>`<div class="drawer-row"><span>$${formatPrice(w.price)}</span><span style="color:#00e676">${w.size.toFixed(1)}</span></div>`).join('')||'<div class="drawer-empty">None</div>'}</div>
    <div class="drawer-section"><div class="drawer-label">ASK WALLS</div>${ob.askWalls.slice(0,5).map(w=>`<div class="drawer-row"><span>$${formatPrice(w.price)}</span><span style="color:#ff4444">${w.size.toFixed(1)}</span></div>`).join('')||'<div class="drawer-empty">None</div>'}</div>`,
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
function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
function updateLastUpdated() {
  const el = dom.lastUpdated();
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ── Tab switching ──────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.intel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.intel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.intel-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = document.getElementById(`tab-${tab.dataset.tab}`);
      if (pane) pane.classList.add('active');
    });
  });
}

// ── Boot ───────────────────────────────────────────────────────
function boot() {
  const chartEl = dom.chartContainer();
  const rsiEl   = dom.rsiContainer();
  const macdEl  = dom.macdContainer();

  if (chartEl) { initChart(chartEl); setupOverlayCanvas(chartEl); }
  if (rsiEl)   initRSIChart(rsiEl);
  if (macdEl)  initMACDChart(macdEl);

  initTabs();

  // Search
  const input = dom.searchInput();
  const btn   = dom.searchBtn();
  if (btn)   btn.addEventListener('click',  () => analyze(input?.value || ''));
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') analyze(input.value); });

  // TF buttons
  dom.tfButtons().forEach(b => {
    b.addEventListener('click', () => {
      dom.tfButtons().forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentTF = b.dataset.tf;
      if (currentSymbol) analyze(currentSymbol, currentTF);
    });
  });

  // Drawer
  dom.drawerClose()?.addEventListener('click', closeDrawer);
  dom.drawerPanel()?.addEventListener('click', e => { if (e.target === dom.drawerPanel()) closeDrawer(); });

  // Manual refresh only — NO auto-refresh timer
  dom.refreshBtn()?.addEventListener('click', () => {
    const sym = currentSymbol || dom.searchInput()?.value || '';
    if (sym) analyze(sym);
    else showError('Enter a symbol first');
  });

  // Expose for console debugging only
  window.__atl = { analyze, openDrawer };
}

window.addEventListener('DOMContentLoaded', boot);
export { analyze, formatPrice, formatLarge };
