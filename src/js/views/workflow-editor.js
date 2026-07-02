"use strict";
import { getCurrentProject } from '../store.js';
import { iconSvg } from '../icons.js';
import { ensureProjectWorkflow, WORKFLOW_NODE_W, WORKFLOW_NODE_H, WORKFLOW_MARGIN } from '../features/workflow-engine.js';
import { setWorkflowNodePosition, addWorkflowEdge, updateWorkflowEdge, deleteWorkflowEdge } from '../mutations.js';

function escapeHTML(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function iconHTML(name, size){ return '<span class="kf-icon">'+iconSvg(name,size)+'</span>'; }

var _toast = function(msg){ console.error(msg); };
export function setWorkflowEditorDeps(deps){
  if(deps.toast) _toast = deps.toast;
}

/* =========================================================
   SVG WORKFLOW EDITOR
   One node per project column, positioned at project.workflow.nodes
   (auto-laid-out left-to-right the first time the workflow is
   materialized, freely draggable and persisted after that — see
   ensureProjectWorkflow in features/workflow-engine.js). Edges are
   directed Allowed/Disallowed connectors drawn between nodes.
   ========================================================= */
export var workflowEditorState = {
  scale: 1,
  panActive: false, panMoved: false, panStartX: 0, panStartY: 0, panStartScrollLeft: 0, panStartScrollTop: 0,
  mode: 'select',                 // 'select' | 'allowed' | 'disallowed'
  draggingColumnId: null, dragMoved: false, dragPointerStartX: 0, dragPointerStartY: 0, dragNodeStartX: 0, dragNodeStartY: 0,
  drawingFromColumnId: null,
  popoverEdgeId: null
};
export var WORKFLOW_MIN_ZOOM = 0.3;
export var WORKFLOW_MAX_ZOOM = 2.5;
export var lastWorkflowLayout = null;

export function computeWorkflowLayout(project){
  var positions = {};
  var maxX = WORKFLOW_MARGIN, maxY = WORKFLOW_MARGIN;
  project.columns.forEach(function(col){
    var pos = (project.workflow && project.workflow.nodes[col.id]) || {x: WORKFLOW_MARGIN, y: WORKFLOW_MARGIN};
    positions[col.id] = {x: pos.x, y: pos.y};
    maxX = Math.max(maxX, pos.x + WORKFLOW_NODE_W);
    maxY = Math.max(maxY, pos.y + WORKFLOW_NODE_H);
  });
  return {
    positions: positions,
    width: maxX + WORKFLOW_MARGIN,
    height: maxY + WORKFLOW_MARGIN
  };
}

/* Point on the boundary of a WORKFLOW_NODE_W x WORKFLOW_NODE_H box
   centered at (cx, cy), in the direction of (towardX, towardY) — used
   to clip an edge line to the node's rectangle instead of drawing it
   into/through the box. */
function clipToNodeBoundary(cx, cy, towardX, towardY){
  var dx = towardX - cx, dy = towardY - cy;
  if(dx === 0 && dy === 0) return {x: cx, y: cy};
  var halfW = WORKFLOW_NODE_W / 2, halfH = WORKFLOW_NODE_H / 2;
  var scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  var scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  var scale = Math.min(scaleX, scaleY);
  return {x: cx + dx * scale, y: cy + dy * scale};
}

function edgePathD(fromPos, toPos){
  var fromCenter = {x: fromPos.x + WORKFLOW_NODE_W / 2, y: fromPos.y + WORKFLOW_NODE_H / 2};
  var toCenter = {x: toPos.x + WORKFLOW_NODE_W / 2, y: toPos.y + WORKFLOW_NODE_H / 2};
  var start = clipToNodeBoundary(fromCenter.x, fromCenter.y, toCenter.x, toCenter.y);
  var end = clipToNodeBoundary(toCenter.x, toCenter.y, fromCenter.x, fromCenter.y);
  return 'M ' + start.x + ' ' + start.y + ' L ' + end.x + ' ' + end.y;
}

export function updateWorkflowModeButtons(){
  document.querySelectorAll('.kf-workflow-mode-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-mode') === workflowEditorState.mode);
  });
}

export function setWorkflowMode(mode){
  workflowEditorState.mode = (mode === 'allowed' || mode === 'disallowed') ? mode : 'select';
  workflowEditorState.drawingFromColumnId = null;
  var draft = document.getElementById('workflowDraftEdge');
  if(draft) draft.remove();
  updateWorkflowModeButtons();
}

export function renderWorkflowEditor(){
  var project = getCurrentProject();
  var inner = document.getElementById('workflowInner');
  document.getElementById('workflowTitle').textContent = 'Workflow' + (project ? ' — ' + project.name : '');
  if(!project){
    inner.innerHTML = '';
    lastWorkflowLayout = null;
    return;
  }
  ensureProjectWorkflow(project);

  if(project.columns.length === 0){
    inner.innerHTML = '<div class="kf-depmap-empty">' + iconHTML('inbox', 36) + '<div>This board has no columns yet — add some columns to build a workflow.</div></div>';
    lastWorkflowLayout = null;
    return;
  }

  var layout = computeWorkflowLayout(project);
  lastWorkflowLayout = layout;

  var defsHTML =
    '<defs>' +
      '<marker id="kf-wf-arrow-allowed" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="var(--kf-good-fg)"></path></marker>' +
      '<marker id="kf-wf-arrow-disallowed" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="var(--kf-danger)"></path></marker>' +
    '</defs>';

  var edgesHTML = project.workflow.edges.map(function(e){
    var fromPos = layout.positions[e.fromColumnId], toPos = layout.positions[e.toColumnId];
    if(!fromPos || !toPos) return '';
    var d = edgePathD(fromPos, toPos);
    var isAllowed = e.type === 'allowed';
    var color = isAllowed ? 'var(--kf-good-fg)' : 'var(--kf-danger)';
    var marker = isAllowed ? 'url(#kf-wf-arrow-allowed)' : 'url(#kf-wf-arrow-disallowed)';
    return (
      '<g class="kf-wfedge-group" data-edge-id="' + e.id + '">' +
        (e.message ? '<title>' + escapeHTML(e.message) + '</title>' : '') +
        '<path class="kf-wfedge" d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.5" marker-end="' + marker + '"></path>' +
        '<path class="kf-wfedge-hit" data-edge-id="' + e.id + '" d="' + d + '" fill="none" stroke="transparent" stroke-width="16"></path>' +
      '</g>'
    );
  }).join('');

  var nodesHTML = project.columns.map(function(col){
    var pos = layout.positions[col.id];
    var name = col.name.length > 24 ? col.name.slice(0, 23) + '…' : col.name;
    var textX = col.done ? 28 : 16;
    return (
      '<g class="kf-wfnode" data-column-id="' + col.id + '" transform="translate(' + pos.x + ',' + pos.y + ')">' +
        '<rect class="kf-wfnode-box" x="0" y="0" width="' + WORKFLOW_NODE_W + '" height="' + WORKFLOW_NODE_H + '" rx="6" style="fill:var(--kf-surface);stroke:var(--kf-border-strong);" stroke-width="1.5"></rect>' +
        (col.done ? '<circle cx="16" cy="' + (WORKFLOW_NODE_H / 2) + '" r="4" fill="#22a06b"></circle>' : '') +
        '<text x="' + textX + '" y="' + (WORKFLOW_NODE_H / 2 + 5) + '" font-size="13" font-weight="600" style="fill:var(--kf-text);"><title>' + escapeHTML(col.name) + '</title>' + escapeHTML(name) + '</text>' +
      '</g>'
    );
  }).join('');

  var svgHTML =
    '<svg width="' + layout.width + '" height="' + layout.height + '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" xmlns="http://www.w3.org/2000/svg">' +
      defsHTML + edgesHTML + nodesHTML +
    '</svg>';

  inner.innerHTML = svgHTML;
  applyWorkflowZoom();
}

export function applyWorkflowZoom(){
  var svg = document.querySelector('#workflowInner svg');
  document.getElementById('workflowZoomLabel').textContent = Math.round(workflowEditorState.scale * 100) + '%';
  if(!svg || !lastWorkflowLayout) return;
  svg.setAttribute('width', Math.round(lastWorkflowLayout.width * workflowEditorState.scale));
  svg.setAttribute('height', Math.round(lastWorkflowLayout.height * workflowEditorState.scale));
}
export function setWorkflowZoom(delta){
  workflowEditorState.scale = Math.max(WORKFLOW_MIN_ZOOM, Math.min(WORKFLOW_MAX_ZOOM, Math.round((workflowEditorState.scale + delta) * 100) / 100));
  applyWorkflowZoom();
}
export function resetWorkflowZoom(){
  workflowEditorState.scale = 1;
  applyWorkflowZoom();
  var scroll = document.getElementById('workflowScroll');
  scroll.scrollLeft = 0;
  scroll.scrollTop = 0;
}
export function zoomWorkflowAtPoint(deltaScale, clientX, clientY){
  if(!lastWorkflowLayout) return;
  var scroll = document.getElementById('workflowScroll');
  if(!scroll) return;

  var oldScale = workflowEditorState.scale;
  var newScale = Math.max(WORKFLOW_MIN_ZOOM, Math.min(WORKFLOW_MAX_ZOOM, Math.round((oldScale + deltaScale) * 100) / 100));
  if(newScale === oldScale) return;

  var rect = scroll.getBoundingClientRect();
  var offsetX = clientX != null ? clientX - rect.left : rect.width / 2;
  var offsetY = clientY != null ? clientY - rect.top : rect.height / 2;

  var oldWidth = lastWorkflowLayout.width * oldScale;
  var oldHeight = lastWorkflowLayout.height * oldScale;
  var fracX = oldWidth > 0 ? (scroll.scrollLeft + offsetX) / oldWidth : 0;
  var fracY = oldHeight > 0 ? (scroll.scrollTop + offsetY) / oldHeight : 0;

  workflowEditorState.scale = newScale;
  applyWorkflowZoom();

  var newWidth = lastWorkflowLayout.width * newScale;
  var newHeight = lastWorkflowLayout.height * newScale;
  scroll.scrollLeft = fracX * newWidth - offsetX;
  scroll.scrollTop = fracY * newHeight - offsetY;
}

export function openWorkflowOverlay(){
  var project = getCurrentProject();
  if(!project){ _toast('No project selected.'); return; }
  workflowEditorState.scale = 1;
  workflowEditorState.panActive = false;
  workflowEditorState.panMoved = false;
  workflowEditorState.mode = 'select';
  workflowEditorState.draggingColumnId = null;
  workflowEditorState.drawingFromColumnId = null;
  closeWorkflowEdgePopover();
  updateWorkflowModeButtons();
  renderWorkflowEditor();
  document.getElementById('workflowOverlay').classList.remove('hidden');
}
export function closeWorkflowOverlay(){
  document.getElementById('workflowOverlay').classList.add('hidden');
  workflowEditorState.panActive = false;
  workflowEditorState.panMoved = false;
  workflowEditorState.draggingColumnId = null;
  workflowEditorState.drawingFromColumnId = null;
  closeWorkflowEdgePopover();
  document.getElementById('workflowScroll').classList.remove('kf-depmap-panning');
}
export function isWorkflowOverlayOpen(){
  return !document.getElementById('workflowOverlay').classList.contains('hidden');
}

function clientPointToSvgPoint(clientX, clientY){
  var svg = document.querySelector('#workflowInner svg');
  if(!svg) return {x: 0, y: 0};
  var rect = svg.getBoundingClientRect();
  var scale = workflowEditorState.scale || 1;
  return {x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale};
}

function startWorkflowNodeDrag(columnId, clientX, clientY){
  var project = getCurrentProject();
  if(!project || !project.workflow) return;
  var node = project.workflow.nodes[columnId];
  if(!node) return;
  workflowEditorState.draggingColumnId = columnId;
  workflowEditorState.dragMoved = false;
  workflowEditorState.dragPointerStartX = clientX;
  workflowEditorState.dragPointerStartY = clientY;
  workflowEditorState.dragNodeStartX = node.x;
  workflowEditorState.dragNodeStartY = node.y;
}

function updateWorkflowDraftEdge(clientX, clientY){
  var project = getCurrentProject();
  var draft = document.getElementById('workflowDraftEdge');
  if(!draft || !project || !project.workflow) return;
  var fromNode = project.workflow.nodes[workflowEditorState.drawingFromColumnId];
  if(!fromNode) return;
  var point = clientPointToSvgPoint(clientX, clientY);
  var fromCenter = {x: fromNode.x + WORKFLOW_NODE_W / 2, y: fromNode.y + WORKFLOW_NODE_H / 2};
  var start = clipToNodeBoundary(fromCenter.x, fromCenter.y, point.x, point.y);
  draft.setAttribute('d', 'M ' + start.x + ' ' + start.y + ' L ' + point.x + ' ' + point.y);
}

function startWorkflowEdgeDraw(columnId, clientX, clientY){
  workflowEditorState.drawingFromColumnId = columnId;
  var svg = document.querySelector('#workflowInner svg');
  if(!svg) return;
  var draft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  draft.setAttribute('id', 'workflowDraftEdge');
  draft.setAttribute('fill', 'none');
  draft.setAttribute('stroke', workflowEditorState.mode === 'disallowed' ? 'var(--kf-danger)' : 'var(--kf-good-fg)');
  draft.setAttribute('stroke-width', '2.5');
  draft.setAttribute('stroke-dasharray', '5,4');
  svg.appendChild(draft);
  updateWorkflowDraftEdge(clientX, clientY);
}

function updateConnectedWorkflowEdges(project, columnId){
  var layout = lastWorkflowLayout;
  if(!layout) return;
  layout.positions[columnId] = {x: project.workflow.nodes[columnId].x, y: project.workflow.nodes[columnId].y};
  project.workflow.edges.forEach(function(e){
    if(e.fromColumnId !== columnId && e.toColumnId !== columnId) return;
    var fromPos = layout.positions[e.fromColumnId], toPos = layout.positions[e.toColumnId];
    if(!fromPos || !toPos) return;
    var d = edgePathD(fromPos, toPos);
    var group = document.querySelector('.kf-wfedge-group[data-edge-id="' + e.id + '"]');
    if(!group) return;
    var path = group.querySelector('.kf-wfedge');
    var hit = group.querySelector('.kf-wfedge-hit');
    if(path) path.setAttribute('d', d);
    if(hit) hit.setAttribute('d', d);
  });
}

/* Single mousedown entry point for the scroll container: dispatches to
   node-drag or edge-draw when the pointer is down on a node, otherwise
   falls through to panning — mirroring the org chart / dependency map
   pan wiring, but node/edge interactions take priority over pan. */
export function handleWorkflowScrollMouseDown(e){
  if(e.button !== 0) return;
  var nodeEl = e.target.closest ? e.target.closest('.kf-wfnode') : null;
  if(nodeEl){
    var columnId = nodeEl.getAttribute('data-column-id');
    if(workflowEditorState.mode === 'select') startWorkflowNodeDrag(columnId, e.clientX, e.clientY);
    else startWorkflowEdgeDraw(columnId, e.clientX, e.clientY);
    return;
  }
  workflowEditorState.panActive = true;
  workflowEditorState.panMoved = false;
  workflowEditorState.panStartX = e.clientX;
  workflowEditorState.panStartY = e.clientY;
  var scroll = document.getElementById('workflowScroll');
  workflowEditorState.panStartScrollLeft = scroll.scrollLeft;
  workflowEditorState.panStartScrollTop = scroll.scrollTop;
  scroll.classList.add('kf-depmap-panning');
}

export function handleWorkflowPointerMove(e){
  if(workflowEditorState.draggingColumnId){
    var project = getCurrentProject();
    if(!project || !project.workflow) return;
    var dxScreen = e.clientX - workflowEditorState.dragPointerStartX;
    var dyScreen = e.clientY - workflowEditorState.dragPointerStartY;
    if(Math.abs(dxScreen) > 2 || Math.abs(dyScreen) > 2) workflowEditorState.dragMoved = true;
    var scale = workflowEditorState.scale || 1;
    var newX = Math.max(0, workflowEditorState.dragNodeStartX + dxScreen / scale);
    var newY = Math.max(0, workflowEditorState.dragNodeStartY + dyScreen / scale);
    var node = project.workflow.nodes[workflowEditorState.draggingColumnId];
    if(!node) return;
    node.x = newX;
    node.y = newY;
    var nodeEl = document.querySelector('.kf-wfnode[data-column-id="' + workflowEditorState.draggingColumnId + '"]');
    if(nodeEl) nodeEl.setAttribute('transform', 'translate(' + newX + ',' + newY + ')');
    updateConnectedWorkflowEdges(project, workflowEditorState.draggingColumnId);
    return;
  }
  if(workflowEditorState.drawingFromColumnId){
    updateWorkflowDraftEdge(e.clientX, e.clientY);
    return;
  }
  if(workflowEditorState.panActive){
    var scroll = document.getElementById('workflowScroll');
    var dx = e.clientX - workflowEditorState.panStartX;
    var dy = e.clientY - workflowEditorState.panStartY;
    if(Math.abs(dx) > 3 || Math.abs(dy) > 3) workflowEditorState.panMoved = true;
    if(workflowEditorState.panMoved){
      scroll.scrollLeft = workflowEditorState.panStartScrollLeft - dx;
      scroll.scrollTop = workflowEditorState.panStartScrollTop - dy;
    }
  }
}

export function handleWorkflowPointerUp(e){
  if(workflowEditorState.draggingColumnId){
    var project = getCurrentProject();
    var columnId = workflowEditorState.draggingColumnId;
    workflowEditorState.draggingColumnId = null;
    if(project && project.workflow && project.workflow.nodes[columnId]){
      var node = project.workflow.nodes[columnId];
      setWorkflowNodePosition(project, columnId, node.x, node.y);
    }
    renderWorkflowEditor();
    return;
  }
  if(workflowEditorState.drawingFromColumnId){
    var fromColumnId = workflowEditorState.drawingFromColumnId;
    workflowEditorState.drawingFromColumnId = null;
    var draft = document.getElementById('workflowDraftEdge');
    if(draft) draft.remove();
    var targetEl = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
    var targetNodeEl = targetEl && targetEl.closest ? targetEl.closest('.kf-wfnode') : null;
    var toColumnId = targetNodeEl ? targetNodeEl.getAttribute('data-column-id') : null;
    if(toColumnId && toColumnId !== fromColumnId){
      var project2 = getCurrentProject();
      var edge = addWorkflowEdge(project2, fromColumnId, toColumnId, workflowEditorState.mode, null);
      renderWorkflowEditor();
      if(edge && workflowEditorState.mode === 'disallowed'){
        openWorkflowEdgePopover(edge.id, e.clientX, e.clientY);
      }
    }
    return;
  }
  if(workflowEditorState.panActive){
    workflowEditorState.panActive = false;
    var scroll = document.getElementById('workflowScroll');
    if(scroll) scroll.classList.remove('kf-depmap-panning');
  }
}

export function handleWorkflowInnerClick(e){
  if(workflowEditorState.panMoved || workflowEditorState.dragMoved) return;
  if(workflowEditorState.mode !== 'select') return;
  var hit = e.target.closest ? e.target.closest('.kf-wfedge-hit') : null;
  if(!hit) return;
  openWorkflowEdgePopover(hit.getAttribute('data-edge-id'), e.clientX, e.clientY);
}

export function openWorkflowEdgePopover(edgeId, clientX, clientY){
  var project = getCurrentProject();
  var edge = project && project.workflow ? project.workflow.edges.filter(function(e){ return e.id === edgeId; })[0] : null;
  if(!edge) return;
  workflowEditorState.popoverEdgeId = edgeId;
  var fromCol = project.columns.filter(function(c){ return c.id === edge.fromColumnId; })[0];
  var toCol = project.columns.filter(function(c){ return c.id === edge.toColumnId; })[0];
  document.getElementById('workflowEdgePopoverTitle').textContent =
    (fromCol ? fromCol.name : '?') + ' → ' + (toCol ? toCol.name : '?');
  document.getElementById('workflowEdgeTypeSelect').value = edge.type;
  document.getElementById('workflowEdgeMessageInput').value = edge.message || '';
  updateWorkflowEdgePopoverMessageVisibility();

  var popover = document.getElementById('workflowEdgePopover');
  popover.classList.remove('hidden');
  var popW = popover.offsetWidth || 280;
  var left = Math.min(clientX, window.innerWidth - popW - 12);
  left = Math.max(8, left);
  var top = Math.min(clientY, window.innerHeight - 12);
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}
export function updateWorkflowEdgePopoverMessageVisibility(){
  var isDisallowed = document.getElementById('workflowEdgeTypeSelect').value === 'disallowed';
  document.getElementById('workflowEdgeMessageField').classList.toggle('hidden', !isDisallowed);
}
export function closeWorkflowEdgePopover(){
  document.getElementById('workflowEdgePopover').classList.add('hidden');
  workflowEditorState.popoverEdgeId = null;
}
export function isWorkflowEdgePopoverOpen(){
  return !document.getElementById('workflowEdgePopover').classList.contains('hidden');
}
export function saveWorkflowEdgePopover(){
  var project = getCurrentProject();
  if(!project || !workflowEditorState.popoverEdgeId) return;
  var type = document.getElementById('workflowEdgeTypeSelect').value;
  var message = document.getElementById('workflowEdgeMessageInput').value;
  updateWorkflowEdge(project, workflowEditorState.popoverEdgeId, type, message);
  closeWorkflowEdgePopover();
  renderWorkflowEditor();
}
export function deleteWorkflowEdgeFromPopover(){
  var project = getCurrentProject();
  if(!project || !workflowEditorState.popoverEdgeId) return;
  deleteWorkflowEdge(project, workflowEditorState.popoverEdgeId);
  closeWorkflowEdgePopover();
  renderWorkflowEditor();
}
