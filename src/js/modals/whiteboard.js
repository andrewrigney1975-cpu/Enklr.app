"use strict";
import { toast } from '../ui.js';
import { WHITEBOARD_PALETTE, WHITEBOARD_DEFAULT_PEN_COLOR, WHITEBOARD_DEFAULT_PEN_WIDTH, WHITEBOARD_DEFAULT_PEN_OPACITY, WHITEBOARD_ERASER_WIDTH, WHITEBOARD_CURSOR_THROTTLE_MS } from '../config.js';
import { escapeHTML } from '../utils.js';
import { confirmDialog } from './confirm.js';
import { exportSvgElementAsSvgFile } from '../features/svg-export.js';
import { parseWhiteboardCodeFromHash } from '../features/hash-router.js';
import {
  getWhiteboardSession, setWhiteboardDeps, createWhiteboardSession, joinWhiteboardSession,
  leaveWhiteboardSession, saveWhiteboardSession, closeWhiteboardSession, addWhiteboardElement,
  removeWhiteboardElement, whiteboardHasUnsavedChanges, sendWhiteboardCursorMove, onWhiteboardCursorMoved
} from '../features/whiteboard.js';
import { clientPointToSvgPoint, renderElementsLayer, computeConnectorCorner, connectorCurvePathD, smoothPathD } from '../features/whiteboard-draw.js';
import { roundedOrthogonalPathD, DEPMAP_CORNER_RADIUS } from '../views/dependency-map.js';
import { getCurrentUserId } from '../api.js';
import { iconSvg } from '../icons.js';

/* Collaborative Whiteboard modal — the render-heavy half of the feature (state/API/SSE lives in
   features/whiteboard.js, SVG element construction in features/whiteboard-draw.js). Two views
   inside one overlay: an entry view (Start/Join, shown until a session is active) and a canvas
   view (toolbar in the header + a left rail for Copy Link/Save/Exit + the drawing surface),
   toggled by showing/hiding #wbEntryView/#wbCanvasView rather than two separate overlays. */

var _tool = 'pen';
var _penColor = WHITEBOARD_DEFAULT_PEN_COLOR;
var _penWidth = WHITEBOARD_DEFAULT_PEN_WIDTH;
var _penOpacity = WHITEBOARD_DEFAULT_PEN_OPACITY;
var _drawing = null; // in-progress pen/shape/connector drag state
/* The "curve" tool's own in-progress state — a run of clicks, not a single pointerdown/up drag, so
   it can't live in _drawing (which is nulled the instant a drag's pointerup fires). Shape:
   {points:[{x,y}...], firstClientX, firstClientY, curX?, curY?} — firstClientX/Y are raw viewport
   pixels (not SVG-space) specifically so the 10px "close the shape" proximity check in
   handleCurveClick reflects actual visual closeness on screen regardless of how the fixed
   1600x900 viewBox happens to be scaled at the moment. */
var _curveDrawing = null;
var _cursorEls = {}; // userId -> DOM element, for the remote-cursor overlay
var _lastCursorSentAt = 0;
var _wired = false;

export function isWhiteboardOpen(){
  return !document.getElementById('whiteboardOverlay').classList.contains('hidden');
}

export function openWhiteboardOverlay(){
  document.getElementById('whiteboardOverlay').classList.remove('hidden');
  if(getWhiteboardSession()) showCanvasView(); else showEntryView();
}

function showEntryView(){
  document.getElementById('wbEntryView').classList.remove('hidden');
  document.getElementById('wbCanvasView').classList.add('hidden');
  document.getElementById('whiteboardToolbar').classList.add('kf-vis-hidden');
  document.getElementById('wbJoinError').classList.add('hidden');
  document.getElementById('wbJoinCodeInput').value = '';
}

function showCanvasView(){
  document.getElementById('wbEntryView').classList.add('hidden');
  document.getElementById('wbCanvasView').classList.remove('hidden');
  document.getElementById('whiteboardToolbar').classList.remove('kf-vis-hidden');
  renderWhiteboardState();
}

/* Closing the modal itself (the X button / outside click) is NOT the same as leaving/closing the
   SESSION — a user can dismiss the overlay and reopen it later while still a participant. Only the
   explicit rail Exit/Close button below ends the session participation itself. */
export function closeWhiteboardOverlay(){
  document.getElementById('whiteboardOverlay').classList.add('hidden');
}

async function handleStart(){
  try {
    await createWhiteboardSession(null);
    showCanvasView();
  } catch(e){ toast('Could not start a whiteboard session.'); }
}

async function handleJoin(){
  var code = document.getElementById('wbJoinCodeInput').value.trim();
  var errorEl = document.getElementById('wbJoinError');
  if(!/^[0-9]{6}$/.test(code)){
    errorEl.textContent = 'Enter the 6-digit code.';
    errorEl.classList.remove('hidden');
    return;
  }
  try {
    await joinWhiteboardSession(code);
    errorEl.classList.add('hidden');
    showCanvasView();
  } catch(e){
    errorEl.textContent = 'No open whiteboard found for that code.';
    errorEl.classList.remove('hidden');
  }
}

function copyShareLink(){
  var session = getWhiteboardSession();
  if(!session) return;
  var url = location.origin + location.pathname + '#!/whiteboard/' + session.joinCode;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(function(){ toast('Link copied to clipboard.'); }, function(){ toast(url); });
  } else {
    toast(url);
  }
}

async function handleSave(){
  try {
    await saveWhiteboardSession();
    toast('Whiteboard saved.');
    renderWhiteboardState();
  } catch(e){ toast('Could not save this whiteboard.'); }
}

/* Host: closing ends the session for everyone — warns first if there's content that was never
   saved (the "scratch until saved" model: an unsaved session's data is purged once closed).
   Non-host: just leaves; the session keeps running for everyone else. */
function handleExitOrCloseClicked(){
  var session = getWhiteboardSession();
  if(!session) return;
  if(!session.isHost){
    leaveWhiteboardSession().then(function(){ closeWhiteboardOverlay(); });
    return;
  }
  if(whiteboardHasUnsavedChanges()){
    confirmDialog(
      'Close whiteboard?',
      'This whiteboard has unsaved changes. Closing now will permanently discard them. Save first, or close anyway?',
      function(){ closeWhiteboardSession().then(function(){ closeWhiteboardOverlay(); }); }
    );
  } else {
    closeWhiteboardSession().then(function(){ closeWhiteboardOverlay(); });
  }
}

/* No bulk-delete endpoint exists (or is needed) for this — reuses the same per-element
   removeWhiteboardElement call the eraser tool already makes, just fired once per existing
   element. Each removal still broadcasts its own SSE "removed" event to other participants, so
   everyone's canvas ends up empty exactly the same way it would if the host had erased everything
   by hand. */
function handleClearAllClicked(){
  var session = getWhiteboardSession();
  if(!session || session.elements.length === 0) return;
  confirmDialog(
    'Clear whiteboard?',
    'This will permanently remove everything drawn on this whiteboard. This cannot be undone.',
    function(){
      var ids = session.elements.map(function(el){ return el.id; });
      Promise.all(ids.map(function(id){ return removeWhiteboardElement(id); })).then(renderWhiteboardState);
    }
  );
}

function renderParticipants(session){
  var meId = getCurrentUserId();
  document.getElementById('wbParticipants').innerHTML = session.participants.map(function(p){
    return '<div class="kf-wb-participant-row">' +
      '<span class="kf-wb-participant-dot' + (p.isOnline ? '' : ' kf-wb-offline') + '"></span>' +
      '<span>' + escapeHTML(p.displayName) + (p.userId === meId ? ' (you)' : '') + (p.isHost ? ' — Host' : '') + '</span>' +
      '</div>';
  }).join('');
}

export function renderWhiteboardState(){
  var session = getWhiteboardSession();
  if(!session || !isWhiteboardOpen()) return;

  document.getElementById('whiteboardTitle').textContent = session.title || 'Whiteboard';
  document.getElementById('wbJoinCodeDisplay').textContent = 'Code: ' + session.joinCode;
  document.getElementById('wbSaveBtn').classList.toggle('kf-vis-hidden', !session.isHost);
  document.getElementById('wbSaveBtn').disabled = session.isSaved;
  document.getElementById('wbExitBtnLabel').textContent = session.isHost ? 'Close Session' : 'Exit';
  renderParticipants(session);

  var canvas = document.getElementById('wbCanvas');
  document.getElementById('wbElementsLayer').innerHTML = renderElementsLayer(session.elements);
}

function handleSessionClosedRemotely(){
  toast('The host closed this whiteboard.');
  closeWhiteboardOverlay();
}

// ---- Drawing tools ----

function selectTool(tool){
  if(tool !== 'curve' && _curveDrawing){
    _curveDrawing = null;
    var preview = document.getElementById('wbLivePreview');
    if(preview) preview.remove();
  }
  _tool = tool;
  document.querySelectorAll('.kf-wb-tool').forEach(function(btn){
    btn.classList.toggle('kf-wb-tool-active', btn.getAttribute('data-tool') === tool);
  });
}

function renderPalette(){
  var wrap = document.getElementById('wbPalette');
  wrap.innerHTML = WHITEBOARD_PALETTE.map(function(color){
    return '<button type="button" class="kf-wb-swatch' + (color === _penColor ? ' kf-wb-swatch-active' : '') + '" data-color="' + color + '" style="background:' + color + '"></button>';
  }).join('');
  wrap.querySelectorAll('.kf-wb-swatch').forEach(function(btn){
    btn.addEventListener('click', function(){
      _penColor = btn.getAttribute('data-color');
      renderPalette();
      updatePenIndicators();
    });
  });
}

/* Keeps the two toolbar indicator SVGs (next to the Size/Opacity sliders) in sync with whatever
   would actually get drawn right now — same three inputs (_penWidth/_penOpacity/_penColor) that
   feed every draw call, just mirrored here so the toolbar itself shows their effect at a glance
   instead of only the raw slider numbers. Size's dotted circle is the slider's max (r=10, matching
   #wbPenWidth's own max="20"); the solid dot scales between a floor of 1.5 (so min width "1" still
   reads as a visible dot, not nothing) and that same r=10 ceiling. Opacity's dotted circle is fixed
   at r=10 (the "edge" of full opacity) and the solid circle sits exactly on top of it at that same
   radius — only its fill-opacity moves, so transparency is what you see change, not size. */
function updatePenIndicators(){
  var widthInput = document.getElementById('wbPenWidth');
  var widthDot = document.getElementById('wbPenWidthDot');
  if(widthInput && widthDot){
    var minVal = parseInt(widthInput.min, 10) || 1;
    var maxVal = parseInt(widthInput.max, 10) || 20;
    var maxR = 10, minR = 1.5;
    var frac = maxVal === minVal ? 1 : (_penWidth - minVal) / (maxVal - minVal);
    widthDot.setAttribute('r', minR + (maxR - minR) * frac);
    widthDot.setAttribute('fill', _penColor);
  }
  var opacityDot = document.getElementById('wbPenOpacityDot');
  if(opacityDot){
    opacityDot.setAttribute('fill-opacity', _penOpacity);
    opacityDot.setAttribute('fill', _penColor);
  }
}

/* Shape tools come in outline/filled pairs sharing one base name ("rect" / "rect-filled", etc) —
   these two helpers are the single place that splits the suffix back out, so drawing/storage code
   never has to re-derive it. */
function shapeBaseTool(tool){
  return tool.indexOf('-filled') === -1 ? tool : tool.slice(0, tool.length - '-filled'.length);
}
function isFilledTool(tool){
  return tool.indexOf('-filled') !== -1;
}

/* `square` forces a 1:1 box (the "circle" tool only — "oval" stays free-form, that's the whole
   reason both tools exist) — anchored at the drag's start point (x1,y1), extending toward
   whichever direction the cursor (x2,y2) actually moved, sized by the larger of the two deltas so
   the shape tracks the more decisive axis of the drag rather than shrinking to the smaller one. */
function normalizeBox(x1, y1, x2, y2, square){
  var w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if(square){
    var side = Math.max(w, h);
    return {x: x2 >= x1 ? x1 : x1 - side, y: y2 >= y1 ? y1 : y1 - side, w: side, h: side};
  }
  return {x: Math.min(x1, x2), y: Math.min(y1, y2), w: w, h: h};
}

function elementAtPoint(clientX, clientY){
  var el = document.elementFromPoint(clientX, clientY);
  while(el && el !== document.body){
    if(el.classList && el.classList.contains('kf-wb-element')) return el.getAttribute('data-element-id');
    el = el.parentElement;
  }
  return null;
}

function handleCanvasPointerDown(e){
  var canvas = document.getElementById('wbCanvas');
  var pt = clientPointToSvgPoint(canvas, e.clientX, e.clientY);

  if(_tool === 'eraser'){
    var elementId = elementAtPoint(e.clientX, e.clientY);
    if(elementId) removeWhiteboardElement(elementId).then(renderWhiteboardState);
    return;
  }
  if(_tool === 'text'){
    var text = window.prompt('Text:');
    if(text && text.trim()){
      addWhiteboardElement('text', JSON.stringify({x: pt.x, y: pt.y, text: text.trim(), color: _penColor})).then(renderWhiteboardState);
    }
    return;
  }
  if(_tool === 'curve'){
    handleCurveClick(e, pt);
    return;
  }

  _drawing = {tool: _tool, startX: pt.x, startY: pt.y, points: [pt]};
  canvas.setPointerCapture(e.pointerId);
}

/* Click-to-place-vertices handling for the "curve" tool — see _curveDrawing's own doc comment for
   why this can't just reuse _drawing's drag-based model. The first click starts the run; every
   click after that either appends a new vertex or, if the click landed within 10 screen pixels of
   the very first vertex, snaps a final vertex exactly onto it and finalizes as a closed/filled
   shape (Shift held at that closing click drops the stroke, same as the filled shape tools). */
function handleCurveClick(e, pt){
  if(!_curveDrawing){
    _curveDrawing = {points: [pt], firstClientX: e.clientX, firstClientY: e.clientY};
    renderCurveLivePreview();
    return;
  }
  var distToStart = Math.hypot(e.clientX - _curveDrawing.firstClientX, e.clientY - _curveDrawing.firstClientY);
  if(distToStart <= 10 && _curveDrawing.points.length >= 2){
    var first = _curveDrawing.points[0];
    _curveDrawing.points.push({x: first.x, y: first.y});
    finishCurve(true, e.shiftKey);
    return;
  }
  _curveDrawing.points.push(pt);
  renderCurveLivePreview();
}

function renderCurveLivePreview(){
  var preview = document.getElementById('wbLivePreview');
  if(preview) preview.remove();
  if(!_curveDrawing) return;

  var svgNs = 'http://www.w3.org/2000/svg';
  var g = document.createElementNS(svgNs, 'g');
  g.id = 'wbLivePreview';
  var previewPoints = _curveDrawing.points.slice();
  if(_curveDrawing.curX !== undefined) previewPoints.push({x: _curveDrawing.curX, y: _curveDrawing.curY});
  var d = smoothPathD(previewPoints, false);
  var markup = '<path d="' + d + '" fill="none" stroke="' + _penColor + '" stroke-width="' + _penWidth + '" stroke-linecap="round" stroke-linejoin="round"/>';
  markup += _curveDrawing.points.map(function(p, i){
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (i === 0 ? 5 : 3) + '" fill="' + _penColor + '" stroke="white" stroke-width="1"/>';
  }).join('');
  g.innerHTML = markup;
  document.getElementById('wbCanvas').appendChild(g);
}

/* Ends the current curve run — `closed` true only when the user clicked back within 10px of the
   first vertex (handleCurveClick already pushed a vertex coincident with it); Space always ends an
   OPEN curve regardless of how close the cursor happens to be to the start. An open curve always
   stores opacity 1 — the Opacity slider is deliberately only a fill property here, same as the
   filled shape tools, so it has no effect until the curve is actually closed. */
function finishCurve(closed, shiftHeld){
  var points = _curveDrawing.points;
  _curveDrawing = null;
  var preview = document.getElementById('wbLivePreview');
  if(preview) preview.remove();
  if(points.length < 2) return;

  var data = {points: points, color: _penColor, width: _penWidth, closed: closed};
  if(closed){
    data.filled = true;
    data.opacity = _penOpacity;
    if(shiftHeld) data.noStroke = true;
  } else {
    data.opacity = 1;
  }
  addWhiteboardElement('curve', JSON.stringify(data)).then(renderWhiteboardState);
}

function handleCanvasPointerMove(e){
  var canvas = document.getElementById('wbCanvas');
  var pt = clientPointToSvgPoint(canvas, e.clientX, e.clientY);

  var now = Date.now();
  if(now - _lastCursorSentAt >= WHITEBOARD_CURSOR_THROTTLE_MS){
    _lastCursorSentAt = now;
    sendWhiteboardCursorMove(pt.x, pt.y);
  }

  if(_curveDrawing){
    _curveDrawing.curX = pt.x;
    _curveDrawing.curY = pt.y;
    renderCurveLivePreview();
    return;
  }

  if(!_drawing) return;
  if(_drawing.tool === 'pen') _drawing.points.push(pt);
  else { _drawing.curX = pt.x; _drawing.curY = pt.y; _drawing.shiftHeld = e.shiftKey; _drawing.altHeld = e.altKey; }
  renderLivePreview();
}

function renderLivePreview(){
  var preview = document.getElementById('wbLivePreview');
  if(preview) preview.remove();
  if(!_drawing) return;

  var svgNs = 'http://www.w3.org/2000/svg';
  var g = document.createElementNS(svgNs, 'g');
  g.id = 'wbLivePreview';
  var markup = '';
  if(_drawing.tool === 'pen'){
    var d = _drawing.points.reduce(function(acc, p, i){ return acc + (i === 0 ? 'M ' : ' L ') + p.x + ' ' + p.y; }, '');
    markup = '<path d="' + d + '" fill="none" stroke="' + _penColor + '" stroke-width="' + _penWidth + '" stroke-opacity="' + _penOpacity + '" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if(_drawing.tool === 'connector'){
    var endX = _drawing.curX || _drawing.startX, endY = _drawing.curY || _drawing.startY;
    var previewD;
    if(_drawing.altHeld){
      previewD = connectorCurvePathD(_drawing.startX, _drawing.startY, endX, endY);
    } else {
      var corner = _drawing.shiftHeld ? computeConnectorCorner(_drawing.startX, _drawing.startY, endX, endY) : null;
      var pts = [{x: _drawing.startX, y: _drawing.startY}];
      if(corner) pts.push(corner);
      pts.push({x: endX, y: endY});
      previewD = roundedOrthogonalPathD(pts, DEPMAP_CORNER_RADIUS);
    }
    markup = '<path d="' + previewD + '" fill="none" stroke="' + _penColor + '" stroke-width="2.5" stroke-dasharray="4 3"/>';
  } else {
    var box = normalizeBox(_drawing.startX, _drawing.startY, _drawing.curX || _drawing.startX, _drawing.curY || _drawing.startY, shapeBaseTool(_drawing.tool) === 'circle');
    var filled = isFilledTool(_drawing.tool);
    var previewFill = filled ? ('fill="' + _penColor + '" fill-opacity="' + _penOpacity + '"') : 'fill="none"';
    var previewStroke = (filled && _drawing.shiftHeld) ? '' : ('stroke="' + _penColor + '" stroke-width="2" stroke-dasharray="4 3"');
    markup = '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" ' + previewFill + ' ' + previewStroke + '/>';
  }
  g.innerHTML = markup;
  document.getElementById('wbCanvas').appendChild(g);
}

function handleCanvasPointerUp(e){
  if(!_drawing) return;
  var drawing = _drawing;
  _drawing = null;
  var preview = document.getElementById('wbLivePreview');
  if(preview) preview.remove();

  if(drawing.tool === 'pen'){
    if(drawing.points.length > 1){
      addWhiteboardElement('pen', JSON.stringify({points: drawing.points, color: _penColor, width: _penWidth, opacity: _penOpacity})).then(renderWhiteboardState);
    }
    return;
  }
  if(drawing.tool === 'connector'){
    var endX = drawing.curX || drawing.startX, endY = drawing.curY || drawing.startY;
    if(endX !== drawing.startX || endY !== drawing.startY){
      var data = {x1: drawing.startX, y1: drawing.startY, x2: endX, y2: endY, color: _penColor};
      if(drawing.altHeld || e.altKey){
        data.curve = true;
      } else {
        var corner = (drawing.shiftHeld || e.shiftKey) ? computeConnectorCorner(drawing.startX, drawing.startY, endX, endY) : null;
        if(corner) data.corner = corner;
      }
      addWhiteboardElement('connector', JSON.stringify(data)).then(renderWhiteboardState);
    }
    return;
  }
  // shape tools
  var baseTool = shapeBaseTool(drawing.tool);
  var box = normalizeBox(drawing.startX, drawing.startY, drawing.curX || drawing.startX, drawing.curY || drawing.startY, baseTool === 'circle');
  if(box.w > 2 && box.h > 2){
    var shapeData = {x: box.x, y: box.y, w: box.w, h: box.h, color: _penColor};
    if(isFilledTool(drawing.tool)){
      shapeData.filled = true;
      shapeData.opacity = _penOpacity;
      if(drawing.shiftHeld || e.shiftKey) shapeData.noStroke = true;
    }
    addWhiteboardElement('shape-' + baseTool, JSON.stringify(shapeData)).then(renderWhiteboardState);
  }
}

// ---- Remote cursors ----

function renderRemoteCursor(userId, displayName, x, y){
  var layer = document.getElementById('wbCursorsLayer');
  var canvas = document.getElementById('wbCanvas');
  var rect = canvas.getBoundingClientRect();
  var layerRect = layer.getBoundingClientRect();
  // Same uniform-scale (not independent per-axis) math as clientPointToSvgPoint's own fix — the
  // canvas's preserveAspectRatio="xMinYMin meet" scales both axes by whichever is more
  // constraining, so scaling x by rect.width and y by rect.height independently drifts off the
  // real rendered position whenever the wrap element isn't exactly 16:9.
  var scale = Math.min(rect.width / 1600, rect.height / 900);
  var pxX = x * scale + (rect.left - layerRect.left);
  var pxY = y * scale + (rect.top - layerRect.top);

  var el = _cursorEls[userId];
  if(!el){
    el = document.createElement('div');
    el.className = 'kf-wb-remote-cursor';
    el.innerHTML = iconSvg('cursorArrow', 14) + '<span class="kf-wb-remote-cursor-label"></span>';
    layer.appendChild(el);
    _cursorEls[userId] = el;
  }
  el.querySelector('.kf-wb-remote-cursor-label').textContent = displayName;
  el.style.left = pxX + 'px';
  el.style.top = pxY + 'px';
}

function clearRemoteCursors(){
  Object.keys(_cursorEls).forEach(function(userId){ _cursorEls[userId].remove(); });
  _cursorEls = {};
}

// ---- Wiring (called once from app.js's wireEvents) ----

export function wireWhiteboardEvents(){
  if(_wired) return;
  _wired = true;

  setWhiteboardDeps({
    onStateChanged: renderWhiteboardState,
    onSessionClosedRemotely: handleSessionClosedRemotely
  });
  onWhiteboardCursorMoved(renderRemoteCursor);

  renderPalette();
  document.getElementById('wbPenWidth').value = _penWidth;
  document.getElementById('wbPenWidth').addEventListener('input', function(e){
    _penWidth = parseInt(e.target.value, 10) || WHITEBOARD_DEFAULT_PEN_WIDTH;
    updatePenIndicators();
  });

  document.getElementById('wbPenOpacity').value = _penOpacity * 100;
  document.getElementById('wbPenOpacity').addEventListener('input', function(e){
    _penOpacity = (parseInt(e.target.value, 10) || WHITEBOARD_DEFAULT_PEN_OPACITY * 100) / 100;
    updatePenIndicators();
  });
  updatePenIndicators();

  document.querySelectorAll('.kf-wb-tool').forEach(function(btn){
    btn.addEventListener('click', function(){ selectTool(btn.getAttribute('data-tool')); });
  });
  selectTool('pen');

  document.getElementById('whiteboardClose').addEventListener('click', closeWhiteboardOverlay);
  document.getElementById('whiteboardOverlay').addEventListener('mousedown', function(e){
    if(e.target.id === 'whiteboardOverlay') closeWhiteboardOverlay();
  });
  document.getElementById('wbStartBtn').addEventListener('click', handleStart);
  document.getElementById('wbJoinBtn').addEventListener('click', handleJoin);
  document.getElementById('wbCopyLinkBtn').addEventListener('click', copyShareLink);
  document.getElementById('wbSaveBtn').addEventListener('click', handleSave);
  document.getElementById('wbExitBtn').addEventListener('click', handleExitOrCloseClicked);
  document.getElementById('wbClearAllBtn').addEventListener('click', handleClearAllClicked);

  document.getElementById('wbExportAsBtn').addEventListener('click', function(e){
    e.stopPropagation();
    document.getElementById('wbExportAsPanel').classList.toggle('hidden');
  });
  document.querySelectorAll('#wbExportAsPanel .kf-export-as-option').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.getElementById('wbExportAsPanel').classList.add('hidden');
      exportSvgElementAsSvgFile(document.getElementById('wbCanvas'), 'whiteboard');
    });
  });

  var canvas = document.getElementById('wbCanvas');
  canvas.addEventListener('pointerdown', handleCanvasPointerDown);
  canvas.addEventListener('pointermove', handleCanvasPointerMove);
  canvas.addEventListener('pointerup', handleCanvasPointerUp);

  /* Space ends the "curve" tool's current run of clicked points as an OPEN curve — the only other
     way to end one is clicking back near the start point, which closes it instead (see
     handleCurveClick). Guarded on _curveDrawing existing so this never steals a page-scroll
     spacebar when the tool isn't mid-curve. */
  document.addEventListener('keydown', function(e){
    if(e.code !== 'Space' || !_curveDrawing || !isWhiteboardOpen()) return;
    e.preventDefault();
    finishCurve(false);
  });
}

/* Called from app.js on load/hashchange when a "#!/whiteboard/CODE" URL is present — joins
   directly (org-wide feature, independent of whichever local project is active, so unlike Forms'
   own deep-link handling there's no project switch needed first). */
export function openWhiteboardFromHashIfPresent(){
  var code = parseWhiteboardCodeFromHash();
  if(!code) return;
  wireWhiteboardEvents();
  openWhiteboardOverlay();
  if(!getWhiteboardSession()){
    joinWhiteboardSession(code).then(showCanvasView, function(){
      toast('No open whiteboard found for that code.');
      showEntryView();
    });
  }
}
