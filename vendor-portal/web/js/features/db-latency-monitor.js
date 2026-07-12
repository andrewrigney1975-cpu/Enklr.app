"use strict";

/* Live "Database Latency" widget for the Dashboard view. Pings a trivial (SELECT 1) server
   endpoint every PING_INTERVAL_MS, measures the full round trip (network + Node + Postgres) with
   performance.now(), and plots a bounded rolling history — see server/routes/dashboard.js's
   db-ping route for the other half of this.

   Design choices, and why (this was scoped down from an initial 1-second-interval proposal):
   - 5s interval, not 1s: a human glancing at this chart can't usefully distinguish a spike at t=1s
     from one at t=4s, so 1s bought no real diagnostic value while producing 5x the query volume,
     connection-pool churn, and log noise for a purely observational widget.
   - Paused via the Page Visibility API while the tab isn't focused, and self-stops once every
     render target has left the DOM (the user navigated to a different view) — this is deliberately
     NOT a global always-on monitor; it only pings while someone could actually be looking at it.
   - Bounded history (MAX_HISTORY points) — without a cap this would leak memory for as long as the
     tab stays open on the Dashboard.
   - A failed ping is plotted as a distinct marker with a broken line, not silently dropped — an
     actual DB outage is the single most useful thing this widget could ever surface.

   One shared ping loop, multiple render targets: the inline dashboard chart and the "big view"
   modal (opened via the expand icon) show the SAME live history rather than each running their own
   independent ping loop — opening the modal doesn't double the ping rate, it just adds a second
   place the existing data gets drawn. */

import { api } from '../api.js';
import { currentTheme } from '../theme.js';
import { renderLatencyLineChart } from '../charts/line-chart.js';

var PING_INTERVAL_MS = 5000;
var MAX_HISTORY = 300; // 300 * 5s = 25 minutes of rolling history retained for the running average
var WINDOW_MINUTES = 5;
// How many of the most-recent points actually get DRAWN — the chart fills in from the left up to
// this many points, then starts dropping its oldest point each time a new one arrives, which reads
// as the whole chart scrolling left. The average above still uses the full MAX_HISTORY, not just
// this visible slice — a short scrolling window and a longer-running baseline are different jobs.
var WINDOW_POINTS = Math.round((WINDOW_MINUTES * 60 * 1000) / PING_INTERVAL_MS);
var ABOVE_AVERAGE_MULTIPLIER = 1.5;
var SEVERE_MULTIPLIER = 3;

// "above" uses the dedicated --kf-orange-fg token (not --kf-overdue-fg's amber) so it reads as
// visually distinct from both the amber overdue-pill color elsewhere in the app and the red
// severe/failed color below.
var COLORS_LIGHT = { normal: '#0c66e4', above: '#b65c02', severe: '#de350b', avgLine: '#8993a4' };
var COLORS_DARK  = { normal: '#579dff', above: '#ffa947', severe: '#f87168', avgLine: '#7a8694' };

var history = [];
var intervalId = null;
var targets = []; // [{chartEl, summaryEl}]

function currentColors(){
  return currentTheme() === 'dark' ? COLORS_DARK : COLORS_LIGHT;
}

function computeAverage(){
  var valid = history.filter(function(p){ return p.rtt != null; });
  if(valid.length === 0) return 0;
  var sum = valid.reduce(function(s, p){ return s + p.rtt; }, 0);
  return sum / valid.length;
}

function classify(rtt, average){
  if(rtt == null) return 'severe'; // a failed ping is treated as worse than any slow-but-successful one
  if(average <= 0) return 'normal';
  if(rtt > average * SEVERE_MULTIPLIER) return 'severe';
  if(rtt > average * ABOVE_AVERAGE_MULTIPLIER) return 'above';
  return 'normal';
}

function formatMs(v){ return Math.round(v) + 'ms'; }

// Any target whose chart element is no longer attached (the Dashboard view was replaced, or the
// modal was closed) is dropped here rather than left to error out on the next render.
function pruneTargets(){
  targets = targets.filter(function(t){ return t.chartEl && document.body.contains(t.chartEl); });
}

function render(){
  pruneTargets();
  if(targets.length === 0){
    stopDbLatencyMonitor();
    return;
  }

  var average = computeAverage();
  var last = history.length ? history[history.length - 1] : null;
  var failedCount = history.filter(function(p){ return p.rtt == null; }).length;
  var lastText = last ? (last.rtt == null ? 'failed' : formatMs(last.rtt)) : '—';
  var avgText = average > 0 ? formatMs(average) : '—';
  var summaryText = 'Last: ' + lastText + '  ·  Average: ' + avgText + '  ·  Failed pings: ' + failedCount + ' / ' + history.length;

  // Only the most recent WINDOW_POINTS (5 minutes' worth) are actually drawn — see WINDOW_POINTS's
  // own comment above for why the average just above still uses the full retained history instead.
  var visibleHistory = history.slice(-WINDOW_POINTS);
  var points = visibleHistory.map(function(p){ return { rtt: p.rtt, status: classify(p.rtt, average), t: p.t }; });
  var colors = currentColors();

  targets.forEach(function(t){
    if(t.summaryEl) t.summaryEl.textContent = summaryText;
    renderLatencyLineChart(t.chartEl, { points: points, average: average, colors: colors, valueFormatter: formatMs, fillHeight: !!t.fillHeight, windowSize: WINDOW_POINTS });
  });
}

async function pingOnce(){
  var t0 = performance.now();
  var timestamp = Date.now(); // wall-clock time of the ping, for the severe-point label/title (UTC)
  try{
    await api.get('/dashboard/db-ping');
    history.push({ rtt: performance.now() - t0, t: timestamp });
  }catch(e){
    history.push({ rtt: null, t: timestamp });
  }
  if(history.length > MAX_HISTORY) history.shift();
  render();
}

function tick(){
  if(document.hidden) return; // paused while the tab isn't visible — resumes on its own once it is
  pruneTargets();
  if(targets.length === 0){ stopDbLatencyMonitor(); return; }
  pingOnce();
}

/* Idempotent — safe to call every time the Dashboard view renders (including re-visits), which is
   exactly when it's called from views/dashboard.js. History persists across those re-renders
   (module-level state) so revisiting the Dashboard doesn't lose the trend, only a full page reload
   does. */
export function startDbLatencyMonitor(chartEl, summaryTextEl){
  targets = [{ chartEl: chartEl, summaryEl: summaryTextEl }];
  if(intervalId) clearInterval(intervalId);
  render();
  pingOnce();
  intervalId = setInterval(tick, PING_INTERVAL_MS);
}

export function stopDbLatencyMonitor(){
  if(intervalId){ clearInterval(intervalId); intervalId = null; }
  targets = [];
}

/* For the same debounced window-resize redraw dashboard.js already runs for the Activity/Revenue
   charts — without it this chart would sit at its old width until the next 5s ping happens to
   re-render it. No-ops harmlessly if the monitor isn't currently running. */
export function redrawDbLatencyMonitor(){
  render();
}

/* =========================================================
   BIG-VIEW MODAL — same open/close/isOpen shape the main Enkl App's own modals use (see e.g.
   modals/health.js there): dedicated functions wired once from app.js, rather than vendor-portal's
   existing License/Contract modals' open-with-callback-per-invocation pattern, since this one has
   no form fields to populate and nothing to save — it's purely a bigger view onto data that's
   already live elsewhere.
   ========================================================= */
export function openDbLatencyModal(){
  var chartEl = document.getElementById('dbLatencyModalChartInner');
  var summaryEl = document.getElementById('dbLatencyModalSummary');
  if(!chartEl) return;
  // Unhide BEFORE measuring/rendering — the chart's fillHeight sizing reads chartEl.clientHeight
  // (see line-chart.js), which is 0 while the modal's still display:none.
  document.getElementById('dbLatencyModalOverlay').classList.remove('hidden');
  if(!targets.some(function(t){ return t.chartEl === chartEl; })){
    targets.push({ chartEl: chartEl, summaryEl: summaryEl, fillHeight: true });
  }
  render();
}
export function closeDbLatencyModal(){
  document.getElementById('dbLatencyModalOverlay').classList.add('hidden');
  var chartEl = document.getElementById('dbLatencyModalChartInner');
  targets = targets.filter(function(t){ return t.chartEl !== chartEl; });
}
export function isDbLatencyModalOpen(){
  var overlay = document.getElementById('dbLatencyModalOverlay');
  return !!overlay && !overlay.classList.contains('hidden');
}
