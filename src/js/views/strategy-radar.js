"use strict";
import { escapeHTML } from '../utils.js';

/* Hand-rolled SVG radar/spider chart — no charting library, ever (root CLAUDE.md §1). Reuses
   modals/health.js's polarPoint(cx, cy, r, angleDeg) formula verbatim (duplicated in, ~4 lines —
   cheaper than restructuring that module's boundary, matching this codebase's own "duplicate the
   small helper" convention) and views/governance-map.js's cos-based label-anchoring idea for axis
   labels that sit left/right of center. One function serves all three radar modes (per-project,
   portfolio-aggregate, multi-project overlay) by varying what's passed in as `series`. */
function polarPoint(cx, cy, r, angleDeg){
  var rad = angleDeg * Math.PI / 180;
  return {x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad)};
}

export var SERIES_COLORS = ['#5b8def', '#e0724a', '#4caf7d', '#c05fd6', '#d6b33f'];

/**
 * pillars: [{id, name}]
 * series: [{label, values: {<pillarId>: number 0-100}, color?}] — a pillar with no value in a given
 *   series' `values` map renders as 0 on that axis (never omitted — every series needs the same
 *   closed polygon shape to overlay meaningfully).
 * opts: {size}
 */
export function buildRadarSvg(pillars, series, opts){
  opts = opts || {};
  var size = opts.size || 480;
  var cx = size / 2, cy = size / 2;
  var maxR = size * 0.34;
  var labelR = maxR + 22;
  var n = pillars.length;

  // Axis labels use text-anchor="end"/"start" for the left/right halves (see below), so a long
  // pillar name grows OUTWARD from its anchor point and can extend well past a plain 0..size
  // viewBox — clipping the label instead of just overflowing into unused margin. Widen the viewBox
  // horizontally (and slightly vertically) based on the longest label, rather than a fixed guess,
  // so this scales with whatever pillar names an org actually defines. ~6.2px/char is a rough
  // average glyph width for this label's 11px sans-serif font — approximate on purpose, this only
  // needs to be a safe overestimate, not exact (no DOM measurement available at string-build time).
  var maxLabelChars = pillars.reduce(function(max, p){ return Math.max(max, (p.name || '').length); }, 0);
  var hPad = Math.max(20, Math.round(maxLabelChars * 6.2) + 10);
  var vPad = 20;
  var viewBox = (-hPad) + ' ' + (-vPad) + ' ' + (size + hPad * 2) + ' ' + (size + vPad * 2);
  var totalWidth = size + hPad * 2;

  if(n < 3){
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" style="max-width:' + size + 'px">' +
      '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" class="kf-strategy-radar-empty">Add at least 3 pillars to see a radar chart.</text></svg>';
  }

  var angleStep = 360 / n;
  var axisAngles = pillars.map(function(_, i){ return 90 - i * angleStep; });

  // Concentric grid rings at 25/50/75/100%, plus one spoke line per pillar axis.
  var rings = [0.25, 0.5, 0.75, 1].map(function(frac){
    var pts = axisAngles.map(function(angle){
      var p = polarPoint(cx, cy, maxR * frac, angle);
      return p.x.toFixed(2) + ',' + p.y.toFixed(2);
    }).join(' ');
    return '<polygon points="' + pts + '" class="kf-strategy-radar-ring" />';
  }).join('');

  var spokes = axisAngles.map(function(angle){
    var p = polarPoint(cx, cy, maxR, angle);
    return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x.toFixed(2) + '" y2="' + p.y.toFixed(2) + '" class="kf-strategy-radar-spoke" />';
  }).join('');

  var labels = pillars.map(function(pillar, i){
    var angle = axisAngles[i];
    var p = polarPoint(cx, cy, labelR, angle);
    var cosVal = Math.cos(angle * Math.PI / 180);
    var anchor = cosVal > 0.15 ? 'start' : (cosVal < -0.15 ? 'end' : 'middle');
    return '<text x="' + p.x.toFixed(2) + '" y="' + p.y.toFixed(2) + '" text-anchor="' + anchor + '" class="kf-strategy-radar-label">' + escapeHTML(pillar.name) + '</text>';
  }).join('');

  var polygons = series.map(function(s, seriesIdx){
    var color = s.color || SERIES_COLORS[seriesIdx % SERIES_COLORS.length];
    var pts = pillars.map(function(pillar, i){
      var value = Math.max(0, Math.min(100, s.values[pillar.id] || 0));
      var p = polarPoint(cx, cy, maxR * (value / 100), axisAngles[i]);
      return p.x.toFixed(2) + ',' + p.y.toFixed(2);
    }).join(' ');
    var dots = pillars.map(function(pillar, i){
      var value = Math.max(0, Math.min(100, s.values[pillar.id] || 0));
      var p = polarPoint(cx, cy, maxR * (value / 100), axisAngles[i]);
      return '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="3" fill="' + color + '" />';
    }).join('');
    return '<polygon points="' + pts + '" fill="' + color + '" fill-opacity="0.15" stroke="' + color + '" stroke-width="2" />' + dots;
  }).join('');

  var legend = series.length > 1 ? '<div class="kf-strategy-radar-legend">' + series.map(function(s, i){
    var color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
    return '<span class="kf-strategy-radar-legend-item"><span class="kf-strategy-radar-legend-swatch" style="background:' + color + '"></span>' + escapeHTML(s.label) + '</span>';
  }).join('') + '</div>' : '';

  var svg = '<svg viewBox="' + viewBox + '" width="100%" style="max-width:' + totalWidth + 'px">' +
    rings + spokes + polygons + labels +
  '</svg>';

  return svg + legend;
}
