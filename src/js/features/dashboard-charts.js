"use strict";
import { escapeHTML } from '../views/board.js';

/* =========================================================
   DASHBOARD CHARTS — bar/line/pie/donut, hand-rolled inline SVG (root CLAUDE.md's "no charting
   library, ever" rule). v1 scope, called out explicitly per the plan: one category column + one
   value column per chart (single-series bar/line, category+value pie/donut) — multi-series is a
   documented future extension, not silently unsupported.

   Color follows the dataviz skill's job-based rule: bar/line track ONE measure across categories
   (a single series, not per-category identity), so every bar/point uses the same series-1 hue.
   Pie/donut's slices ARE the categories (identity), so each gets its own slot from the fixed,
   validated 8-color categorical order in styles.css's --kf-chart-series-N — never cycled; a 9th
   distinct category folds into "Other" rather than generating a new hue.
   ========================================================= */

export var CHART_WIDTH = 480;
export var CHART_HEIGHT = 300;
var MARGIN = {left: 44, right: 16, top: 16, bottom: 36};
var SERIES_SLOTS = 8;

function seriesColorVar(i){ return 'var(--kf-chart-series-' + (i + 1) + ')'; }

function formatNumber(n){
  return (Math.round(n * 100) / 100).toString();
}

function truncateLabel(s){
  s = String(s == null ? '' : s);
  return s.length > 10 ? s.slice(0, 9) + '…' : s;
}

/* Duplicate category values (a query that isn't already pre-grouped) are summed, never silently
   dropped — matches what "one category column + one value column" implies to a user who hasn't
   written GROUP BY themselves. */
function aggregateByCategory(rows){
  var order = [];
  var totals = {};
  rows.forEach(function(r){
    var cat = r.category == null ? '' : String(r.category);
    var val = Number(r.value) || 0;
    if(!totals.hasOwnProperty(cat)){ totals[cat] = 0; order.push(cat); }
    totals[cat] += val;
  });
  return order.map(function(cat){ return {category: cat, value: totals[cat]}; });
}

/* Never generates a 9th hue — the smallest remaining slices fold into "Other" instead (dataviz
   skill's categorical-palette rule). Only meaningful for pie/donut, where each item gets its own
   color slot; bar/line use one hue regardless of category count. */
function foldExtraCategoriesIntoOther(items){
  if(items.length <= SERIES_SLOTS) return items;
  var sorted = items.slice().sort(function(a, b){ return b.value - a.value; });
  var kept = sorted.slice(0, SERIES_SLOTS - 1);
  var rest = sorted.slice(SERIES_SLOTS - 1);
  var otherTotal = rest.reduce(function(sum, it){ return sum + it.value; }, 0);
  kept.push({category: 'Other', value: otherTotal});
  return kept;
}

export function buildBarChartSvg(rows){
  var items = aggregateByCategory(rows);
  if(items.length === 0) return null;

  var plotLeft = MARGIN.left, plotRight = CHART_WIDTH - MARGIN.right;
  var plotTop = MARGIN.top, plotBottom = CHART_HEIGHT - MARGIN.bottom;
  var plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;
  var maxVal = Math.max.apply(null, items.map(function(it){ return it.value; }).concat([0])) || 1;
  var n = items.length;
  var slotW = plotW / n;
  var barW = Math.max(4, Math.min(48, slotW * 0.6));

  var gridHTML = [0, 0.25, 0.5, 0.75, 1].map(function(f){
    var y = plotBottom - f * plotH;
    return '<line x1="' + plotLeft + '" y1="' + y + '" x2="' + plotRight + '" y2="' + y + '" stroke="var(--kf-border)" stroke-width="1"></line>' +
      '<text x="' + (plotLeft - 6) + '" y="' + (y + 3) + '" font-size="10" text-anchor="end" fill="var(--kf-text-faint)">' + formatNumber(maxVal * f) + '</text>';
  }).join('');

  var barsHTML = items.map(function(it, i){
    var h = plotH * (Math.max(0, it.value) / maxVal);
    var x = plotLeft + slotW * i + (slotW - barW) / 2;
    var y = plotBottom - h;
    return '<g>' +
      '<title>' + escapeHTML(it.category) + ': ' + formatNumber(it.value) + '</title>' +
      '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="3" style="fill:' + seriesColorVar(0) + '"></rect>' +
      '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (plotBottom + 16) + '" font-size="10" text-anchor="middle" fill="var(--kf-text-faint)">' + escapeHTML(truncateLabel(it.category)) + '</text>' +
    '</g>';
  }).join('');

  return '<svg viewBox="0 0 ' + CHART_WIDTH + ' ' + CHART_HEIGHT + '" xmlns="http://www.w3.org/2000/svg">' + gridHTML + barsHTML + '</svg>';
}

export function buildLineChartSvg(rows){
  var items = aggregateByCategory(rows);
  if(items.length === 0) return null;

  var plotLeft = MARGIN.left, plotRight = CHART_WIDTH - MARGIN.right;
  var plotTop = MARGIN.top, plotBottom = CHART_HEIGHT - MARGIN.bottom;
  var plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;
  var maxVal = Math.max.apply(null, items.map(function(it){ return it.value; }).concat([0]));
  var minVal = Math.min.apply(null, items.map(function(it){ return it.value; }).concat([0]));
  var range = (maxVal - minVal) || 1;
  var n = items.length;
  var stepX = n > 1 ? plotW / (n - 1) : 0;

  function xAt(i){ return plotLeft + stepX * i; }
  function yAt(v){ return plotBottom - ((v - minVal) / range) * plotH; }

  var gridHTML = [0, 0.25, 0.5, 0.75, 1].map(function(f){
    var y = plotTop + f * plotH;
    var val = maxVal - f * range;
    return '<line x1="' + plotLeft + '" y1="' + y + '" x2="' + plotRight + '" y2="' + y + '" stroke="var(--kf-border)" stroke-width="1"></line>' +
      '<text x="' + (plotLeft - 6) + '" y="' + (y + 3) + '" font-size="10" text-anchor="end" fill="var(--kf-text-faint)">' + formatNumber(val) + '</text>';
  }).join('');

  var pathD = items.map(function(it, i){ return (i === 0 ? 'M ' : 'L ') + xAt(i).toFixed(1) + ' ' + yAt(it.value).toFixed(1); }).join(' ');
  var pointsHTML = items.map(function(it, i){
    return '<g><title>' + escapeHTML(it.category) + ': ' + formatNumber(it.value) + '</title>' +
      '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(it.value).toFixed(1) + '" r="4" style="fill:' + seriesColorVar(0) + '"></circle></g>';
  }).join('');
  var labelsHTML = items.map(function(it, i){
    return '<text x="' + xAt(i).toFixed(1) + '" y="' + (plotBottom + 16) + '" font-size="10" text-anchor="middle" fill="var(--kf-text-faint)">' + escapeHTML(truncateLabel(it.category)) + '</text>';
  }).join('');

  return '<svg viewBox="0 0 ' + CHART_WIDTH + ' ' + CHART_HEIGHT + '" xmlns="http://www.w3.org/2000/svg">' +
    gridHTML +
    '<path d="' + pathD + '" fill="none" style="stroke:' + seriesColorVar(0) + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
    pointsHTML + labelsHTML +
  '</svg>';
}

function polarToCartesian(cx, cy, r, angleDeg){
  var rad = (angleDeg - 90) * Math.PI / 180;
  return {x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad)};
}

export function buildPieChartSvg(rows, opts){
  opts = opts || {};
  var donut = !!opts.donut;
  var items = foldExtraCategoriesIntoOther(aggregateByCategory(rows).filter(function(it){ return it.value > 0; }));
  var total = items.reduce(function(sum, it){ return sum + it.value; }, 0);
  if(items.length === 0 || total <= 0) return null;

  var size = CHART_HEIGHT;
  var cx = size / 2, cy = size / 2, r = size / 2 - 20;
  var innerR = donut ? r * 0.55 : 0;

  var slicesHTML;
  if(items.length === 1){
    // A full-circle sweep degenerates the arc-path math below (start===end after a 360° sweep) —
    // draw it directly instead of routing a single category through the multi-slice arc path.
    slicesHTML = donut
      ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((r + innerR) / 2) + '" fill="none" style="stroke:' + seriesColorVar(0) + '" stroke-width="' + (r - innerR) + '"><title>' + escapeHTML(items[0].category) + ': ' + formatNumber(items[0].value) + ' (100%)</title></circle>'
      : '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" style="fill:' + seriesColorVar(0) + '"><title>' + escapeHTML(items[0].category) + ': ' + formatNumber(items[0].value) + ' (100%)</title></circle>';
  } else {
    var angle = 0;
    slicesHTML = items.map(function(it, i){
      var sweep = (it.value / total) * 360;
      var start = angle, end = angle + sweep;
      angle = end;
      var outer1 = polarToCartesian(cx, cy, r, start);
      var outer2 = polarToCartesian(cx, cy, r, end);
      var largeArc = (end - start) > 180 ? 1 : 0;
      var color = seriesColorVar(i);
      var pct = Math.round((it.value / total) * 1000) / 10;
      var d;
      if(donut){
        var inner1 = polarToCartesian(cx, cy, innerR, start);
        var inner2 = polarToCartesian(cx, cy, innerR, end);
        d = 'M ' + outer1.x.toFixed(1) + ' ' + outer1.y.toFixed(1) +
          ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + outer2.x.toFixed(1) + ' ' + outer2.y.toFixed(1) +
          ' L ' + inner2.x.toFixed(1) + ' ' + inner2.y.toFixed(1) +
          ' A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 0 ' + inner1.x.toFixed(1) + ' ' + inner1.y.toFixed(1) +
          ' Z';
      } else {
        d = 'M ' + cx + ' ' + cy + ' L ' + outer1.x.toFixed(1) + ' ' + outer1.y.toFixed(1) +
          ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + outer2.x.toFixed(1) + ' ' + outer2.y.toFixed(1) + ' Z';
      }
      return '<path d="' + d + '" style="fill:' + color + '" stroke="var(--kf-surface)" stroke-width="2"><title>' + escapeHTML(it.category) + ': ' + formatNumber(it.value) + ' (' + pct + '%)</title></path>';
    }).join('');
  }

  var legendHTML = '<div class="kf-dashboard-chart-legend">' + items.map(function(it, i){
    return '<span class="kf-dashboard-chart-legend-item"><span class="kf-dashboard-chart-legend-dot" style="background:' + seriesColorVar(i) + '"></span>' + escapeHTML(it.category) + '</span>';
  }).join('') + '</div>';

  return '<div class="kf-dashboard-chart-pie-wrap"><svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' + slicesHTML + '</svg>' + legendHTML + '</div>';
}
