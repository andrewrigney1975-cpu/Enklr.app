"use strict";
import { currentTheme } from '../theme.js';

/* Shared inline-SVG grouped-bar chart for the vendor dashboard's Activity and
   Revenue charts. Hand-rolled SVG (no charting library), matching the rest of
   this codebase's convention (see src/js/views/cost-benefit.js) so the same
   svg-export.js machinery can serialize/export it unchanged.

   Colors are the validated categorical palette (dataviz skill's default
   reference instance, references/palette.md) — fixed slot order, not re-picked
   per chart, and pre-validated for CVD-safe adjacent contrast. */
var PALETTE_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300'];
var PALETTE_DARK  = ['#3987e5', '#199e70', '#c98500', '#008300'];

export function seriesColor(slotIndex){
  var palette = currentTheme() === 'dark' ? PALETTE_DARK : PALETTE_LIGHT;
  return palette[slotIndex % palette.length];
}

function escapeHTML(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function niceCeil(value){
  if(value <= 0) return 1;
  var pow = Math.pow(10, Math.floor(Math.log10(value)));
  var steps = [1, 2, 2.5, 5, 10];
  for(var i = 0; i < steps.length; i++){
    var candidate = steps[i] * pow;
    if(candidate >= value) return candidate;
  }
  return 10 * pow;
}

/* Top corners only rounded, square at the baseline — per the mark spec (a
   plain rx/ry rect would round the bottom corners too, which reads wrong for
   a bar growing from a baseline). */
function roundedTopBarPath(x, y, w, h, r){
  r = Math.max(0, Math.min(r, w / 2, h));
  var top = y, bottom = y + h, left = x, right = x + w;
  return 'M' + left + ',' + bottom +
    ' L' + left + ',' + (top + r) +
    ' Q' + left + ',' + top + ' ' + (left + r) + ',' + top +
    ' L' + (right - r) + ',' + top +
    ' Q' + right + ',' + top + ' ' + right + ',' + (top + r) +
    ' L' + right + ',' + bottom + ' Z';
}

/*
  config = {
    buckets: [{label, values: {seriesKey: number}}],
    series: [{key, label}],           // fixed order == palette slot order
    valueFormatter: fn(number) -> string,
    emptyMessage: string
  }
  Renders into containerEl and returns the <svg> element (or null if empty).
*/
export function renderBucketedChart(containerEl, config){
  var buckets = config.buckets || [];
  var series = config.series || [];
  var valueFormatter = config.valueFormatter || function(v){ return String(Math.round(v)); };

  var hasData = buckets.length > 0 && buckets.some(function(b){
    return series.some(function(s){ return (b.values[s.key] || 0) > 0; });
  });
  if(!hasData){
    containerEl.innerHTML = '<div class="kf-table-empty">' + escapeHTML(config.emptyMessage || 'No data for this range.') + '</div>';
    return null;
  }

  var MARGIN_LEFT = 56, MARGIN_RIGHT = 16, MARGIN_TOP = 16;

  // Fill the container's actual width — never a fixed/capped size — so the chart reads the
  // same whether it's rendering 1 bucket (Year to Date) or 50 (a custom multi-year daily range),
  // and whether the panel itself is full-width or half-width (side-by-side layout). A small
  // per-bucket floor keeps very dense ranges legible instead of collapsing to hairlines; if that
  // floor pushes the total past the container width, .kf-chart-inner's overflow-x:auto (see
  // styles.css) takes over rather than rendering unreadable slivers.
  // clientWidth is the container's padding-inclusive inner width, but a normal-flow child (the
  // svg) only has the content box — clientWidth minus the container's own left/right padding —
  // to lay out in. Sizing the svg to clientWidth directly overshoots by that padding and is
  // exactly what was producing a horizontal scrollbar on every chart.
  var MIN_GROUP_WIDTH = 28;
  var containerStyle = window.getComputedStyle(containerEl);
  var horizontalPadding = parseFloat(containerStyle.paddingLeft || '0') + parseFloat(containerStyle.paddingRight || '0');
  var containerWidth = (containerEl.clientWidth - horizontalPadding) || 800;
  var availableWidth = Math.max(containerWidth - MARGIN_LEFT - MARGIN_RIGHT, MIN_GROUP_WIDTH);
  var GROUP_WIDTH = Math.max(MIN_GROUP_WIDTH, availableWidth / buckets.length);
  var WIDTH = MARGIN_LEFT + MARGIN_RIGHT + GROUP_WIDTH * buckets.length;
  var HEIGHT = 320;

  // Whether labels need to rotate depends on pixels actually available per bucket, not a fixed
  // bucket count — the same 12 buckets fit horizontally in a full-width chart but collide in a
  // half-width one. ~6px/char at this font size is a rough but serviceable estimate.
  var maxLabelLength = buckets.reduce(function(max, b){ return Math.max(max, (b.label || '').length); }, 0);
  var rotateLabels = GROUP_WIDTH < (maxLabelLength * 6 + 12);
  var MARGIN_BOTTOM = rotateLabels ? 64 : 40;

  var plotLeft = MARGIN_LEFT, plotRight = WIDTH - MARGIN_RIGHT;
  var plotTop = MARGIN_TOP, plotBottom = HEIGHT - MARGIN_BOTTOM;
  var plotHeight = plotBottom - plotTop;

  var maxValue = 0;
  buckets.forEach(function(b){
    series.forEach(function(s){ maxValue = Math.max(maxValue, b.values[s.key] || 0); });
  });
  var yMax = niceCeil(maxValue * 1.1);

  function yScale(v){ return plotBottom - (v / yMax) * plotHeight; }

  var TICK_COUNT = 4;
  var gridlinesHTML = '', yLabelsHTML = '';
  for(var t = 0; t <= TICK_COUNT; t++){
    var tickValue = (yMax / TICK_COUNT) * t;
    var ty = yScale(tickValue);
    gridlinesHTML += '<line x1="' + plotLeft + '" y1="' + ty + '" x2="' + plotRight + '" y2="' + ty + '" style="stroke:var(--kf-border);" stroke-width="1"></line>';
    yLabelsHTML += '<text x="' + (plotLeft - 8) + '" y="' + (ty + 4) + '" font-size="11" text-anchor="end" style="fill:var(--kf-text-faint);">' + escapeHTML(valueFormatter(tickValue)) + '</text>';
  }
  var axisHTML = '<line x1="' + plotLeft + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotBottom + '" style="stroke:var(--kf-border-strong);" stroke-width="1.5"></line>';

  var BAR_GAP = 2;
  var barWidth = Math.min(24, (GROUP_WIDTH - BAR_GAP * (series.length + 1)) / series.length);

  var barsHTML = '';
  var xLabelsHTML = '';
  buckets.forEach(function(bucket, bi){
    var groupLeft = plotLeft + bi * GROUP_WIDTH;
    var groupContentWidth = barWidth * series.length + BAR_GAP * (series.length - 1);
    var barsStartX = groupLeft + (GROUP_WIDTH - groupContentWidth) / 2;

    var titleParts = [escapeHTML(bucket.label)];
    series.forEach(function(s){
      titleParts.push(escapeHTML(s.label) + ': ' + escapeHTML(valueFormatter(bucket.values[s.key] || 0)));
    });

    barsHTML += '<g><title>' + titleParts.join('\n') + '</title>';
    series.forEach(function(s, si){
      var value = bucket.values[s.key] || 0;
      var barX = barsStartX + si * (barWidth + BAR_GAP);
      var barY = yScale(value);
      var barH = plotBottom - barY;
      if(barH > 0){
        barsHTML += '<path d="' + roundedTopBarPath(barX, barY, barWidth, barH, 4) + '" fill="' + seriesColor(si) + '"></path>';
      }
    });
    barsHTML += '</g>';

    var labelX = groupLeft + GROUP_WIDTH / 2;
    var labelY = plotBottom + 18;
    if(rotateLabels){
      xLabelsHTML += '<text x="' + labelX + '" y="' + labelY + '" font-size="11" text-anchor="end" transform="rotate(-40, ' + labelX + ', ' + labelY + ')" style="fill:var(--kf-text-faint);">' + escapeHTML(bucket.label) + '</text>';
    } else {
      xLabelsHTML += '<text x="' + labelX + '" y="' + labelY + '" font-size="11" text-anchor="middle" style="fill:var(--kf-text-faint);">' + escapeHTML(bucket.label) + '</text>';
    }
  });

  // Always shown (even for a single series) so charts with a different series count still
  // line up to the same height — e.g. Activity (3 series) and Revenue (1 series) side by side.
  var legendHTML = '<div class="kf-legend">' + series.map(function(s, si){
    return '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:' + seriesColor(si) + ';"></span>' + escapeHTML(s.label) + '</span>';
  }).join('') + '</div>';

  containerEl.innerHTML =
    legendHTML +
    '<svg width="' + WIDTH + '" height="' + HEIGHT + '" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '" xmlns="http://www.w3.org/2000/svg">' +
      gridlinesHTML + yLabelsHTML + axisHTML + barsHTML + xLabelsHTML +
    '</svg>';

  return containerEl.querySelector('svg');
}
