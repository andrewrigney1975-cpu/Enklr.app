"use strict";
import { toast } from '../ui.js';
import { WHITEBOARD_PALETTE, WHITEBOARD_DEFAULT_PEN_COLOR, WHITEBOARD_DEFAULT_PEN_WIDTH, WHITEBOARD_ERASER_WIDTH, WHITEBOARD_CURSOR_THROTTLE_MS } from '../config.js';
import { escapeHTML } from '../utils.js';
import { confirmDialog } from './confirm.js';
import { exportSvgElementAsSvgFile } from '../features/svg-export.js';
import { parseWhiteboardCodeFromHash } from '../features/hash-router.js';
import {
  getWhiteboardSession, setWhiteboardDeps, createWhiteboardSession, joinWhiteboardSession,
  leaveWhiteboardSession, saveWhiteboardSession, closeWhiteboardSession, addWhiteboardElement,
  removeWhiteboardElement, whiteboardHasUnsavedChanges, sendWhiteboardCursorMove, onWhiteboardCursorMoved
} from '../features/whiteboard.js';
import { clientPointToSvgPoint, renderElementsLayer } from '../features/whiteboard-draw.js';
import { getCurrentUserId } from '../api.js';

/* Collaborative Whiteboard modal — the render-heavy half of the feature (state/API/SSE lives in
   features/whiteboard.js, SVG element construction in features/whiteboard-draw.js). Two views
   inside one overlay: an entry view (Start/Join, shown until a session is active) and a canvas
   view (toolbar in the header + a left rail for Copy Link/Save/Exit + the drawing surface),
   toggled by showing/hiding #wbEntryView/#wbCanvasView rather than two separate overlays. */

var _tool = 'pen';
var _penColor = WHITEBOARD_DEFAULT_PEN_COLOR;
var _penWidth = WHITEBOARD_DEFAULT_PEN_WIDTH;
var _drawing = null; // in-progress pen/shape/connector drag state
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
  document.getElementById('wbToolbar').classList.add('kf-vis-hidden');
  document.getElementById('wbJoinError').classList.add('hidden');
  document.getElementById('wbJoinCodeInput').value = '';
}

function showCanvasView(){
  document.getElementById('wbEntryView').classList.add('hidden');
  document.getElementById('wbCanvasView').classList.remove('hidden');
  document.getElementById('wbToolbar').classList.remove('kf-vis-hidden');
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
    });
  });
}

function normalizeBox(x1, y1, x2, y2){
  return {x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)};
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

  _drawing = {tool: _tool, startX: pt.x, startY: pt.y, points: [pt]};
  canvas.setPointerCapture(e.pointerId);
}

function handleCanvasPointerMove(e){
  var canvas = document.getElementById('wbCanvas');
  var pt = clientPointToSvgPoint(canvas, e.clientX, e.clientY);

  var now = Date.now();
  if(now - _lastCursorSentAt >= WHITEBOARD_CURSOR_THROTTLE_MS){
    _lastCursorSentAt = now;
    sendWhiteboardCursorMove(pt.x, pt.y);
  }

  if(!_drawing) return;
  if(_drawing.tool === 'pen') _drawing.points.push(pt);
  else { _drawing.curX = pt.x; _drawing.curY = pt.y; }
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
    markup = '<path d="' + d + '" fill="none" stroke="' + _penColor + '" stroke-width="' + _penWidth + '" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if(_drawing.tool === 'connector'){
    markup = '<line x1="' + _drawing.startX + '" y1="' + _drawing.startY + '" x2="' + (_drawing.curX || _drawing.startX) + '" y2="' + (_drawing.curY || _drawing.startY) + '" stroke="' + _penColor + '" stroke-width="2.5" stroke-dasharray="4 3"/>';
  } else {
    var box = normalizeBox(_drawing.startX, _drawing.startY, _drawing.curX || _drawing.startX, _drawing.curY || _drawing.startY);
    markup = '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="none" stroke="' + _penColor + '" stroke-width="2" stroke-dasharray="4 3"/>';
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
      addWhiteboardElement('pen', JSON.stringify({points: drawing.points, color: _penColor, width: _penWidth})).then(renderWhiteboardState);
    }
    return;
  }
  if(drawing.tool === 'connector'){
    var endX = drawing.curX || drawing.startX, endY = drawing.curY || drawing.startY;
    if(endX !== drawing.startX || endY !== drawing.startY){
      addWhiteboardElement('connector', JSON.stringify({x1: drawing.startX, y1: drawing.startY, x2: endX, y2: endY, color: _penColor})).then(renderWhiteboardState);
    }
    return;
  }
  // shape tools
  var box = normalizeBox(drawing.startX, drawing.startY, drawing.curX || drawing.startX, drawing.curY || drawing.startY);
  if(box.w > 2 && box.h > 2){
    addWhiteboardElement('shape-' + drawing.tool, JSON.stringify({x: box.x, y: box.y, w: box.w, h: box.h, color: _penColor})).then(renderWhiteboardState);
  }
}

// ---- Remote cursors ----

function renderRemoteCursor(userId, displayName, x, y){
  var layer = document.getElementById('wbCursorsLayer');
  var canvas = document.getElementById('wbCanvas');
  var rect = canvas.getBoundingClientRect();
  var layerRect = layer.getBoundingClientRect();
  var pxX = (x / 1600) * rect.width + (rect.left - layerRect.left);
  var pxY = (y / 900) * rect.height + (rect.top - layerRect.top);

  var el = _cursorEls[userId];
  if(!el){
    el = document.createElement('div');
    el.className = 'kf-wb-remote-cursor';
    el.innerHTML = '<span class="kf-icon" data-icon="cursorArrow" data-size="14"></span><span class="kf-wb-remote-cursor-label"></span>';
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
  document.getElementById('wbPenWidth').addEventListener('input', function(e){ _penWidth = parseInt(e.target.value, 10) || WHITEBOARD_DEFAULT_PEN_WIDTH; });

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
