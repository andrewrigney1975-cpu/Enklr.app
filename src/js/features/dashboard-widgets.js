"use strict";
import { escapeHTML } from '../views/board.js';
import { executeQuery, QueryError } from './query-engine.js';
import { markdownToHtml } from '../rich-text/markdown.js';
import { sortRows, createRowFilter } from './sort-filter.js';
import { csvEscapeValue } from '../views/task-list.js';
import { downloadBlob } from './svg-export.js';
import { buildGaugeBlock } from '../modals/health.js';
import { computeCostBenefitScatterPoints, buildCostBenefitScatterSvg } from '../views/cost-benefit.js';
import { buildTimelineColumns, tlDateToPixel } from '../views/timeline.js';
import { buildBarChartSvg, buildLineChartSvg, buildPieChartSvg } from './dashboard-charts.js';

/* =========================================================
   DASHBOARD WIDGETS — pure per-widget-type renderers for modals/dashboards.js's viewer/editor.
   Each renderer takes the widget row (with its own parsed configJson) plus the current project, and
   returns an HTML string for the widget body. Data-driven widget types run their assigned Saved
   Query client-side through features/query-engine.js's executeQuery — the same AlaSQL engine
   Advanced Query's own Run button already uses; no server-side query execution is involved here.

   Widgets needing DOM wiring after insertion (table's sort/filter headers, CSV export) expose their
   own `wire*` function, called by the viewer right after innerHTML assignment.
   ========================================================= */

function parseConfig(widget){
  if(!widget.configJson) return {};
  try { var c = JSON.parse(widget.configJson); return (c && typeof c === 'object') ? c : {}; }
  catch(e){ return {}; }
}

function findSavedQuery(project, savedQueryId){
  return (project.savedQueries || []).find(function(q){ return q.id === savedQueryId; }) || null;
}

function runWidgetQuery(project, widget){
  var query = findSavedQuery(project, widget.savedQueryId);
  if(!query) throw new QueryError('This widget\'s Saved Query no longer exists.');
  return executeQuery(project, query.sql);
}

function errorHtml(message){
  return '<div class="kf-dashboard-widget-error">' + escapeHTML(message) + '</div>';
}

/* ---- table ---- */

/* Session-only — never persisted, and never carried over between opens of the same Dashboard
   (resetDashboardTableWidgetState() is called on viewer close, same convention as every other
   session-only ui.* state in this app). Page size defaults to 20 every time; "No need to remember
   these settings per view" per the feature request. */
export var TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 'all'];
var DEFAULT_PAGE_SIZE = 20;

var tableWidgetState = {}; // widgetId -> {sort: {field, dir}, filters: {}, pageSize, page}

function getTableState(widgetId){
  if(!tableWidgetState[widgetId]) tableWidgetState[widgetId] = {sort: null, filters: {}, pageSize: DEFAULT_PAGE_SIZE, page: 0};
  return tableWidgetState[widgetId];
}

export function resetDashboardTableWidgetState(){
  tableWidgetState = {};
}

export function renderTableWidget(widget, project, opts){
  opts = opts || {};
  var result;
  try { result = runWidgetQuery(project, widget); }
  catch(e){ return errorHtml(e.message || 'Could not run this widget\'s query.'); }

  if(result.columns.length === 0){
    return '<div class="kf-dashboard-tile-empty">This query returned no rows.</div>';
  }

  var state = getTableState(widget.id);
  var filterFn = createRowFilter(state.filters, function(row, field){ return row[field]; });
  var rows = result.rows.filter(filterFn);
  if(state.sort){
    rows = sortRows(rows, function(row){ return row[state.sort.field]; }, state.sort.dir);
  }

  var readOnly = !!opts.readOnly;
  var totalRows = rows.length;
  var pageSize = state.pageSize === 'all' ? totalRows : state.pageSize;
  var pageCount = pageSize > 0 ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;
  if(state.page >= pageCount) state.page = pageCount - 1;
  if(state.page < 0) state.page = 0;
  var pageRows = readOnly ? rows : rows.slice(state.page * pageSize, state.page * pageSize + pageSize);

  var headerHtml = result.columns.map(function(col){
    var sortIndicator = state.sort && state.sort.field === col ? (state.sort.dir === 'desc' ? ' ▼' : ' ▲') : '';
    return readOnly
      ? '<div class="kf-dashboard-table-th">' + escapeHTML(col) + '</div>'
      : '<div class="kf-dashboard-table-th kf-dashboard-table-th-sortable" data-widget-sort-col="' + escapeHTML(col) + '">' + escapeHTML(col) + sortIndicator + '</div>';
  }).join('');
  var filterHtml = readOnly ? '' : result.columns.map(function(col){
    var val = state.filters[col] || '';
    return '<div class="kf-dashboard-table-th"><input type="text" class="kf-dashboard-table-filter-input" data-widget-filter-col="' + escapeHTML(col) + '" placeholder="Filter…" value="' + escapeHTML(val) + '"></div>';
  }).join('');
  var bodyHtml = pageRows.map(function(row){
    return '<div class="kf-dashboard-table-row">' + result.columns.map(function(col){
      return '<div class="kf-dashboard-table-td">' + escapeHTML(row[col] == null ? '' : String(row[col])) + '</div>';
    }).join('') + '</div>';
  }).join('');

  var gridStyle = 'grid-template-columns:repeat(' + result.columns.length + ', minmax(90px, 1fr));';
  var rangeStart = totalRows === 0 ? 0 : state.page * pageSize + 1;
  var rangeEnd = Math.min(totalRows, state.page * pageSize + pageSize);
  var paginationHtml = readOnly ? '' :
    '<div class="kf-dashboard-table-pagination">' +
      '<label class="kf-dashboard-table-pagesize">Rows per page ' +
        '<select data-widget-page-size>' +
          TABLE_PAGE_SIZE_OPTIONS.map(function(opt){
            return '<option value="' + opt + '"' + (state.pageSize === opt ? ' selected' : '') + '>' + (opt === 'all' ? 'All' : opt) + '</option>';
          }).join('') +
        '</select>' +
      '</label>' +
      '<span class="kf-dashboard-table-pagerange">' + (totalRows === 0 ? '0 of 0' : rangeStart + '–' + rangeEnd + ' of ' + totalRows) + '</span>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-widget-page-prev' + (state.page <= 0 ? ' disabled' : '') + '><span class="kf-icon" data-icon="chevronLeft" data-size="14"></span></button>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-widget-page-next' + (state.page >= pageCount - 1 ? ' disabled' : '') + '><span class="kf-icon" data-icon="chevronLeft" data-size="14" style="transform:rotate(180deg);"></span></button>' +
    '</div>';

  return '<div class="kf-dashboard-table-wrap" data-widget-id="' + widget.id + '">' +
    '<div class="kf-dashboard-table" style="' + gridStyle + '">' +
      '<div class="kf-dashboard-table-header-row" style="display:contents;">' + headerHtml + '</div>' +
      (filterHtml ? '<div class="kf-dashboard-table-filter-row" style="display:contents;">' + filterHtml + '</div>' : '') +
      bodyHtml +
    '</div>' +
    (totalRows === 0 ? '<div class="kf-dashboard-tile-empty">No rows match the current filter.</div>' : '') +
    paginationHtml +
  '</div>';
}

export function wireTableWidget(rootEl, widget, project, onRerender){
  var wrap = rootEl.querySelector('.kf-dashboard-table-wrap[data-widget-id="' + widget.id + '"]');
  if(!wrap) return;
  var state = getTableState(widget.id);

  wrap.querySelectorAll('[data-widget-sort-col]').forEach(function(th){
    th.addEventListener('click', function(){
      var col = th.getAttribute('data-widget-sort-col');
      if(state.sort && state.sort.field === col){
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = {field: col, dir: 'asc'};
      }
      state.page = 0;
      onRerender();
    });
  });
  wrap.querySelectorAll('[data-widget-filter-col]').forEach(function(input){
    input.addEventListener('input', function(){
      var col = input.getAttribute('data-widget-filter-col');
      if(input.value) state.filters[col] = input.value;
      else delete state.filters[col];
    });
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ state.page = 0; onRerender(); }
    });
    input.addEventListener('blur', function(){ state.page = 0; onRerender(); });
  });
  var pageSizeSelect = wrap.querySelector('[data-widget-page-size]');
  if(pageSizeSelect){
    pageSizeSelect.addEventListener('change', function(){
      var val = pageSizeSelect.value;
      state.pageSize = val === 'all' ? 'all' : Number(val);
      state.page = 0;
      onRerender();
    });
  }
  var prevBtn = wrap.querySelector('[data-widget-page-prev]');
  if(prevBtn){
    prevBtn.addEventListener('click', function(){
      state.page = Math.max(0, state.page - 1);
      onRerender();
    });
  }
  var nextBtn = wrap.querySelector('[data-widget-page-next]');
  if(nextBtn){
    nextBtn.addEventListener('click', function(){
      state.page = state.page + 1;
      onRerender();
    });
  }
}

export function exportTableWidgetCsv(widget, project){
  var result;
  try { result = runWidgetQuery(project, widget); }
  catch(e){ return; }
  var lines = [result.columns.map(csvEscapeValue).join(',')];
  result.rows.forEach(function(row){
    lines.push(result.columns.map(function(col){ return csvEscapeValue(row[col]); }).join(','));
  });
  var blob = new Blob([lines.join('\r\n')], {type: 'text/csv;charset=utf-8;'});
  downloadBlob(blob, (widget.title || 'dashboard-widget').replace(/[^a-z0-9\-_]+/gi, '_') + '.csv');
}

/* ---- gauge / barGauge ---- */

/* Shared by both single-run-of-a-widget-type helpers: pulls the configured value column out of the
   query's first result row, normalized against the configured max, clamped to a real 0-100 pct.
   Returns {pct, raw, maxValue} or null (caller renders its own error text for the null case). */
function resolveGaugeValue(widget, project){
  var config = parseConfig(widget);
  var result = runWidgetQuery(project, widget);
  if(result.rows.length === 0) return {error: 'This query returned no rows.'};
  if(!config.valueColumn) return {error: 'No value column configured for this widget.'};
  var raw = Number(result.rows[0][config.valueColumn]);
  if(isNaN(raw)) return {error: 'Value column "' + config.valueColumn + '" was not found, or is not numeric, in the query result.'};
  var maxValue = Number(config.maxValue) || 100;
  var pct = Math.max(0, Math.min(100, (raw / maxValue) * 100));
  return {pct: pct, raw: raw, maxValue: maxValue};
}

export function renderGaugeWidget(widget, project){
  var resolved;
  try { resolved = resolveGaugeValue(widget, project); }
  catch(e){ return errorHtml(e.message || 'Could not run this widget\'s query.'); }
  if(resolved.error) return errorHtml(resolved.error);
  return '<div class="kf-dashboard-gauge-widget">' + buildGaugeBlock(resolved.pct, '', 160, false) + '</div>';
}

/* New shared helper (not a reuse of task-list/health.js's own horizontal-only, ad hoc bar CSS —
   this widget needs a vertical orientation too, and the plan explicitly calls for a fresh, small
   helper here rather than touching either existing already-working call site). */
export function renderBarGauge(pct, opts){
  opts = opts || {};
  var vertical = opts.orientation === 'vertical';
  var valueLabel = opts.valueLabel != null ? escapeHTML(String(opts.valueLabel)) : Math.round(pct) + '%';
  return '<div class="kf-dashboard-bargauge' + (vertical ? ' kf-dashboard-bargauge-vertical' : ' kf-dashboard-bargauge-horizontal') + '">' +
    '<div class="kf-dashboard-bargauge-track"><div class="kf-dashboard-bargauge-fill" style="' + (vertical ? 'height' : 'width') + ':' + pct + '%"></div></div>' +
    '<div class="kf-dashboard-bargauge-label">' + valueLabel + '</div>' +
  '</div>';
}

export function renderBarGaugeWidget(widget, project){
  var resolved;
  try { resolved = resolveGaugeValue(widget, project); }
  catch(e){ return errorHtml(e.message || 'Could not run this widget\'s query.'); }
  if(resolved.error) return errorHtml(resolved.error);
  var config = parseConfig(widget);
  return renderBarGauge(resolved.pct, {orientation: config.orientation, valueLabel: resolved.raw + ' / ' + resolved.maxValue});
}

/* ---- costBenefit ---- */

export function renderCostBenefitWidget(widget, project){
  var result;
  try { result = runWidgetQuery(project, widget); }
  catch(e){ return errorHtml(e.message || 'Could not run this widget\'s query.'); }

  var required = ['businessValue', 'taskCost'];
  var missing = required.filter(function(c){ return result.columns.indexOf(c) === -1; });
  if(missing.length){
    return errorHtml('This widget\'s query is missing required column(s): ' + missing.join(', ') + ' (expects businessValue, taskCost, priority, key, title).');
  }
  if(result.rows.length === 0) return '<div class="kf-dashboard-tile-empty">This query returned no rows.</div>';

  var items = result.rows.map(function(row){
    return {taskId: null, key: row.key, title: row.title, priority: row.priority || 'medium', cost: row.taskCost, value: row.businessValue, archived: false};
  });
  var points = computeCostBenefitScatterPoints(items);
  return '<div class="kf-dashboard-costbenefit-widget">' + buildCostBenefitScatterSvg(points) + '</div>';
}

/* ---- timeline ---- */

function pickTimelineGranularity(days){
  if(days <= 14) return 'day';
  if(days <= 90) return 'week';
  if(days <= 550) return 'month';
  if(days <= 1460) return 'quarter';
  return 'year';
}

var TIMELINE_WIDGET_COL_WIDTH = 80;
var TIMELINE_WIDGET_LABEL_WIDTH = 140;

export function renderTimelineWidget(widget, project){
  var config = parseConfig(widget);
  if(!config.labelColumn || !config.startColumn || !config.endColumn){
    return errorHtml('Configure a label, start date, and end date column for this widget.');
  }
  var result;
  try { result = runWidgetQuery(project, widget); }
  catch(e){ return errorHtml(e.message || 'Could not run this widget\'s query.'); }

  var rows = result.rows.map(function(row){
    var start = row[config.startColumn] ? new Date(row[config.startColumn]) : null;
    var end = row[config.endColumn] ? new Date(row[config.endColumn]) : null;
    return {label: row[config.labelColumn], start: start, end: end};
  }).filter(function(r){ return r.start && !isNaN(r.start.getTime()) && r.end && !isNaN(r.end.getTime()); });

  if(rows.length === 0) return '<div class="kf-dashboard-tile-empty">No rows with valid label/start/end date values.</div>';

  var minStart = new Date(Math.min.apply(null, rows.map(function(r){ return r.start.getTime(); })));
  var maxEnd = new Date(Math.max.apply(null, rows.map(function(r){ return r.end.getTime(); })));
  var days = Math.max(1, (maxEnd.getTime() - minStart.getTime()) / 86400000);
  var columns = buildTimelineColumns(minStart, maxEnd, pickTimelineGranularity(days), TIMELINE_WIDGET_COL_WIDTH);
  var totalWidth = columns.length * TIMELINE_WIDGET_COL_WIDTH;

  var headerHtml = columns.map(function(c){
    return '<div class="kf-dashboard-timeline-col" style="width:' + TIMELINE_WIDGET_COL_WIDTH + 'px;">' + escapeHTML(c.label) + '</div>';
  }).join('');

  var rowsHtml = rows.map(function(r){
    var x1 = tlDateToPixel(r.start, columns);
    var x2 = tlDateToPixel(r.end, columns);
    var left = Math.max(0, Math.min(x1, x2));
    var width = Math.max(4, Math.abs(x2 - x1));
    return '<div class="kf-dashboard-timeline-row">' +
      '<div class="kf-dashboard-timeline-row-label" style="width:' + TIMELINE_WIDGET_LABEL_WIDTH + 'px;">' + escapeHTML(r.label == null ? '' : String(r.label)) + '</div>' +
      '<div class="kf-dashboard-timeline-row-track" style="width:' + totalWidth + 'px;">' +
        '<div class="kf-dashboard-timeline-bar" style="left:' + left + 'px;width:' + width + 'px;" title="' + escapeHTML(r.label == null ? '' : String(r.label)) + '"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  return '<div class="kf-dashboard-timeline-widget">' +
    '<div class="kf-dashboard-timeline-scroll">' +
      '<div class="kf-dashboard-timeline-header-row">' +
        '<div class="kf-dashboard-timeline-row-label" style="width:' + TIMELINE_WIDGET_LABEL_WIDTH + 'px;"></div>' +
        '<div class="kf-dashboard-timeline-header" style="width:' + totalWidth + 'px;">' + headerHtml + '</div>' +
      '</div>' +
      '<div class="kf-dashboard-timeline-rows">' + rowsHtml + '</div>' +
    '</div>' +
  '</div>';
}

/* ---- chart (bar/line/pie/donut) ---- */

export function renderChartWidget(widget, project){
  var config = parseConfig(widget);
  if(!config.categoryColumn || !config.valueColumn){
    return errorHtml('Configure a category column and a value column for this widget.');
  }
  var result;
  try { result = runWidgetQuery(project, widget); }
  catch(e){ return errorHtml(e.message || 'Could not run this widget\'s query.'); }
  if(result.rows.length === 0) return '<div class="kf-dashboard-tile-empty">This query returned no rows.</div>';
  if(result.columns.indexOf(config.categoryColumn) === -1 || result.columns.indexOf(config.valueColumn) === -1){
    return errorHtml('Category column "' + config.categoryColumn + '" or value column "' + config.valueColumn + '" was not found in the query result.');
  }

  var rows = result.rows.map(function(row){ return {category: row[config.categoryColumn], value: row[config.valueColumn]}; });
  var chartType = config.chartType || 'bar';
  var svg = chartType === 'line' ? buildLineChartSvg(rows)
    : chartType === 'pie' ? buildPieChartSvg(rows, {donut: false})
    : chartType === 'donut' ? buildPieChartSvg(rows, {donut: true})
    : buildBarChartSvg(rows);

  if(!svg) return '<div class="kf-dashboard-tile-empty">No positive values to chart.</div>';
  return '<div class="kf-dashboard-chart-widget">' + svg + '</div>';
}

/* ---- text ---- */

export function renderTextWidget(widget){
  var config = parseConfig(widget);
  var markdown = config.markdown || '';
  if(!markdown.trim()) return '<div class="kf-dashboard-tile-empty">No text set.</div>';
  return '<div class="kf-dashboard-text-widget">' + markdownToHtml(markdown) + '</div>';
}

/* ---- dispatch ---- */

export var WIDGET_TYPE_LABELS = {
  table: 'Data Table', gauge: 'Gauge', barGauge: 'Bar Gauge', chart: 'Chart',
  costBenefit: 'Cost/Benefit Chart', timeline: 'Timeline', text: 'Text'
};

/* Returns {html, wire} — wire (may be null) is called with (rootEl, onRerender) right after the html
   is inserted into the DOM, for widget types needing post-insert event wiring. */
export function renderDashboardWidget(widget, project, opts){
  switch(widget.widgetType){
    case 'table':
      return { html: renderTableWidget(widget, project, opts), wire: function(rootEl, onRerender){ wireTableWidget(rootEl, widget, project, onRerender); } };
    case 'text':
      return { html: renderTextWidget(widget), wire: null };
    case 'gauge':
      return { html: renderGaugeWidget(widget, project), wire: null };
    case 'barGauge':
      return { html: renderBarGaugeWidget(widget, project), wire: null };
    case 'costBenefit':
      return { html: renderCostBenefitWidget(widget, project), wire: null };
    case 'timeline':
      return { html: renderTimelineWidget(widget, project), wire: null };
    case 'chart':
      return { html: renderChartWidget(widget, project), wire: null };
    default:
      return { html: '<div class="kf-dashboard-tile-empty">' + escapeHTML(WIDGET_TYPE_LABELS[widget.widgetType] || widget.widgetType) + ' — rendering coming soon</div>', wire: null };
  }
}
