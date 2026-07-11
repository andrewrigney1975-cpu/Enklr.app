"use strict";

import { api } from '../api.js';
import { hydrateIcons } from '../icons.js';
import { formatMoney, formatDate, escapeHtml } from '../format.js';
import { parseISODateUTC, toISODateUTC, addDaysUTC, bucketDailySeries, GRANULARITY_CONFIG, GRANULARITY_ORDER } from '../features/time-buckets.js';
import { renderBucketedChart } from '../charts/bucketed-chart.js';
import { toggleExportAsPanel, exportSvgElementAsSvgFile, exportSvgElementAsPng } from '../features/svg-export.js';

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
  }, 150);
});

export async function renderDashboard(root){
  root.innerHTML = '<div class="kf-view"><p style="color:var(--kf-text-faint);">Loading…</p></div>';
  var data = await api.get('/dashboard');

  var tiles = [
    { label: 'Organisations', value: data.org_count },
    { label: 'Active Users', value: data.active_user_count },
    { label: 'Active Contracts', value: data.active_contract_count },
    { label: 'Annualised Contract Value', value: formatMoney(data.annualized_contract_value_cents, 'AUD') }
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
      '<div class="kf-view-header"><h1 class="kf-view-title">Dashboard</h1></div>' +
      '<div class="kf-stat-grid">' +
        tiles.map(function(t){
          return '<div class="kf-stat-tile"><div class="kf-stat-tile-label">' + escapeHtml(t.label) + '</div><div class="kf-stat-tile-value">' + escapeHtml(t.value) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="kf-panel">' +
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

  await Promise.all([activityWidget.fetchAndRender(), revenueWidget.fetchAndRender()]);
}
