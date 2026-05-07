// ATL Ticker Analyzer — Chart & Visualization Module
// Uses TradingView Lightweight Charts for candles + custom canvas for SMC overlays

let chart = null, candleSeries = null, volumeSeries = null;
let rsiChart = null, rsiSeries = null;
let macdChart = null, macdHistSeries = null, macdLineSeries = null, macdSignalSeries = null;
let overlayCanvas = null, overlayCtx = null;
let currentAnalysis = null;

// ── Init Main Chart ─────────────────────────────────────────
function initChart(container) {
  container.innerHTML = '';

  chart = LightweightCharts.createChart(container, {
    layout: {
      background:   { color: '#080b0f' },
      textColor:    '#5a6470',
      fontSize:     11,
      fontFamily:   "'Share Tech Mono', monospace",
    },
    grid: {
      vertLines:   { color: 'rgba(255,255,255,0.04)' },
      horzLines:   { color: 'rgba(255,255,255,0.04)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(0,230,118,0.3)', labelBackgroundColor: '#0d1117' },
      horzLine: { color: 'rgba(0,230,118,0.3)', labelBackgroundColor: '#0d1117' },
    },
    rightPriceScale: {
      borderColor:   'rgba(255,255,255,0.07)',
      scaleMargins:  { top: 0.06, bottom: 0.06 },
    },
    timeScale: {
      borderColor:     'rgba(255,255,255,0.07)',
      timeVisible:     true,
      secondsVisible:  false,
    },
    width:  container.offsetWidth,
    height: container.offsetHeight || 420,
  });

  candleSeries = chart.addCandlestickSeries({
    upColor:        '#00e676',
    downColor:      '#ff4444',
    borderUpColor:  '#00e676',
    borderDownColor:'#ff4444',
    wickUpColor:    '#00e676',
    wickDownColor:  '#ff4444',
  });

  volumeSeries = chart.addHistogramSeries({
    color:    'rgba(0,230,118,0.12)',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: container.offsetWidth, height: container.offsetHeight || 420 });
    if (overlayCanvas) {
      overlayCanvas.width  = container.offsetWidth;
      overlayCanvas.height = container.offsetHeight || 420;
      redrawOverlay();
    }
  });
  ro.observe(container);

  return chart;
}

// ── Load Candles ────────────────────────────────────────────
function loadCandles(candles) {
  if (!candleSeries || !candles.length) return;
  candleSeries.setData(candles);
  volumeSeries.setData(candles.map(c => ({
    time:  c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(0,230,118,0.15)' : 'rgba(255,68,68,0.12)',
  })));
  chart.timeScale().fitContent();
}

// ── EMA Lines ───────────────────────────────────────────────
let ema20Series = null, ema50Series = null, ema200Series = null;
function drawEMAs(candles, emas) {
  if (ema20Series)  { chart.removeSeries(ema20Series);  ema20Series  = null; }
  if (ema50Series)  { chart.removeSeries(ema50Series);  ema50Series  = null; }
  if (ema200Series) { chart.removeSeries(ema200Series); ema200Series = null; }

  ema20Series = chart.addLineSeries({ color: 'rgba(0,230,118,0.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ema50Series = chart.addLineSeries({ color: 'rgba(255,213,79,0.6)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ema200Series = chart.addLineSeries({ color: 'rgba(255,68,68,0.6)', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });

  const toSeries = (arr) => candles
    .map((c, i) => arr[i] != null ? { time: c.time, value: arr[i] } : null)
    .filter(Boolean);

  ema20Series.setData(toSeries(emas.ema20));
  ema50Series.setData(toSeries(emas.ema50));
  ema200Series.setData(toSeries(emas.ema200));
}

// ── SMC Overlay — Order Blocks, FVGs, Structure ────────────
function setupOverlayCanvas(container) {
  overlayCanvas = document.createElement('canvas');
  overlayCanvas.style.cssText = `
    position: absolute; top: 0; left: 0; pointer-events: none;
    width: 100%; height: 100%; z-index: 5;
  `;
  container.style.position = 'relative';
  container.appendChild(overlayCanvas);
  overlayCtx = overlayCanvas.getContext('2d');
  overlayCanvas.width  = container.offsetWidth;
  overlayCanvas.height = container.offsetHeight || 420;
}

function getCoords(time, price) {
  if (!chart) return null;
  try {
    const x = chart.timeScale().timeToCoordinate(time);
    const y = candleSeries.priceToCoordinate(price);
    return (x !== null && y !== null) ? { x, y } : null;
  } catch { return null; }
}

function redrawOverlay() {
  if (!overlayCtx || !currentAnalysis) return;
  const ctx = overlayCtx;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const { orderBlocks, fvgs, structure, premDisc, liqZones } = currentAnalysis;
  const candles = currentAnalysis.candles;
  if (!candles || !candles.length) return;

  const timeStart = candles[0].time;
  const timeEnd   = candles[candles.length - 1].time;
  const futureEnd = timeEnd + (timeEnd - candles[candles.length - 3].time) * 10;

  // ── Order Blocks ──────────────────────────────────────
  for (const ob of orderBlocks) {
    const topCoord = getCoords(candles[Math.min(ob.idx + 1, candles.length - 1)].time, ob.high);
    const botCoord = getCoords(candles[Math.min(ob.idx + 1, candles.length - 1)].time, ob.low);
    const rightCoord = getCoords(timeEnd, ob.low);
    if (!topCoord || !botCoord || !rightCoord) continue;

    const x = topCoord.x;
    const yTop = topCoord.y;
    const yBot = botCoord.y;
    const xRight = rightCoord.x;
    const h = Math.max(yBot - yTop, 2);

    const alpha = ob.state === 'fresh' ? 0.18 : ob.state === 'tested' ? 0.12 : 0.05;
    const border = ob.state === 'fresh' ? 0.7 : 0.3;
    const color  = ob.type === 'demand'
      ? `rgba(0,230,118,${alpha})`
      : `rgba(255,68,68,${alpha})`;
    const borderColor = ob.type === 'demand'
      ? `rgba(0,230,118,${border})`
      : `rgba(255,68,68,${border})`;

    ctx.fillStyle = color;
    ctx.fillRect(x, yTop, xRight - x, h);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, yTop, xRight - x, h);

    // Label
    ctx.fillStyle = ob.type === 'demand' ? 'rgba(0,230,118,0.85)' : 'rgba(255,68,68,0.85)';
    ctx.font = '10px "Share Tech Mono"';
    ctx.fillText(`${ob.type === 'demand' ? 'DEMAND OB' : 'SUPPLY OB'} [${ob.structureType}]`, x + 4, yTop + 12);
  }

  // ── FVGs ──────────────────────────────────────────────
  for (const fvg of fvgs) {
    const topCoord = getCoords(candles[Math.min(fvg.idx + 1, candles.length - 1)].time, fvg.top);
    const botCoord = getCoords(candles[Math.min(fvg.idx + 1, candles.length - 1)].time, fvg.bottom);
    const rightCoord = getCoords(timeEnd, fvg.bottom);
    if (!topCoord || !botCoord || !rightCoord) continue;

    const h = Math.max(Math.abs(botCoord.y - topCoord.y), 2);
    const yTop = Math.min(topCoord.y, botCoord.y);

    const color = fvg.dir === 'bull'
      ? 'rgba(0,230,118,0.08)'
      : 'rgba(255,68,68,0.08)';
    const borderColor = fvg.dir === 'bull'
      ? 'rgba(0,230,118,0.35)'
      : 'rgba(255,68,68,0.35)';

    ctx.fillStyle = color;
    ctx.fillRect(topCoord.x, yTop, rightCoord.x - topCoord.x, h);

    // Dashed border
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(topCoord.x, yTop, rightCoord.x - topCoord.x, h);
    ctx.setLineDash([]);

    ctx.fillStyle = fvg.dir === 'bull' ? 'rgba(0,230,118,0.7)' : 'rgba(255,68,68,0.7)';
    ctx.font = '9px "Share Tech Mono"';
    ctx.fillText(`FVG ${fvg.dir.toUpperCase()}`, topCoord.x + 3, yTop + 10);
  }

  // ── Premium/Discount Zones ────────────────────────────
  if (premDisc && candles.length > 2) {
    const leftCoord  = getCoords(candles[Math.max(0, candles.length - 100)].time, premDisc.rangeHigh);
    const rightCoord = getCoords(timeEnd, premDisc.rangeHigh);
    if (leftCoord && rightCoord) {
      // Equilibrium band
      const eqTop = getCoords(timeEnd, premDisc.fib618);
      const eqBot = getCoords(timeEnd, premDisc.fib382);
      const leftEq = getCoords(candles[Math.max(0, candles.length - 100)].time, premDisc.fib618);

      if (eqTop && eqBot && leftEq) {
        ctx.fillStyle = 'rgba(255,213,79,0.05)';
        const h = Math.abs(eqBot.y - eqTop.y);
        ctx.fillRect(leftEq.x, Math.min(eqTop.y, eqBot.y), rightCoord.x - leftEq.x, h);

        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255,213,79,0.4)';
        ctx.lineWidth = 1;
        // 50% line
        const coord50 = getCoords(timeEnd, premDisc.fib50);
        const coordL50 = getCoords(candles[Math.max(0, candles.length - 100)].time, premDisc.fib50);
        if (coord50 && coordL50) {
          ctx.beginPath();
          ctx.moveTo(coordL50.x, coord50.y);
          ctx.lineTo(coord50.x, coord50.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255,213,79,0.6)';
        ctx.font = '9px "Share Tech Mono"';
        ctx.fillText('EQ 50%', rightCoord.x - 50, Math.min(eqTop.y, eqBot.y) + 12);
      }
    }
  }

  // ── BOS/CHoCH Labels ─────────────────────────────────
  for (const ev of (structure?.events || []).slice(-6)) {
    const c = candles[ev.idx];
    if (!c) continue;
    const coord = getCoords(c.time, ev.price);
    if (!coord) continue;

    const isChoch = ev.type === 'CHoCH';
    const isBull  = ev.dir === 'bull';
    ctx.fillStyle = isChoch
      ? (isBull ? 'rgba(0,230,118,0.9)' : 'rgba(255,68,68,0.9)')
      : (isBull ? 'rgba(0,191,255,0.9)' : 'rgba(255,165,0,0.9)');

    ctx.font = `bold 9px "Share Tech Mono"`;
    const label = ev.type;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = isBull ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.5)';
    ctx.fillRect(coord.x - tw / 2 - 3, coord.y - 10, tw + 6, 14);

    ctx.fillStyle = isChoch
      ? (isBull ? '#00e676' : '#ff4444')
      : (isBull ? '#00bfff' : '#ffa500');
    ctx.textAlign = 'center';
    ctx.fillText(label, coord.x, coord.y);
    ctx.textAlign = 'left';
  }
}

// ── RSI Sub-chart ────────────────────────────────────────────
function initRSIChart(container) {
  container.innerHTML = '';
  rsiChart = LightweightCharts.createChart(container, {
    layout:     { background: { color: '#080b0f' }, textColor: '#5a6470', fontSize: 10, fontFamily: "'Share Tech Mono', monospace" },
    grid:       { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale:  { borderColor: 'rgba(255,255,255,0.07)', timeVisible: false },
    width:      container.offsetWidth,
    height:     container.offsetHeight || 100,
    crosshair:  { mode: LightweightCharts.CrosshairMode.Normal },
  });

  rsiSeries = rsiChart.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });

  // OB / OS lines
  rsiChart.addLineSeries({ color: 'rgba(255,68,68,0.4)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    .setData([{ time: 1, value: 70 }]);
  rsiChart.addLineSeries({ color: 'rgba(0,230,118,0.4)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    .setData([{ time: 1, value: 30 }]);

  const ro = new ResizeObserver(() => rsiChart.applyOptions({ width: container.offsetWidth }));
  ro.observe(container);
}

function loadRSI(candles, rsiValues) {
  if (!rsiSeries) return;
  const data = candles.map((c, i) => rsiValues[i] != null ? { time: c.time, value: rsiValues[i] } : null).filter(Boolean);

  // Baseline lines at 30 and 70
  const ob30 = data.map(d => ({ time: d.time, value: 30 }));
  const ob70 = data.map(d => ({ time: d.time, value: 70 }));

  const series70 = rsiChart.addLineSeries({ color: 'rgba(255,68,68,0.25)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  const series30 = rsiChart.addLineSeries({ color: 'rgba(0,230,118,0.25)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  series70.setData(ob70);
  series30.setData(ob30);

  rsiSeries.setData(data);
  rsiChart.timeScale().fitContent();
}

// ── MACD Sub-chart ───────────────────────────────────────────
function initMACDChart(container) {
  container.innerHTML = '';
  macdChart = LightweightCharts.createChart(container, {
    layout:     { background: { color: '#080b0f' }, textColor: '#5a6470', fontSize: 10, fontFamily: "'Share Tech Mono', monospace" },
    grid:       { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)' },
    timeScale:  { borderColor: 'rgba(255,255,255,0.07)', timeVisible: false },
    width:      container.offsetWidth,
    height:     container.offsetHeight || 100,
    crosshair:  { mode: LightweightCharts.CrosshairMode.Normal },
  });

  macdHistSeries   = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
  macdLineSeries   = macdChart.addLineSeries({ color: '#00bfff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
  macdSignalSeries = macdChart.addLineSeries({ color: '#ff7c7c', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

  const ro = new ResizeObserver(() => macdChart.applyOptions({ width: container.offsetWidth }));
  ro.observe(container);
}

function loadMACD(candles, macdData) {
  if (!macdHistSeries) return;
  const { macdLine, signalLine, histogram } = macdData;

  macdHistSeries.setData(candles.map((c, i) => ({
    time:  c.time,
    value: histogram[i] || 0,
    color: histogram[i] >= 0 ? 'rgba(0,230,118,0.55)' : 'rgba(255,68,68,0.55)',
  })));
  macdLineSeries.setData(candles.map((c, i) => ({ time: c.time, value: macdLine[i] || 0 })));
  macdSignalSeries.setData(candles.map((c, i) => ({ time: c.time, value: signalLine[i] || 0 })));
  macdChart.timeScale().fitContent();
}

// ── Volume Profile Sidebar ────────────────────────────────────
function drawVolumeProfile(container, volProfile) {
  if (!container || !volProfile) return;
  container.innerHTML = '';

  const maxVol = Math.max(...volProfile.map(p => p.vol));
  const h = container.offsetHeight || 420;
  const w = container.offsetWidth  || 60;
  const binH = h / volProfile.length;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < volProfile.length; i++) {
    const p = volProfile[volProfile.length - 1 - i];
    const barW = (p.vol / maxVol) * (w - 4);
    const isPOC = p.isPOC;

    ctx.fillStyle = isPOC
      ? 'rgba(255,213,79,0.7)'
      : p.vol / maxVol > 0.6
        ? 'rgba(0,230,118,0.35)'
        : 'rgba(0,230,118,0.15)';
    ctx.fillRect(0, i * binH, barW, binH - 1);

    if (isPOC) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, i * binH, barW, binH - 1);
    }
  }
}

// ── Funding Rate Mini-chart ────────────────────────────────────
function drawFundingChart(container, fundingHist) {
  if (!container || !fundingHist.length) return;
  container.innerHTML = '';

  const w = container.offsetWidth || 300;
  const h = container.offsetHeight || 60;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const rates = fundingHist.map(f => f.rate);
  const maxAbs = Math.max(...rates.map(Math.abs), 0.01);
  const zeroY  = h * 0.5;
  const barW   = (w - 20) / rates.length;

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();

  rates.forEach((r, i) => {
    const barH = (r / maxAbs) * (h / 2 - 4);
    const x = 10 + i * barW;
    const y = zeroY - Math.max(barH, 0);
    const ah = Math.abs(barH);

    ctx.fillStyle = r >= 0 ? 'rgba(255,68,68,0.7)' : 'rgba(0,230,118,0.7)';
    ctx.fillRect(x, r >= 0 ? zeroY - ah : zeroY, barW - 2, ah || 1);
  });
}

// ── OI Chart ───────────────────────────────────────────────────
function drawOIChart(container, oiHistory) {
  if (!container || !oiHistory.length) return;
  container.innerHTML = '';

  const w = container.offsetWidth || 300;
  const h = container.offsetHeight || 60;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const vals = oiHistory.map(o => o.oi);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const rng  = max - min || 1;

  ctx.strokeStyle = '#00bfff';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  vals.forEach((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 20) + 10;
    const y = h - ((v - min) / rng) * (h - 10) - 5;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill
  ctx.lineTo(w - 10, h); ctx.lineTo(10, h); ctx.closePath();
  ctx.fillStyle = 'rgba(0,191,255,0.08)';
  ctx.fill();
}

// ── Liquidation Level Overlay (on orderBook viz) ───────────────
function drawLiquidationBar(container, liqLevels, currentPrice) {
  if (!container || !liqLevels) return;
  container.innerHTML = '';

  const { shortLiqs, longLiqs, swingHigh, swingLow } = liqLevels;
  const allPrices = [...shortLiqs, ...longLiqs].map(l => l.price);
  const minP = Math.min(...allPrices, swingLow * 0.95);
  const maxP = Math.max(...allPrices, swingHigh * 1.05);
  const rng  = maxP - minP;

  const w = container.offsetWidth || 300;
  const h = 200;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.font = '9px "Share Tech Mono"';

  const toY = price => h - ((price - minP) / rng) * h;

  // Current price line
  const cpY = toY(currentPrice);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(0, cpY); ctx.lineTo(w, cpY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.fillText(`$${currentPrice.toLocaleString()}`, w - 70, cpY - 3);

  // Short liq lines (above)
  for (const liq of shortLiqs) {
    const y = toY(liq.price);
    ctx.strokeStyle = `rgba(255,68,68,0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w * 0.6, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,68,68,0.8)';
    ctx.fillText(`${liq.leverage} $${liq.price.toLocaleString()}`, w * 0.62, y + 3);
  }

  // Long liq lines (below)
  for (const liq of longLiqs) {
    const y = toY(liq.price);
    ctx.strokeStyle = `rgba(0,230,118,0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w * 0.6, y); ctx.stroke();
    ctx.fillStyle = 'rgba(0,230,118,0.8)';
    ctx.fillText(`${liq.leverage} $${liq.price.toLocaleString()}`, w * 0.62, y + 3);
  }
}

// ── Full Render Pass ──────────────────────────────────────────
function renderAll(analysis, data, chartEl, rsiEl, macdEl, volEl, fundingEl, oiEl, liqEl) {
  currentAnalysis = analysis;

  // Candles + EMAs
  loadCandles(analysis.candles);
  drawEMAs(analysis.candles, analysis.emas);

  // Overlay (after slight delay for chart to settle)
  setTimeout(() => redrawOverlay(), 200);

  // Sub-panels
  loadRSI(analysis.candles, analysis.rsi);
  loadMACD(analysis.candles, analysis.macd);

  if (volEl)     drawVolumeProfile(volEl, analysis.volProfile);
  if (fundingEl) drawFundingChart(fundingEl, data.fundingHist);
  if (oiEl)      drawOIChart(oiEl, data.oiHistory);
  if (liqEl)     drawLiquidationBar(liqEl, analysis.liqLevels, analysis.price);

  // Subscribe to crosshair for overlay sync
  chart.subscribeCrosshairMove(() => redrawOverlay());
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawOverlay());
}

export {
  initChart, initRSIChart, initMACDChart,
  setupOverlayCanvas, renderAll, redrawOverlay,
  drawVolumeProfile, drawFundingChart, drawOIChart, drawLiquidationBar,
};
