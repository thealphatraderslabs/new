// ATL · SMC Scanner UI Controller
// Handles rail switching, control state, progress updates, result streaming

import { runScan, abortScan, renderHeatmap } from './smc-scanner.js';

// ── State ──────────────────────────────────────────────────────
let selectedExchange = 'bybit';
let selectedTF       = '1h';
let scanResults      = [];

// ── DOM ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function init() {
  // ── Rail switching ───────────────────────────────────────────
  const railAnalysis = $('rail-analysis');
  const railSMC      = $('rail-smc');
  const stageAnalysis = $('stage-analysis');
  const stageSMC      = $('stage-smc');
  const topStrip      = $('top-strip');

  const stageWrap = $('stage');

  function showStage(stage) {
    if (stage === 'analysis') {
      stageAnalysis.style.display = '';
      stageSMC.style.display      = 'none';
      if (topStrip)  topStrip.style.display  = '';
      if (stageWrap) stageWrap.classList.remove('smc-active');
      railAnalysis?.classList.add('active');
      railSMC?.classList.remove('active');
    } else {
      stageAnalysis.style.display = 'none';
      stageSMC.style.display      = '';
      if (topStrip)  topStrip.style.display  = 'none';
      if (stageWrap) stageWrap.classList.add('smc-active');
      railAnalysis?.classList.remove('active');
      railSMC?.classList.add('active');
    }
  }

  railAnalysis?.addEventListener('click', () => showStage('analysis'));
  railSMC?.addEventListener('click', () => showStage('smc'));

  // ── Exchange toggle ──────────────────────────────────────────
  document.querySelectorAll('#smc-exchange-toggle .smc-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#smc-exchange-toggle .smc-toggle')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedExchange = btn.dataset.val;
    });
  });

  // ── TF toggle ───────────────────────────────────────────────
  document.querySelectorAll('#smc-tf-toggle .smc-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#smc-tf-toggle .smc-toggle')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTF = btn.dataset.val;
    });
  });

  // ── Scan button ──────────────────────────────────────────────
  $('smc-scan-btn')?.addEventListener('click', startScan);
  $('smc-abort-btn')?.addEventListener('click', () => {
    abortScan();
    setStatus('Aborting…');
  });
}

// ── Progress / status helpers ──────────────────────────────────
function setStatus(msg, color) {
  const el = $('smc-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || 'var(--muted)';
}

function setScanningUI(active) {
  const scanBtn  = $('smc-scan-btn');
  const abortBtn = $('smc-abort-btn');
  if (scanBtn)  scanBtn.style.display  = active ? 'none' : '';
  if (abortBtn) abortBtn.style.display = active ? '' : 'none';

  // Status dot
  if (window.__atlSetStatus) {
    window.__atlSetStatus(active ? 'loading' : 'live');
  }
}

// ── Scan entry point ───────────────────────────────────────────
function startScan() {
  scanResults = [];
  const heatmap = $('smc-heatmap');
  if (heatmap) {
    heatmap.innerHTML = `
      <div class="smc-scan-progress">
        <div class="smc-progress-ring"></div>
        <div id="smc-progress-text" class="smc-progress-text">Fetching pairs…</div>
      </div>`;
  }

  setScanningUI(true);
  setStatus(`Scanning ${selectedExchange === 'bybit' ? 'Bybit' : 'Binance'} · ${selectedTF.toUpperCase()}`, '#ffd54f');

  runScan({
    exchange: selectedExchange,
    tf:       selectedTF,

    onProgress({ phase, msg, done, total, partial }) {
      const el = $('smc-progress-text');
      if (el) el.textContent = msg;
      setStatus(msg);

      if (phase === 'scanning' && done && total) {
        const pct = Math.round((done / total) * 100);
        const ring = document.querySelector('.smc-progress-ring');
        if (ring) {
          ring.style.background = `conic-gradient(var(--green) ${pct * 3.6}deg, var(--bg3) 0deg)`;
        }
        if (partial != null) {
          setStatus(`${msg} · ${partial} qualified`, '#ffd54f');
        }
      }
    },

    onResult(result) {
      // Stream result into heatmap as they come in (partial render)
      scanResults.push(result);
      renderHeatmap($('smc-heatmap'), scanResults, selectedTF);
    },

    onDone({ results, total, aborted }) {
      setScanningUI(false);
      const longs  = results.filter(r => r.primaryDir === 'bull').length;
      const shorts = results.filter(r => r.primaryDir === 'bear').length;
      const prime  = results.filter(r => r.score === 7).length;

      if (aborted) {
        setStatus(`Aborted · ${results.length} qualified (6+/7) so far`, '#ffd54f');
      } else {
        setStatus(
          `Done · ${total} scanned · ${results.length} qualified (6+/7) · ${prime} prime · ${longs}↑ ${shorts}↓`,
          '#00e676'
        );
      }

      if (window.__atlSetStatus) window.__atlSetStatus('live');
      renderHeatmap($('smc-heatmap'), results, selectedTF);
    },

    onError(msg) {
      setScanningUI(false);
      setStatus(`Error: ${msg}`, '#ff4444');
      const heatmap = $('smc-heatmap');
      if (heatmap) {
        heatmap.innerHTML = `
          <div class="smc-empty">
            <div class="smc-empty-glyph">✗</div>
            <div style="color:#ff4444">${msg}</div>
          </div>`;
      }
    },
  });
}

// ── Boot ───────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
