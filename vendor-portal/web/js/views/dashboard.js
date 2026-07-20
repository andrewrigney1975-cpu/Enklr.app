"use strict";

import { api } from '../api.js';
import { hydrateIcons } from '../icons.js';
import { formatMoney, formatDate, escapeHtml } from '../format.js';
import { parseISODateUTC, toISODateUTC, addDaysUTC, bucketDailySeries, GRANULARITY_CONFIG, GRANULARITY_ORDER } from '../features/time-buckets.js';
import { renderBucketedChart } from '../charts/bucketed-chart.js';
import { toggleExportAsPanel, exportSvgElementAsSvgFile, exportSvgElementAsPng } from '../features/svg-export.js';
import { startDbLatencyMonitor, stopDbLatencyMonitor, redrawDbLatencyMonitor, openDbLatencyModal } from '../features/db-latency-monitor.js';
import { startWebappLatencyMonitor, stopWebappLatencyMonitor, redrawWebappLatencyMonitor, openWebappLatencyModal } from '../features/webapp-latency-monitor.js';

function defaultRangeForGranularity(granularity){
  var today = new Date();
  var end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  var start;
  switch(granularity){
    case 'day': start = addDaysUTC(end, -30); break;
    case 'week': start = addDaysUTC(end, -84); break;
    case 'fortnight': start = addDaysUTC(end, -168); break;
    case 'month': start = addDaysUTC(end, -365); break;
    case 'quarter': start = addDaysUTC(end, -730); break;
    case 'year': start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1)); break;
    default: start = addDaysUTC(end, -365);
  }
  return {start: start, end: end};
}

function activityCountFormatter(v){ return Math.round(v).toLocaleString(); }
function revenueFormatter(v){ return formatMoney(v, 'AUD'); }

// One fixed size for every stat-tile icon, on every tile in every row — iconSvg() always draws off
// a 0-24 viewBox regardless of this value, so holding it constant here is what keeps every tile's
// icon column (and therefore its label/value text) the same width and lined up with its neighbours.
var STAT_TILE_ICON_SIZE = 28;
function statTileHTML(t){
  return '<div class="kf-stat-tile">' +
    '<span class="kf-stat-tile-icon" data-icon="' + t.icon + '" data-size="' + STAT_TILE_ICON_SIZE + '"></span>' +
    '<div class="kf-stat-tile-text">' +
      '<div class="kf-stat-tile-label">' + escapeHtml(t.label) + '</div>' +
      '<div class="kf-stat-tile-value">' + escapeHtml(t.value) + '</div>' +
    '</div>' +
  '</div>';
}

function granularityOptionsHTML(selected){
  return GRANULARITY_ORDER.map(function(key){
    var sel = key === selected ? ' selected' : '';
    return '<option value="' + key + '"' + sel + '>' + escapeHtml(GRANULARITY_CONFIG[key].label) + '</option>';
  }).join('');
}

function wireExportPanel(exportBtnId, exportPanelId, chartInnerId, filenameBaseFn){
  var btn = document.getElementById(exportBtnId);
  var panel = document.getElementById(exportPanelId);
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    toggleExportAsPanel(exportPanelId);
  });
  panel.querySelectorAll('.kf-export-as-option').forEach(function(optionBtn){
    optionBtn.addEventListener('click', function(){
      var svgEl = document.querySelector('#' + chartInnerId + ' svg');
      if(!svgEl) return;
      panel.classList.add('hidden');
      var filenameBase = filenameBaseFn();
      if(optionBtn.getAttribute('data-export-type') === 'svg'){
        exportSvgElementAsSvgFile(svgEl, filenameBase);
      } else {
        exportSvgElementAsPng(svgEl, filenameBase, 4);
      }
    });
  });
}

/* One independently-controlled chart panel: its own granularity + custom date range,
   fetched from its own endpoint, with its own export-as control. Activity and Revenue
   each get one of these rather than sharing a single report-range control. */
function createChartWidget(opts){
  var ids = {
    granularitySelect: opts.key + 'GranularitySelect',
    startInput: opts.key + 'StartDateInput',
    endInput: opts.key + 'EndDateInput',
    chartInner: opts.key + 'ChartInner',
    exportBtn: opts.key + 'ExportBtn',
    exportPanel: opts.key + 'ExportPanel'
  };
  var state = {granularity: opts.defaultGranularity || 'month', start: null, end: null};
  var lastBuckets = null;

  function ensureDefaults(){
    if(!state.start || !state.end){
      var defaults = defaultRangeForGranularity(state.granularity);
      state.start = defaults.start;
      state.end = defaults.end;
    }
  }

  function panelHTML(){
    ensureDefaults();
    return (
      '<div class="kf-panel kf-chart-panel">' +
        '<div class="kf-panel-header">' +
          '<div class="kf-panel-header-row">' +
            '<span>' + escapeHtml(opts.title) + '</span>' +
            '<div class="kf-export-as-wrap">' +
              '<button class="kf-btn kf-btn-secondary" id="' + ids.exportBtn + '"><span class="kf-icon" data-icon="download" data-size="13"></span>Export as</button>' +
              '<div class="kf-export-as-panel hidden" id="' + ids.exportPanel + '">' +
                '<button class="kf-export-as-option" data-export-type="svg">Export as SVG</button>' +
                '<button class="kf-export-as-option" data-export-type="png">Export as PNG (4x resolution)</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kf-chart-controls">' +
          '<label for="' + ids.granularitySelect + '">Granularity</label>' +
          '<select id="' + ids.granularitySelect + '">' + granularityOptionsHTML(state.granularity) + '</select>' +
          '<label for="' + ids.startInput + '">From</label>' +
          '<input type="date" id="' + ids.startInput + '" value="' + toISODateUTC(state.start) + '">' +
          '<label for="' + ids.endInput + '">To</label>' +
          '<input type="date" id="' + ids.endInput + '" value="' + toISODateUTC(state.end) + '">' +
        '</div>' +
        '<div class="kf-chart-inner" id="' + ids.chartInner + '"></div>' +
      '</div>'
    );
  }

  function draw(){
    var inner = document.getElementById(ids.chartInner);
    if(!inner || !lastBuckets) return;
    renderBucketedChart(inner, {
      buckets: lastBuckets,
      series: opts.series,
      valueFormatter: opts.valueFormatter,
      emptyMessage: opts.emptyMessage
    });
  }

  async function fetchAndRender(){
    var inner = document.getElementById(ids.chartInner);
    if(!inner) return;
    inner.innerHTML = '<p style="color:var(--kf-text-faint);">Loading…</p>';
    var qs = '?start=' + toISODateUTC(state.start) + '&end=' + toISODateUTC(state.end);
    var data = await api.get(opts.endpoint + qs);
    lastBuckets = opts.buildBuckets(data, state.start, state.end, state.granularity);
    draw();
  }

  function wire(){
    var granularitySelect = document.getElementById(ids.granularitySelect);
    var startInput = document.getElementById(ids.startInput);
    var endInput = document.getElementById(ids.endInput);

    granularitySelect.addEventListener('change', function(){
      state.granularity = granularitySelect.value;
      var defaults = defaultRangeForGranularity(state.granularity);
      state.start = defaults.start;
      state.end = defaults.end;
      startInput.value = toISODateUTC(state.start);
      endInput.value = toISODateUTC(state.end);
      fetchAndRender();
    });
    startInput.addEventListener('change', function(){
      if(!startInput.value) return;
      state.start = parseISODateUTC(startInput.value);
      fetchAndRender();
    });
    endInput.addEventListener('change', function(){
      if(!endInput.value) return;
      state.end = parseISODateUTC(endInput.value);
      fetchAndRender();
    });

    wireExportPanel(ids.exportBtn, ids.exportPanel, ids.chartInner, function(){
      return 'enkl-portal-' + opts.key + '-' + state.granularity + '-' + toISODateUTC(state.start) + '-to-' + toISODateUTC(state.end);
    });
  }

  return {panelHTML: panelHTML, wire: wire, fetchAndRender: fetchAndRender, redraw: draw};
}

var activityWidget = createChartWidget({
  key: 'activity',
  title: 'Activity (all organisations)',
  endpoint: '/dashboard/activity',
  defaultGranularity: 'month',
  series: [
    {key: 'created', label: 'New tasks'},
    {key: 'edited', label: 'Edited'},
    {key: 'done', label: 'Moved to Done'}
  ],
  valueFormatter: activityCountFormatter,
  emptyMessage: 'No task activity in this range.',
  buildBuckets: function(data, start, end, granularity){
    var createdBuckets = bucketDailySeries(data.created, 'count', start, end, granularity);
    var editedBuckets = bucketDailySeries(data.edited, 'count', start, end, granularity);
    var doneBuckets = bucketDailySeries(data.done, 'count', start, end, granularity);
    return createdBuckets.map(function(b, i){
      return {
        label: b.label,
        values: {
          created: b.value,
          edited: editedBuckets[i] ? editedBuckets[i].value : 0,
          done: doneBuckets[i] ? doneBuckets[i].value : 0
        }
      };
    });
  }
});

var revenueWidget = createChartWidget({
  key: 'revenue',
  title: 'Revenue (all organisations)',
  endpoint: '/dashboard/revenue',
  defaultGranularity: 'month',
  series: [{key: 'revenue', label: 'AUD Revenue'}],
  valueFormatter: revenueFormatter,
  emptyMessage: 'No revenue in this range.',
  buildBuckets: function(data, start, end, granularity){
    var buckets = bucketDailySeries(data.days, 'revenue_cents', start, end, granularity);
    return buckets.map(function(b){ return {label: b.label, values: {revenue: b.value}}; });
  }
});

// Registered once at module load (not per-render) so charts stay full-width across window
// resizes without accumulating duplicate listeners as the user navigates between views.
var resizeRedrawTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeRedrawTimer);
  resizeRedrawTimer = setTimeout(function(){
    activityWidget.redraw();
    revenueWidget.redraw();
    // Redrawing the inactive one is a harmless no-op (see render()'s zero-targets branch) — simpler
    // than tracking which is active just for this.
    redrawDbLatencyMonitor();
    redrawWebappLatencyMonitor();
  }, 150);
});

/* Single APM panel, one chart visible at a time — switching stops the outgoing monitor (so an
   unwatched chart never keeps polling in the background) and starts the incoming one on the SAME
   shared chart/summary elements. Module-level so the toggle position survives navigating away from
   and back to the Dashboard view within the same page load (matching the monitors' own history,
   which persists the same way) — only a full page reload resets it to the default. */
var APM_CHARTS = {
  db: {
    title: 'APM - Database Latency (live)',
    start: startDbLatencyMonitor,
    stop: stopDbLatencyMonitor,
    openModal: openDbLatencyModal
  },
  webapp: {
    title: 'APM - Web App Responsiveness (live)',
    start: startWebappLatencyMonitor,
    stop: stopWebappLatencyMonitor,
    openModal: openWebappLatencyModal
  }
};
var activeApmKey = 'db';

function reflectActiveApmChartInUI(){
  document.getElementById('apmChartTitle').textContent = APM_CHARTS[activeApmKey].title;
  document.getElementById('apmToggleDbBtn').classList.toggle('active', activeApmKey === 'db');
  document.getElementById('apmToggleWebappBtn').classList.toggle('active', activeApmKey === 'webapp');
}

function switchApmChart(key){
  if(key === activeApmKey) return;
  APM_CHARTS[activeApmKey].stop();
  activeApmKey = key;
  reflectActiveApmChartInUI();
  APM_CHARTS[key].start(document.getElementById('apmChartInner'), document.getElementById('apmSummary'));
}

export async function renderDashboard(root){
  root.innerHTML = '<div class="kf-view"><p style="color:var(--kf-text-faint);">Loading…</p></div>';
  var data = await api.get('/dashboard');

  // icon: same data-icon/data-size on every tile (see the shared STAT_TILE_ICON_SIZE below) so every
  // icon renders at an identical pixel size off the same 0-24 viewBox iconSvg() always uses — that's
  // what keeps every tile's label/value text lining up regardless of which icon it carries.
  var tiles = [
    { label: 'Organisations', value: data.org_count, icon: 'orgChart' },
    { label: 'Active Users', value: data.active_user_count, icon: 'team' },
    { label: 'Active Contracts', value: data.active_contract_count, icon: 'ty_document' },
    { label: 'Annualised Contract Value', value: formatMoney(data.annualized_contract_value_cents, 'AUD'), icon: 'ty_procure' }
  ];
  // Second row, kept in its own grid below the tiles above — "Projects" here means the Projects
  // belonging to the Organisations this portal manages (the main Enkl Task app's own Projects table,
  // joined by OrganisationId), not anything specific to vendor-portal's own schema.
  var projectTiles = [
    { label: 'Current Projects', value: data.current_project_count, icon: 'board' },
    { label: 'All Projects', value: data.all_project_count, icon: 'board' }
  ];

  var rows = (data.recentContracts || []).map(function(c){
    return '<tr>' +
      '<td>' + escapeHtml(c.org_name) + '</td>' +
      '<td>' + escapeHtml(c.name) + '</td>' +
      '<td><span class="kf-pill kf-pill-' + c.status + '">' + escapeHtml(c.status) + '</span></td>' +
      '<td>' + formatDate(c.start_date) + ' – ' + formatDate(c.end_date) + '</td>' +
      '<td>' + formatMoney(c.contract_value_cents, 'AUD') + ' / ' + escapeHtml(c.billing_frequency) + '</td>' +
      '</tr>';
  }).join('');

  root.innerHTML =
    '<div class="kf-view">' +
      '<div class="kf-view-header"><h1 class="kf-view-title">Enklr Vendor Portal</h1></div>' +
      '<div class="kf-stat-grid">' + tiles.map(statTileHTML).join('') + '</div>' +
      '<div class="kf-stat-grid">' + projectTiles.map(statTileHTML).join('') + '</div>' +
      '<div class="kf-panel kf-chart-panel">' +
        '<div class="kf-panel-header">' +
          '<div class="kf-panel-header-row">' +
            '<span id="apmChartTitle">APM - Database Latency (live)</span>' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<div class="kf-apm-toggle">' +
                '<button type="button" class="kf-apm-toggle-btn active" id="apmToggleDbBtn">DB Latency</button>' +
                '<button type="button" class="kf-apm-toggle-btn" id="apmToggleWebappBtn">Web App Responsiveness</button>' +
              '</div>' +
              '<span id="apmSummary" style="font-size:12px;color:var(--kf-text-secondary);font-weight:400;"></span>' +
              '<button class="kf-btn kf-btn-ghost" id="apmExpandBtn" title="Open in a bigger view"><span class="kf-icon" data-icon="fit" data-size="14"></span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kf-chart-inner">' +
          '<div class="kf-legend">' +
            '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:var(--kf-blue);"></span>Normal</span>' +
            '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:var(--kf-orange-fg);"></span>Above average</span>' +
            '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:var(--kf-danger);"></span>Severely above average</span>' +
          '</div>' +
          '<div id="apmChartInner"></div>' +
        '</div>' +
      '</div>' +
      '<div class="kf-panel" style="margin-top:20px;">' +
        '<div class="kf-panel-header">Recently updated contracts</div>' +
        (rows
          ? '<table class="kf-table"><thead><tr><th>Organisation</th><th>Contract</th><th>Status</th><th>Term</th><th>Value</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<div class="kf-table-empty">No contracts yet.</div>') +
      '</div>' +
      '<div class="kf-chart-row">' +
        activityWidget.panelHTML() +
        revenueWidget.panelHTML() +
      '</div>' +
    '</div>';

  hydrateIcons(root);

  activityWidget.wire();
  revenueWidget.wire();
  document.getElementById('apmToggleDbBtn').addEventListener('click', function(){ switchApmChart('db'); });
  document.getElementById('apmToggleWebappBtn').addEventListener('click', function(){ switchApmChart('webapp'); });
  document.getElementById('apmExpandBtn').addEventListener('click', function(){ APM_CHARTS[activeApmKey].openModal(); });

  await Promise.all([activityWidget.fetchAndRender(), revenueWidget.fetchAndRender()]);

  // Reflects whichever chart was active last time (module-level state — see APM_CHARTS's own
  // comment), not always "db", so revisiting the Dashboard doesn't silently switch the chart back.
  reflectActiveApmChartInUI();
  APM_CHARTS[activeApmKey].start(document.getElementById('apmChartInner'), document.getElementById('apmSummary'));
}
