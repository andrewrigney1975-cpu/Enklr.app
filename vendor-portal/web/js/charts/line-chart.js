"use strict";

/* Minimal hand-rolled SVG line chart for a live-updating single-series time series with per-point
   status coloring (normal / above-average / severely-above-average / failed ping) — deliberately
   separate from bucketed-chart.js's grouped-bar renderer, which assumes discrete labeled buckets
   rather than a continuously-arriving point stream. Built for the Dashboard's "Database Latency"
   widget (features/db-latency-monitor.js) but has no dependency on it beyond the config shape below,
   so it's reusable for any other live single-series metric later. */

function escapeHTML(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function formatUTCTimestamp(ms){
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');
}
function formatUTCTimeShort(ms){
  var d = new Date(ms);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0') + ' UTC';
}

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

/*
  config = {
    points: [{rtt: number|null, status: 'normal'|'above'|'severe', t: epochMs}],  // rtt null == failed ping
    average: number,
    colors: {normal, above, severe, avgLine},
    valueFormatter: fn(number) -> string,
    windowSize: number   // fixed points-per-screen used for x-spacing — see xScale below. Falls
                          // back to points.length (the old "stretch to fill" behavior) if omitted.
  }
  Renders into containerEl and returns the <svg> element (or null if there's nothing to plot yet).
*/
export function renderLatencyLineChart(containerEl, config){
  var points = config.points || [];
  var valueFormatter = config.valueFormatter || function(v){ return Math.round(v) + 'ms'; };
  var colors = config.colors;

  if(points.length === 0){
    containerEl.innerHTML = '<div class="kf-table-empty">Waiting for the first ping…</div>';
    return null;
  }

  var MARGIN_LEFT = 56, MARGIN_RIGHT = 16, MARGIN_TOP = 16, MARGIN_BOTTOM = 8;
  var containerStyle = window.getComputedStyle(containerEl);
  var horizontalPadding = parseFloat(containerStyle.paddingLeft || '0') + parseFloat(containerStyle.paddingRight || '0');
  var WIDTH = Math.max((containerEl.clientWidth - horizontalPadding) || 800, 300);
  // fillHeight: true (the modal's big view — see styles.css's #dbLatencyModalChartInner flex:1)
  // stretches the chart to whatever height its flex-column parent actually gave the container,
  // instead of the small inline widget's fixed 220px.
  var verticalPadding = parseFloat(containerStyle.paddingTop || '0') + parseFloat(containerStyle.paddingBottom || '0');
  var HEIGHT = config.fillHeight ? Math.max((containerEl.clientHeight - verticalPadding) || 0, 160) : 220;

  var plotLeft = MARGIN_LEFT, plotRight = WIDTH - MARGIN_RIGHT;
  var plotTop = MARGIN_TOP, plotBottom = HEIGHT - MARGIN_BOTTOM;
  var plotHeight = plotBottom - plotTop;
  var plotWidth = plotRight - plotLeft;

  var maxRtt = 0;
  points.forEach(function(p){ if(p.rtt != null) maxRtt = Math.max(maxRtt, p.rtt); });
  var yMax = niceCeil(Math.max(maxRtt * 1.15, config.average * 1.5, 10));

  function yScale(v){ return plotBottom - (v / yMax) * plotHeight; }
  // Fixed pixels-per-point (calibrated to windowSize, the caller's "how many points make a full
  // screen" — e.g. 5 minutes' worth at the ping interval), not "spread whatever we have across the
  // full width". Below windowSize, points sit at their real spacing and simply don't reach the
  // right edge yet (the chart fills in from the left as data arrives); once the caller starts
  // slicing history down to windowSize points, this same fixed spacing makes new points land at a
  // constant position each time, giving the appearance of the whole chart scrolling left.
  var windowSize = config.windowSize || points.length || 1;
  var pixelsPerPoint = windowSize > 1 ? plotWidth / (windowSize - 1) : 0;
  function xScale(i){ return plotLeft + i * pixelsPerPoint; }

  var TICK_COUNT = 4;
  var gridHTML = '', yLabelsHTML = '';
  for(var t = 0; t <= TICK_COUNT; t++){
    var tickValue = (yMax / TICK_COUNT) * t;
    var ty = yScale(tickValue);
    gridHTML += '<line x1="' + plotLeft + '" y1="' + ty + '" x2="' + plotRight + '" y2="' + ty + '" style="stroke:var(--kf-border);" stroke-width="1"></line>';
    yLabelsHTML += '<text x="' + (plotLeft - 8) + '" y="' + (ty + 4) + '" font-size="11" text-anchor="end" style="fill:var(--kf-text-faint);">' + escapeHTML(valueFormatter(tickValue)) + '</text>';
  }
  var axisHTML = '<line x1="' + plotLeft + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotBottom + '" style="stroke:var(--kf-border-strong);" stroke-width="1.5"></line>';

  var avgLineHTML = '';
  if(config.average > 0){
    var avgY = yScale(config.average);
    avgLineHTML =
      '<line x1="' + plotLeft + '" y1="' + avgY + '" x2="' + plotRight + '" y2="' + avgY + '" style="stroke:' + colors.avgLine + ';" stroke-width="1.5" stroke-dasharray="5,4"></line>' +
      '<text x="' + (plotRight - 4) + '" y="' + (avgY - 6) + '" font-size="10" text-anchor="end" style="fill:' + colors.avgLine + ';">avg ' + escapeHTML(valueFormatter(config.average)) + '</text>';
  }

  // The connecting line breaks (doesn't interpolate) across a failed ping, so an outage reads as a
  // visible gap rather than a misleadingly smooth line jumping straight over it.
  var lineHTML = '';
  var segment = [];
  function flushSegment(){
    if(segment.length > 1){
      lineHTML += '<polyline points="' + segment.join(' ') + '" fill="none" style="stroke:' + colors.normal + ';" stroke-width="2"></polyline>';
    }
    segment = [];
  }
  points.forEach(function(p, i){
    if(p.rtt == null){ flushSegment(); return; }
    segment.push(xScale(i) + ',' + yScale(p.rtt));
  });
  flushSegment();

  var pointsHTML = '';
  points.forEach(function(p, i){
    var x = xScale(i);
    if(p.rtt == null){
      pointsHTML +=
        '<g><title>Ping failed</title>' +
        '<line x1="' + x + '" y1="' + plotTop + '" x2="' + x + '" y2="' + plotBottom + '" style="stroke:' + colors.severe + ';" stroke-width="1.5" stroke-dasharray="2,3"></line>' +
        '<circle cx="' + x + '" cy="' + (plotTop + 8) + '" r="4" fill="' + colors.severe + '"></circle>' +
        '</g>';
      return;
    }
    var y = yScale(p.rtt);
    var color = colors[p.status] || colors.normal;
    // "Above" keeps the base non-normal marker size but gains a +6px-diameter (+3px radius) 50%
    // halo; "severe" doubles the marker itself AND gets a bigger +12px-diameter (+6px radius) halo
    // — two visually distinct escalation steps, not just a color change, so severity reads even to
    // someone not consciously distinguishing orange from red.
    var baseR = 3.5;
    var r = p.status === 'normal' ? 2.5 : (p.status === 'severe' ? baseR * 2 : baseR);
    var haloHTML = '';
    if(p.status === 'above'){
      haloHTML = '<circle cx="' + x + '" cy="' + y + '" r="' + (r + 3) + '" fill="' + color + '" opacity="0.5"></circle>';
    } else if(p.status === 'severe'){
      haloHTML = '<circle cx="' + x + '" cy="' + y + '" r="' + (r + 6) + '" fill="' + color + '" opacity="0.5"></circle>';
    }

    var titleText = valueFormatter(p.rtt);
    var labelHTML = '';
    if(p.status === 'severe' && p.t != null){
      titleText += ' at ' + formatUTCTimestamp(p.t);
      // Redrawn fresh on every ping alongside the point itself (this whole chart is a full
      // re-render, not an incremental patch), so the label naturally "moves with" the point as it
      // shifts screen position across renders/scrolling — there's no separate animation to wire up.
      // Flips to the point's left once it's past the halfway mark so it doesn't run off the
      // right edge of the plot for a spike that lands late in the visible window.
      var onRightHalf = x > plotLeft + plotWidth / 2;
      var labelX = onRightHalf ? x - (r + 8) : x + (r + 8);
      var anchor = onRightHalf ? 'end' : 'start';
      var labelText = valueFormatter(p.rtt) + '  ' + formatUTCTimeShort(p.t);
      labelHTML = '<text x="' + labelX + '" y="' + (y + 4) + '" font-size="10" font-weight="600" text-anchor="' + anchor + '" style="fill:' + color + ';">' + escapeHTML(labelText) + '</text>';
    }

    pointsHTML += haloHTML + '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '"><title>' + escapeHTML(titleText) + '</title></circle>' + labelHTML;
  });

  containerEl.innerHTML =
    '<svg width="' + WIDTH + '" height="' + HEIGHT + '" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '" xmlns="http://www.w3.org/2000/svg">' +
      gridHTML + yLabelsHTML + axisHTML + avgLineHTML + lineHTML + pointsHTML +
    '</svg>';

  return containerEl.querySelector('svg');
}
