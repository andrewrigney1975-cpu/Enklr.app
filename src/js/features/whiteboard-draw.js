"use strict";
import { roundedOrthogonalPathD, DEPMAP_CORNER_RADIUS } from '../views/dependency-map.js';

/* Collaborative Whiteboard — the SVG element-building half of the feature (session/API/SSE state
   lives in features/whiteboard.js; modals/whiteboard.js wires the two together plus the toolbar).
   Every drawn object is stored server-side as {elementType, elementJson} (opaque JSON, same "no
   CHECK constraints, application-level validation only" convention as Form.FieldsJson) and rendered
   here into a plain SVG markup string for one <g> — the whole canvas is a full innerHTML rebuild on
   every change, same "no diffing anywhere" convention as views/board.js. */

var VIEW_BOX_WIDTH = 1600;
var VIEW_BOX_HEIGHT = 900;

/* Converts a client (viewport) point into the SVG's own internal viewBox coordinate space — the
   canvas is laid out at CSS width/height:100% over a fixed 1600x900 viewBox, so a raw
   clientX/clientY needs rescaling by the element's actual on-screen size, same
   getBoundingClientRect-based approach already established in views/form-workflow-editor.js's own
   clientPointToSvgPoint (no equivalent freehand-path helper existed anywhere before this feature —
   see CLAUDE.md's note on this).

   The canvas's preserveAspectRatio="xMinYMin meet" means the browser scales the 1600x900 viewBox
   UNIFORMLY (by whichever of width/height is more constraining), not independently per axis — the
   wrap element is essentially never exactly 16:9, so using separate scaleX/scaleY derived from the
   raw element box (as an earlier version of this function did) drifts from the real rendered scale
   whenever the two axes' ratios differ, registering drawn points increasingly off from the actual
   cursor position the further the container's aspect ratio is from 16:9. A single uniform scale
   factor (the smaller of the two ratios, matching "meet") is what the browser actually renders at;
   xMinYMin keeps any leftover space on the right/bottom only, so the top-left origin needs no
   offset correction. */
export function clientPointToSvgPoint(svgEl, clientX, clientY){
  var rect = svgEl.getBoundingClientRect();
  var scale = Math.min(rect.width / VIEW_BOX_WIDTH, rect.height / VIEW_BOX_HEIGHT);
  return {x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale};
}

function escapeXml(text){
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shapeFillAttrs(data){
  if(!data.filled) return 'fill="none"';
  var opacity = data.opacity === undefined ? 1 : data.opacity;
  return 'fill="' + data.color + '" fill-opacity="' + opacity + '"';
}

/* A filled shape drawn with Shift held skips the outline entirely (`noStroke: true`) — fill only,
   no opaque border. Only ever set alongside `filled: true`; an outline-only shape always has its
   normal solid stroke, same as before this existed. */
function shapeStrokeAttrs(data, width){
  if(data.noStroke) return '';
  return 'stroke="' + data.color + '" stroke-width="' + width + '"';
}

function pointsToPathD(points){
  if(!points || points.length === 0) return '';
  var d = 'M ' + points[0].x + ' ' + points[0].y;
  for(var i = 1; i < points.length; i++) d += ' L ' + points[i].x + ' ' + points[i].y;
  return d;
}

/* Catmull-Rom-to-cubic-Bezier smoothing through an ordered list of click-placed points (the
   "curve" tool's whole reason for existing over the freehand "pen" tool — a handful of clicked
   vertices instead of every raw pointermove sample). Standard 1/6-tension conversion: each
   segment's two control points are derived from its own endpoints plus one neighbor point on
   either side, clamped to the endpoint itself at the ends of an open curve (no wraparound) rather
   than reaching past the first/last vertex. `closed` only appends the SVG 'Z' close command — the
   curve tool always stores an explicit vertex coincident with the first point when the user closes
   the shape (see modals/whiteboard.js's 10px-proximity snap), so the path already loops back on
   its own; no wraparound-neighbor smoothing is needed to make that join look right. */
export function smoothPathD(points, closed){
  if(!points || points.length === 0) return '';
  if(points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
  if(points.length === 2){
    var d2 = 'M ' + points[0].x + ' ' + points[0].y + ' L ' + points[1].x + ' ' + points[1].y;
    return closed ? d2 + ' Z' : d2;
  }
  var d = 'M ' + points[0].x + ' ' + points[0].y;
  for(var i = 0; i < points.length - 1; i++){
    var p0 = points[i === 0 ? 0 : i - 1];
    var p1 = points[i];
    var p2 = points[i + 1];
    var p3 = points[i + 2 < points.length ? i + 2 : points.length - 1];
    var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + p2.x + ' ' + p2.y;
  }
  if(closed) d += ' Z';
  return d;
}

/* elementJson shapes, one per ElementType (kept intentionally simple/flat — no nested class
   hierarchy, matching this app's "opaque JSON blob" convention elsewhere):
   pen:       {points:[{x,y}...], color, width, opacity?} — opacity is a 0-1 fraction; missing on
              elements drawn before the opacity slider existed, treated as fully opaque (1)
   eraser:    (never stored — see modals/whiteboard.js's eraser handling: it removes elements
              outright via whiteboardApi.removeElement rather than drawing anything of its own)
   text:      {x, y, text, color}
   shape-*:   {x, y, w, h, color, filled?, opacity?, noStroke?} (rect/circle/oval/triangle/diamond,
              x/y/w/h = bounding box; filled/opacity are only present for the toolbar's 2nd-row
              "filled" shape tools — an outline-only shape has neither and renders fill="none" same
              as before either existed; noStroke is only present on a filled shape drawn with Shift
              held, dropping the outline entirely — fill only)
   curve:     {points:[{x,y}...], color, width, closed?, filled?, opacity?, noStroke?} — the
              click-to-place-vertices smooth-curve tool (modals/whiteboard.js's `_curveDrawing`).
              An open curve (ended with Space) always renders at opacity 1 regardless of the
              toolbar's Opacity slider — that slider only ever applies to a *closed* curve's fill,
              same "opacity is a fill property, not a stroke property" rule the filled shape tools
              already follow. `closed` is set when the user clicked back within 10px of the first
              vertex (see the same file's proximity snap) — the stored point list already has an
              explicit last vertex coincident with the first in that case, so smoothPathD's own
              'Z' is just a formality, not what actually closes the visible gap.
   connector: {x1, y1, x2, y2, color, corner?: {x, y}, curve?: true} — corner is only present when
              the connector was drawn as a Shift-held right-angle bend (see computeConnectorCorner
              below); curve is only present when it was drawn as an Alt/Option-held smooth curve (see
              connectorCurvePathD below) — the two modifiers are mutually exclusive (Alt wins if
              both are somehow held, see modals/whiteboard.js), and a plain diagonal drag has
              neither, rendering as a single straight segment, unchanged from before either existed.
              Both corner and curve are fully recomputable from x1/y1/x2/y2 alone (pure functions of
              the two endpoints) — corner is still stored explicitly rather than recomputed at
              render time since it's the more natural place to freeze "which of the two right-angle
              directions the user actually drew," but curve is intentionally just a boolean, since
              its control points are always the same deterministic function of the endpoints. */

/* Shift-drawn connectors get a single right-angle bend, same idea as the Task Dependency Connector's
   own routing (views/board.js) — but here there's no column geometry to route around, just the two
   endpoints, so the bend always goes through whichever of the two candidate corners
   ({x2,y1} or {x1,y2}) keeps the LONGER of the two segments first, matching how a quick freehand
   "mostly horizontal" or "mostly vertical" drag reads to the person drawing it. Returns null for an
   already-axis-aligned drag (x1===x2 or y1===y2) since there's no diagonal to turn into a bend. */
export function computeConnectorCorner(x1, y1, x2, y2){
  if(x1 === x2 || y1 === y2) return null;
  return Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? {x: x2, y: y1} : {x: x1, y: y2};
}

/* Alt/Option-drawn connectors get a single smooth cubic-Bezier "S" curve instead of a straight
   segment or a right-angle bend — unlike the Shift bend, this applies regardless of the drag's
   orientation (even an already-axis-aligned drag still curves), since it's a deliberately different
   connector style rather than a routing fix for a diagonal. The two control points sit at the 1/3
   and 2/3 points along the straight line between the endpoints, each offset perpendicular to it by
   a fixed fraction of the line's own length (in opposite directions), which is what gives the curve
   its gentle symmetric "S" shape rather than a lopsided bulge — the same construction used by most
   diagramming tools' "curved connector" style. */
export function connectorCurvePathD(x1, y1, x2, y2){
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy) || 1;
  var nx = -dy / len, ny = dx / len;
  var offset = len * 0.18;
  var c1x = x1 + dx / 3 + nx * offset, c1y = y1 + dy / 3 + ny * offset;
  var c2x = x1 + dx * 2 / 3 - nx * offset, c2y = y1 + dy * 2 / 3 - ny * offset;
  return 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + x2 + ' ' + y2;
}

export function renderElementSvg(element){
  var data;
  try { data = JSON.parse(element.elementJson); } catch(e){ return ''; }
  var type = element.elementType;
  var groupAttrs = 'data-element-id="' + element.id + '" class="kf-wb-element"';

  if(type === 'pen'){
    var opacity = data.opacity === undefined ? 1 : data.opacity;
    return '<g ' + groupAttrs + '><path d="' + pointsToPathD(data.points) + '" fill="none" stroke="' + data.color + '" stroke-width="' + data.width + '" stroke-opacity="' + opacity + '" stroke-linecap="round" stroke-linejoin="round"/></g>';
  }
  if(type === 'text'){
    return '<g ' + groupAttrs + '><text x="' + data.x + '" y="' + data.y + '" fill="' + data.color + '" font-size="18" font-family="inherit">' + escapeXml(data.text) + '</text></g>';
  }
  if(type === 'connector'){
    var d;
    if(data.curve){
      d = connectorCurvePathD(data.x1, data.y1, data.x2, data.y2);
    } else {
      var pts = [{x: data.x1, y: data.y1}];
      if(data.corner) pts.push(data.corner);
      pts.push({x: data.x2, y: data.y2});
      d = roundedOrthogonalPathD(pts, DEPMAP_CORNER_RADIUS);
    }
    return '<g ' + groupAttrs + '><path d="' + d + '" fill="none" stroke="' + data.color + '" stroke-width="2.5" marker-start="url(#kf-wb-dot-start)" marker-end="url(#kf-wb-dot-end)"/></g>';
  }
  if(type === 'shape-rect'){
    return '<g ' + groupAttrs + '><rect x="' + data.x + '" y="' + data.y + '" width="' + data.w + '" height="' + data.h + '" ' + shapeFillAttrs(data) + ' ' + shapeStrokeAttrs(data, 2.5) + '/></g>';
  }
  if(type === 'shape-circle' || type === 'shape-oval'){
    var rx = data.w / 2, ry = data.h / 2;
    return '<g ' + groupAttrs + '><ellipse cx="' + (data.x + rx) + '" cy="' + (data.y + ry) + '" rx="' + Math.abs(rx) + '" ry="' + Math.abs(ry) + '" ' + shapeFillAttrs(data) + ' ' + shapeStrokeAttrs(data, 2.5) + '/></g>';
  }
  if(type === 'shape-triangle'){
    var p = data.x + ',' + (data.y + data.h) + ' ' + (data.x + data.w / 2) + ',' + data.y + ' ' + (data.x + data.w) + ',' + (data.y + data.h);
    return '<g ' + groupAttrs + '><polygon points="' + p + '" ' + shapeFillAttrs(data) + ' ' + shapeStrokeAttrs(data, 2.5) + '/></g>';
  }
  if(type === 'shape-diamond'){
    var cx = data.x + data.w / 2, cy = data.y + data.h / 2;
    var pd = cx + ',' + data.y + ' ' + (data.x + data.w) + ',' + cy + ' ' + cx + ',' + (data.y + data.h) + ' ' + data.x + ',' + cy;
    return '<g ' + groupAttrs + '><polygon points="' + pd + '" ' + shapeFillAttrs(data) + ' ' + shapeStrokeAttrs(data, 2.5) + '/></g>';
  }
  if(type === 'curve'){
    var curveD = smoothPathD(data.points, !!data.closed);
    var width = data.width || 3;
    if(data.closed){
      return '<g ' + groupAttrs + '><path d="' + curveD + '" ' + shapeFillAttrs(data) + ' ' + shapeStrokeAttrs(data, width) + ' stroke-linecap="round" stroke-linejoin="round"/></g>';
    }
    var curveOpacity = data.opacity === undefined ? 1 : data.opacity;
    return '<g ' + groupAttrs + '><path d="' + curveD + '" fill="none" stroke="' + data.color + '" stroke-width="' + width + '" stroke-opacity="' + curveOpacity + '" stroke-linecap="round" stroke-linejoin="round"/></g>';
  }
  return '';
}

export function renderElementsLayer(elements){
  return elements.map(renderElementSvg).join('');
}
