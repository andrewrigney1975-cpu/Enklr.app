"use strict";
import { escapeHTML } from '../views/board.js';
import { executeQuery, QueryError } from './query-engine.js';
import { markdownToHtml } from '../rich-text/markdown.js';
import { sortRows, createRowFilter } from './sort-filter.js';
import { csvEscapeValue } from '../views/task-list.js';
import { downloadBlob } from './svg-export.js';

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

var tableWidgetState = {}; // widgetId -> {sort: {field, dir}, filters: {}}

function getTableState(widgetId){
  if(!tableWidgetState[widgetId]) tableWidgetState[widgetId] = {sort: null, filters: {}};
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
  var showExport = !!opts.canExport && !readOnly;

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
  var bodyHtml = rows.map(function(row){
    return '<div class="kf-dashboard-table-row">' + result.columns.map(function(col){
      return '<div class="kf-dashboard-table-td">' + escapeHTML(row[col] == null ? '' : String(row[col])) + '</div>';
    }).join('') + '</div>';
  }).join('');

  var gridStyle = 'grid-template-columns:repeat(' + result.columns.length + ', minmax(90px, 1fr));';
  return '<div class="kf-dashboard-table-wrap" data-widget-id="' + widget.id + '">' +
    (showExport ? '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm kf-dashboard-table-export-btn" data-widget-export="' + widget.id + '"><span class="kf-icon" data-icon="download" data-size="14"></span>CSV</button>' : '') +
    '<div class="kf-dashboard-table" style="' + gridStyle + '">' +
      '<div class="kf-dashboard-table-header-row" style="display:contents;">' + headerHtml + '</div>' +
      (filterHtml ? '<div class="kf-dashboard-table-filter-row" style="display:contents;">' + filterHtml + '</div>' : '') +
      bodyHtml +
    '</div>' +
    (rows.length === 0 ? '<div class="kf-dashboard-tile-empty">No rows match the current filter.</div>' : '') +
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
      if(e.key === 'Enter') onRerender();
    });
    input.addEventListener('blur', function(){ onRerender(); });
  });
  var exportBtn = wrap.querySelector('[data-widget-export]');
  if(exportBtn){
    exportBtn.addEventListener('click', function(){
      exportTableWidgetCsv(widget, project);
    });
  }
}

function exportTableWidgetCsv(widget, project){
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
    default:
      return { html: '<div class="kf-dashboard-tile-empty">' + escapeHTML(WIDGET_TYPE_LABELS[widget.widgetType] || widget.widgetType) + ' — rendering coming soon</div>', wire: null };
  }
}
