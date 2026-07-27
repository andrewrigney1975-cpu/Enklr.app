"use strict";
import { ICON_PATHS } from '../config.js';

/* =========================================================
   DASHBOARD TILE PREVIEW — a small, hand-rolled inline SVG schematic of a Dashboard's layout,
   drawn on its picker tile (modals/dashboards.js) for both authors and read-only viewers, from the
   lightweight per-widget list (type/width/sortOrder/configJson) the list endpoints now return
   (Dtos/ProjectDtos.cs's DashboardListItemDto/OrgDashboardListItemDto) — no Saved Query execution,
   no per-tile detail fetch, just geometry + an icon per widget.

   Deliberately recomputed fresh on every picker render rather than persisted anywhere: the layout
   math here is trivial (pack width fractions into rows) and the source data (widget type/width/
   order) is already loaded for the tile's own "N widgets" line — there is nothing expensive to save
   by caching a rendered copy, and a cached copy would need its own invalidation-on-layout-change
   logic for no real benefit. Same "compute it fresh, no charting library" convention as every other
   hand-rolled chart in this app.
   ========================================================= */

var PREVIEW_WIDTH = 240;
var PREVIEW_HEIGHT = 100;
var PREVIEW_PAD = 4;
var PREVIEW_GAP = 4;
var PREVIEW_MIN_ROW_HEIGHT = 16;
var PREVIEW_MAX_ROW_HEIGHT = 34;

var WIDTH_FRACTION = {third: 1 / 3, half: 1 / 2, twoThird: 2 / 3, full: 1};

/* Packs widgets into rows the same order-driven way the real dashboard's flex-wrap grid does —
   accumulate fractional widths until the next widget would overflow 1.0, then start a new row.
   This is a nominal-width approximation, not a pixel-exact simulation of the real grid's flex-grow
   fill-remaining-space behavior (root CLAUDE.md's own widget-grid CSS lets a narrower widget grow to
   fill a partial row) — close enough for an "iconic" layout preview, not meant to be pixel-identical. */
function packWidgetsIntoRows(widgets){
  var rows = [];
  var currentRow = [];
  var currentSum = 0;
  var EPSILON = 0.01;
  widgets.forEach(function(w){
    var frac = WIDTH_FRACTION.hasOwnProperty(w.width) ? WIDTH_FRACTION[w.width] : 1;
    if(currentRow.length > 0 && currentSum + frac > 1 + EPSILON){
      rows.push(currentRow);
      currentRow = [];
      currentSum = 0;
    }
    currentRow.push({widget: w, frac: frac});
    currentSum += frac;
  });
  if(currentRow.length > 0) rows.push(currentRow);
  return rows;
}

function parseWidgetConfig(widget){
  if(!widget.configJson) return {};
  try { var c = JSON.parse(widget.configJson); return (c && typeof c === 'object') ? c : {}; }
  catch(e){ return {}; }
}

/* Returns raw <path>/<rect>/etc inner markup (no <svg> wrapper) in a 0-0-24-24 local coordinate
   space, matching ICON_PATHS' own native viewBox — positioned/scaled by the caller via a wrapping
   <g transform>. Reuses an existing global icon directly where a good semantic match already exists
   (quadrant for costBenefit, timeline for timeline, a bar-chart glyph for chart/bar, a document
   glyph for text); hand-draws a small bespoke glyph for the rest, where no existing icon fits. */
function widgetTypeGlyphPaths(widget){
  switch(widget.widgetType){
    case 'table':
      return '<rect x="2" y="3" width="20" height="18" rx="1.5"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/><line x1="10" y1="3" x2="10" y2="21"/>';
    case 'gauge':
      return '<path d="M3 18a9 9 0 0 1 18 0"/><path d="M12 18 17.5 9.5"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/>';
    case 'barGauge':
      return '<rect x="2" y="9" width="20" height="6" rx="3"/><rect x="2" y="9" width="13" height="6" rx="3" fill="currentColor" stroke="none"/>';
    case 'costBenefit':
      return ICON_PATHS.quadrant;
    case 'timeline':
      return ICON_PATHS.timeline;
    case 'text':
      return ICON_PATHS.ty_document;
    case 'chart': {
      var chartType = parseWidgetConfig(widget).chartType || 'bar';
      if(chartType === 'line'){
        return '<polyline points="2,17 8,9 13,12.5 18,4 22,7.5" fill="none"/>';
      }
      if(chartType === 'pie'){
        return '<circle cx="12" cy="12" r="9"/><path d="M12 12 L12 3 A9 9 0 0 1 20.36 17 Z" fill="currentColor" stroke="none"/>';
      }
      if(chartType === 'donut'){
        return '<circle cx="12" cy="12" r="9"/><path d="M12 12 L12 3 A9 9 0 0 1 20.36 17 Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="4" fill="var(--kf-column-bg)" stroke="none"/>';
      }
      return ICON_PATHS.ty_analyse; // bar — the default, and the fallback for an unrecognized sub-type
    }
    default:
      return ICON_PATHS.grid;
  }
}

/* One <g> per widget: a dashed rect for the widget area (per the "dotted lines indicative of the
   widget area" request) plus a centered icon at a fixed, modest size — deliberately not scaled to
   fill a wide "full" widget's whole box, so every glyph reads at the same size regardless of the
   widget's own width. */
function buildWidgetGlyph(x, y, w, h, widget){
  var iconSize = Math.min(20, h - 6, w - 6);
  if(iconSize < 8) return ''; // box too small to draw a legible glyph at all (deeply nested edge case)
  var cx = x + w / 2, cy = y + h / 2;
  var scale = iconSize / 24;
  var tx = cx - iconSize / 2;
  var ty = cy - iconSize / 2;
  return '<g transform="translate(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ') scale(' + scale.toFixed(3) + ')" ' +
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">' +
    widgetTypeGlyphPaths(widget) +
  '</g>';
}

/* widgets: the lightweight {widgetType, width, sortOrder, configJson}[] list DashboardListItemDto/
   OrgDashboardListItemDto now carry. Returns a full <svg>...</svg> string, or null for an empty
   dashboard (caller falls back to its own existing empty-state text). */
export function buildDashboardTilePreviewSvg(widgets){
  if(!widgets || widgets.length === 0) return null;

  var sorted = widgets.slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; });
  var rows = packWidgetsIntoRows(sorted);
  var innerHeight = PREVIEW_HEIGHT - PREVIEW_PAD * 2;
  var rowHeight = Math.max(PREVIEW_MIN_ROW_HEIGHT, Math.min(PREVIEW_MAX_ROW_HEIGHT, (innerHeight - PREVIEW_GAP * (rows.length - 1)) / rows.length));
  var innerWidth = PREVIEW_WIDTH - PREVIEW_PAD * 2;

  var y = PREVIEW_PAD;
  var boxesHtml = rows.map(function(row){
    var x = PREVIEW_PAD;
    var rowHtml = row.map(function(entry){
      var boxWidth = innerWidth * entry.frac - PREVIEW_GAP * (row.length > 1 ? (row.length - 1) / row.length : 0);
      var html = '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + boxWidth.toFixed(1) + '" height="' + rowHeight.toFixed(1) + '" rx="3" ' +
        'fill="none" stroke="var(--kf-border-strong)" stroke-width="1.5" stroke-dasharray="3,2.5"></rect>' +
        buildWidgetGlyph(x, y, boxWidth, rowHeight, entry.widget);
      x += boxWidth + PREVIEW_GAP;
      return html;
    }).join('');
    y += rowHeight + PREVIEW_GAP;
    return rowHtml;
  }).join('');

  return '<svg viewBox="0 0 ' + PREVIEW_WIDTH + ' ' + PREVIEW_HEIGHT + '" xmlns="http://www.w3.org/2000/svg" class="kf-dashboard-tile-preview-svg">' + boxesHtml + '</svg>';
}
