"use strict";
import { roundedOrthogonalPathD } from '../views/dependency-map.js';

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

function pointsToPathD(points){
  if(!points || points.length === 0) return '';
  var d = 'M ' + points[0].x + ' ' + points[0].y;
  for(var i = 1; i < points.length; i++) d += ' L ' + points[i].x + ' ' + points[i].y;
  return d;
}

/* elementJson shapes, one per ElementType (kept intentionally simple/flat — no nested class
   hierarchy, matching this app's "opaque JSON blob" convention elsewhere):
   pen:       {points:[{x,y}...], color, width}
   eraser:    (never stored — see modals/whiteboard.js's eraser handling: it removes elements
              outright via whiteboardApi.removeElement rather than drawing anything of its own)
   text:      {x, y, text, color}
   shape-*:   {x, y, w, h, color}          (rect/circle/oval/triangle/diamond, x/y/w/h = bounding box)
   connector: {x1, y1, x2, y2, color} */

export function renderElementSvg(element){
  var data;
  try { data = JSON.parse(element.elementJson); } catch(e){ return ''; }
  var type = element.elementType;
  var groupAttrs = 'data-element-id="' + element.id + '" class="kf-wb-element"';

  if(type === 'pen'){
    return '<g ' + groupAttrs + '><path d="' + pointsToPathD(data.points) + '" fill="none" stroke="' + data.color + '" stroke-width="' + data.width + '" stroke-linecap="round" stroke-linejoin="round"/></g>';
  }
  if(type === 'text'){
    return '<g ' + groupAttrs + '><text x="' + data.x + '" y="' + data.y + '" fill="' + data.color + '" font-size="18" font-family="inherit">' + escapeXml(data.text) + '</text></g>';
  }
  if(type === 'connector'){
    var d = roundedOrthogonalPathD([{x: data.x1, y: data.y1}, {x: data.x2, y: data.y2}], 8);
    return '<g ' + groupAttrs + '><path d="' + d + '" fill="none" stroke="' + data.color + '" stroke-width="2.5" marker-start="url(#kf-wb-dot-start)" marker-end="url(#kf-wb-dot-end)"/></g>';
  }
  if(type === 'shape-rect'){
    return '<g ' + groupAttrs + '><rect x="' + data.x + '" y="' + data.y + '" width="' + data.w + '" height="' + data.h + '" fill="none" stroke="' + data.color + '" stroke-width="2.5"/></g>';
  }
  if(type === 'shape-circle' || type === 'shape-oval'){
    var rx = data.w / 2, ry = data.h / 2;
    return '<g ' + groupAttrs + '><ellipse cx="' + (data.x + rx) + '" cy="' + (data.y + ry) + '" rx="' + Math.abs(rx) + '" ry="' + Math.abs(ry) + '" fill="none" stroke="' + data.color + '" stroke-width="2.5"/></g>';
  }
  if(type === 'shape-triangle'){
    var p = data.x + ',' + (data.y + data.h) + ' ' + (data.x + data.w / 2) + ',' + data.y + ' ' + (data.x + data.w) + ',' + (data.y + data.h);
    return '<g ' + groupAttrs + '><polygon points="' + p + '" fill="none" stroke="' + data.color + '" stroke-width="2.5"/></g>';
  }
  if(type === 'shape-diamond'){
    var cx = data.x + data.w / 2, cy = data.y + data.h / 2;
    var pd = cx + ',' + data.y + ' ' + (data.x + data.w) + ',' + cy + ' ' + cx + ',' + (data.y + data.h) + ' ' + data.x + ',' + cy;
    return '<g ' + groupAttrs + '><polygon points="' + pd + '" fill="none" stroke="' + data.color + '" stroke-width="2.5"/></g>';
  }
  return '';
}

export function renderElementsLayer(elements){
  return elements.map(renderElementSvg).join('');
}
