"use strict";

/* Live "APM - Database Latency" widget for the Dashboard view — thin wrapper around
   features/latency-monitor.js's shared engine. Pings a trivial (SELECT 1) server endpoint every
   PING_INTERVAL_MS and measures the full round trip (network + Node + Postgres) with
   performance.now() — see server/routes/dashboard.js's db-ping route for the other half of this.
   See webapp-latency-monitor.js for this widget's sibling ("APM - Web App Responsiveness"), and
   latency-monitor.js's own doc comment for the design choices (5s interval, visibility-pause,
   bounded history, failed-ping-as-a-plotted-point) shared by both. */

import { api } from '../api.js';
import { createLatencyMonitor } from './latency-monitor.js';

var PING_INTERVAL_MS = 5000;
var MAX_HISTORY = 300; // 300 * 5s = 25 minutes of rolling history retained for the running average

async function pingOnce(){
  var t0 = performance.now();
  var timestamp = Date.now(); // wall-clock time of the ping, for the severe-point label/title (UTC)
  try{
    await api.get('/dashboard/db-ping');
    return [{ rtt: performance.now() - t0, t: timestamp }];
  }catch(e){
    return [{ rtt: null, t: timestamp }];
  }
}

var monitor = createLatencyMonitor({
  intervalMs: PING_INTERVAL_MS,
  maxHistory: MAX_HISTORY,
  windowMinutes: 5,
  tick: pingOnce
});

export var startDbLatencyMonitor = monitor.start;
export var stopDbLatencyMonitor = monitor.stop;
export var redrawDbLatencyMonitor = monitor.redraw;

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
  monitor.addModalTarget(chartEl, summaryEl, true);
}
export function closeDbLatencyModal(){
  document.getElementById('dbLatencyModalOverlay').classList.add('hidden');
  monitor.removeModalTarget(document.getElementById('dbLatencyModalChartInner'));
}
export function isDbLatencyModalOpen(){
  var overlay = document.getElementById('dbLatencyModalOverlay');
  return !!overlay && !overlay.classList.contains('hidden');
}
