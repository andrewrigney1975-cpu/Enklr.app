"use strict";
import { toast } from '../../js/ui.js';
import { hydrateIcons } from '../../js/icons.js';
import { WHITEBOARD_PALETTE, WHITEBOARD_DEFAULT_PEN_COLOR, WHITEBOARD_DEFAULT_PEN_WIDTH, WHITEBOARD_DEFAULT_PEN_OPACITY, WHITEBOARD_GRID_SIZE } from '../../js/config.js';
import {
  clientPointToSvgPoint, renderElementsLayer, computeConnectorCorner, connectorCurvePathD,
  smoothPathD, translateElementData
} from '../../js/features/whiteboard-draw.js';
import { closeAllExportAsPanels, toggleExportAsPanel, exportSvgElementAsSvgFile, exportSvgElementAsPng } from '../../js/features/svg-export.js';
// whiteboard-draw.js's own renderElementSvg already depends on this for persisted connector
// elements, so it's already part of this bundle's module graph — reused here too for the live
// drag preview rather than re-deriving the same geometry a second way.
import { roundedOrthogonalPathD, DEPMAP_CORNER_RADIUS } from '../../js/views/dependency-map.js';

/* Standalone Whiteboard tool (enklr.app/tools/whiteboard) — see CLAUDE.md/WHITEBOARD.md for how
   this differs from the in-app Collaborative Whiteboard (modals/whiteboard.js + features/
   whiteboard.js). There is no server, no session, no participants, no SSE — this file is a
   genuinely local rewrite of modals/whiteboard.js's own drawing/tool-state logic, reusing that
   feature's PURE SVG-construction helpers (features/whiteboard-draw.js) directly rather than
   duplicating them, but replacing every whiteboardApi.* call with a plain local array persisted to
   this browser's own localStorage. Nothing here ever performs a network request. */

var STORAGE_KEY = 'enklr_standalone_whiteboard_v1';

var _elements = loadElements(); // [{id, elementType, elementJson}]
var _nextId = 1;

function loadElements(){
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch(e){ return []; }
}

function persistElements(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_elements)); }
  catch(e){ toast('Could not save — your browser storage may be full.'); }
}

function localUid(){
  return 'wb_' + Date.now().toString(36) + '_' + (_nextId++);
}

function addElement(elementType, elementJson){
  _elements.push({id: localUid(), elementType: elementType, elementJson: elementJson});
  persistElements();
  renderState();
}

function updateElement(id, elementJson){
  var el = _elements.find(function(e){ return e.id === id; });
  if(el) el.elementJson = elementJson;
  persistElements();
  renderState();
}

function removeElement(id){
  _elements = _elements.filter(function(e){ return e.id !== id; });
  persistElements();
  renderState();
}

var _tool = 'pen';
var _penColor = WHITEBOARD_DEFAULT_PEN_COLOR;
var _penWidth = WHITEBOARD_DEFAULT_PEN_WIDTH;
var _penOpacity = WHITEBOARD_DEFAULT_PEN_OPACITY;
var _drawing = null; // in-progress pen/shape/connector drag state
var _curveDrawing = null; // in-progress "curve" click-run state — see modals/whiteboard.js's own doc comment
var _showGrid = false;
var _snapToGrid = false;
var _selectedElementIds = [];
var _moveDrag = null;

function renderState(){
  document.getElementById('wbElementsLayer').innerHTML = renderElementsLayer(_elements);
  renderSelectionOutline();
}

// ---- Drawing tools (ported verbatim from modals/whiteboard.js's own tool logic — the only real
// change throughout this section is that every mutation goes straight to the local add/update/
// removeElement above instead of through whiteboardApi + a server round trip) ----

function selectTool(tool){
  if(tool !== 'curve' && _curveDrawing){
    _curveDrawing = null;
    var preview = document.getElementById('wbLivePreview');
    if(preview) preview.remove();
  }
  if(tool !== 'select' && _selectedElementIds.length){
    _selectedElementIds = [];
    renderSelectionOutline();
  }
  _tool = tool;
  document.querySelectorAll('.kf-wb-tool').forEach(function(btn){
    btn.classList.toggle('kf-wb-tool-active', btn.getAttribute('data-tool') === tool);
  });
  document.getElementById('wbCanvas').classList.toggle('kf-wb-canvas-select', tool === 'select');
}

function renderSelectionOutline(){
  var layer = document.getElementById('wbSelectionLayer');
  if(!layer) return;
  layer.innerHTML = '';
  var svgNs = 'http://www.w3.org/2000/svg';
  _selectedElementIds = _selectedElementIds.filter(function(id){
    var g = document.querySelector('#wbElementsLayer [data-element-id="' + id + '"]');
    if(!g) return false;
    var bbox;
    try { bbox = g.getBBox(); } catch(e){ return false; }
    var pad = 6;
    var rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('data-selection-for', id);
    rect.setAttribute('x', bbox.x - pad);
    rect.setAttribute('y', bbox.y - pad);
    rect.setAttribute('width', bbox.width + pad * 2);
    rect.setAttribute('height', bbox.height + pad * 2);
    rect.setAttribute('class', 'kf-wb-selection-rect');
    layer.appendChild(rect);
    return true;
  });
}

function applyMoveDragTransform(){
  _moveDrag.elementIds.forEach(function(id){
    var g = document.querySelector('#wbElementsLayer [data-element-id="' + id + '"]');
    if(g) g.setAttribute('transform', 'translate(' + _moveDrag.dx + ',' + _moveDrag.dy + ')');
    var outline = document.querySelector('[data-selection-for="' + id + '"]');
    if(outline) outline.setAttribute('transform', 'translate(' + _moveDrag.dx + ',' + _moveDrag.dy + ')');
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

function shapeBaseTool(tool){
  return tool.indexOf('-filled') === -1 ? tool : tool.slice(0, tool.length - '-filled'.length);
}
function isFilledTool(tool){
  return tool.indexOf('-filled') !== -1;
}

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

function snapCoord(v){
  return Math.round(v / WHITEBOARD_GRID_SIZE) * WHITEBOARD_GRID_SIZE;
}

function getCanvasPoint(e, canvas){
  var pt = clientPointToSvgPoint(canvas, e.clientX, e.clientY);
  if(_snapToGrid && _tool !== 'pen') return {x: snapCoord(pt.x), y: snapCoord(pt.y)};
  return pt;
}

function handleCanvasPointerDown(e){
  var canvas = document.getElementById('wbCanvas');
  var pt = getCanvasPoint(e, canvas);

  if(_tool === 'eraser'){
    var elementId = elementAtPoint(e.clientX, e.clientY);
    if(elementId) removeElement(elementId);
    return;
  }
  if(_tool === 'select'){
    var hitId = elementAtPoint(e.clientX, e.clientY);
    if(e.shiftKey){
      if(hitId){
        var idx = _selectedElementIds.indexOf(hitId);
        if(idx === -1) _selectedElementIds.push(hitId); else _selectedElementIds.splice(idx, 1);
        renderSelectionOutline();
      }
      return;
    }
    if(!(hitId && _selectedElementIds.indexOf(hitId) !== -1)){
      _selectedElementIds = hitId ? [hitId] : [];
      renderSelectionOutline();
    }
    if(hitId){
      _moveDrag = {elementIds: _selectedElementIds.slice(), startX: pt.x, startY: pt.y, dx: 0, dy: 0};
      canvas.setPointerCapture(e.pointerId);
    }
    return;
  }
  if(_tool === 'text'){
    var text = window.prompt('Text:');
    if(text && text.trim()){
      addElement('text', JSON.stringify({x: pt.x, y: pt.y, text: text.trim(), color: _penColor}));
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
  addElement('curve', JSON.stringify(data));
}

function handleCanvasPointerMove(e){
  var canvas = document.getElementById('wbCanvas');
  var pt = getCanvasPoint(e, canvas);

  if(_moveDrag){
    _moveDrag.dx = pt.x - _moveDrag.startX;
    _moveDrag.dy = pt.y - _moveDrag.startY;
    applyMoveDragTransform();
    return;
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
  if(_moveDrag){
    var drag = _moveDrag;
    _moveDrag = null;
    if(Math.abs(drag.dx) < 0.5 && Math.abs(drag.dy) < 0.5){
      drag.elementIds.forEach(function(id){
        var g = document.querySelector('#wbElementsLayer [data-element-id="' + id + '"]');
        if(g) g.removeAttribute('transform');
        var outline = document.querySelector('[data-selection-for="' + id + '"]');
        if(outline) outline.removeAttribute('transform');
      });
      return;
    }
    drag.elementIds.forEach(function(id){
      var element = _elements.find(function(el){ return el.id === id; });
      if(!element) return;
      var data;
      try { data = JSON.parse(element.elementJson); } catch(err){ return; }
      var moved = translateElementData(element.elementType, data, drag.dx, drag.dy);
      element.elementJson = JSON.stringify(moved);
    });
    persistElements();
    renderState();
    return;
  }

  if(!_drawing) return;
  var drawing = _drawing;
  _drawing = null;
  var preview = document.getElementById('wbLivePreview');
  if(preview) preview.remove();

  if(drawing.tool === 'pen'){
    if(drawing.points.length > 1){
      addElement('pen', JSON.stringify({points: drawing.points, color: _penColor, width: _penWidth, opacity: _penOpacity}));
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
      addElement('connector', JSON.stringify(data));
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
    addElement('shape-' + baseTool, JSON.stringify(shapeData));
  }
}

function handleClearAllClicked(){
  if(_elements.length === 0) return;
  if(!window.confirm('Clear this whiteboard? This permanently erases everything drawn here and cannot be undone.')) return;
  _elements = [];
  persistElements();
  renderState();
}

function deleteSelectedElements(){
  var ids = _selectedElementIds.slice();
  _selectedElementIds = [];
  _elements = _elements.filter(function(e){ return ids.indexOf(e.id) === -1; });
  persistElements();
  renderState();
}

function wireEvents(){
  hydrateIcons(document);

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

  document.getElementById('wbGridToggleBtn').addEventListener('click', function(){
    _showGrid = !_showGrid;
    document.getElementById('wbGridToggleBtn').classList.toggle('kf-wb-toggle-active', _showGrid);
    document.querySelectorAll('.kf-wb-grid-overlay').forEach(function(el){ el.classList.toggle('hidden', !_showGrid); });
  });
  document.getElementById('wbSnapToggleBtn').addEventListener('click', function(){
    _snapToGrid = !_snapToGrid;
    document.getElementById('wbSnapToggleBtn').classList.toggle('kf-wb-toggle-active', _snapToGrid);
  });

  document.getElementById('wbClearAllBtn').addEventListener('click', handleClearAllClicked);

  document.getElementById('wbExportAsBtn').addEventListener('click', function(e){
    e.stopPropagation();
    toggleExportAsPanel('wbExportAsPanel');
  });
  document.addEventListener('click', function(e){
    if(!e.target.closest('.kf-export-as-wrap')) closeAllExportAsPanels();
  });
  document.querySelectorAll('#wbExportAsPanel .kf-export-as-option').forEach(function(btn){
    btn.addEventListener('click', function(){
      closeAllExportAsPanels();
      var canvas = document.getElementById('wbCanvas');
      if(btn.getAttribute('data-export-type') === 'svg') exportSvgElementAsSvgFile(canvas, 'whiteboard');
      else exportSvgElementAsPng(canvas, 'whiteboard', 4);
    });
  });

  var canvas = document.getElementById('wbCanvas');
  canvas.addEventListener('pointerdown', handleCanvasPointerDown);
  canvas.addEventListener('pointermove', handleCanvasPointerMove);
  canvas.addEventListener('pointerup', handleCanvasPointerUp);

  document.addEventListener('keydown', function(e){
    if(e.code === 'Space' && _curveDrawing){
      e.preventDefault();
      finishCurve(false);
      return;
    }
    if((e.code === 'Delete' || e.code === 'Backspace') && _tool === 'select' && _selectedElementIds.length){
      e.preventDefault();
      deleteSelectedElements();
    }
  });

  renderState();
}

wireEvents();
