"use strict";
import { iconSvg, hydrateIcons } from '../icons.js';
import { escapeHTML } from '../utils.js';
import { uid } from '../storage.js';
import { roundedOrthogonalPathD, DEPMAP_CORNER_RADIUS } from './dependency-map.js';
import { pickAttachmentSide, sideMidpoint as ggSideMidpoint, sideNormal, buildOrthogonalPoints, edgeGeometry, computeMultiEdgeOffsets, computeEdgeLaneOverrides } from '../features/graph-geometry.js';
import { gateKey } from '../features/form-workflow-engine.js';
import { chatApi, portalsApi } from '../api.js';

/* =========================================================
   ENTERPRISE FORMS ACTION WORKFLOW — visual builder (Phase 4)

   Unlike views/workflow-editor.js's Board-Column Workflow (nodes derived from project.columns, no
   independent identity), a Form Workflow's nodes ARE the primary entities — this editor owns a plain
   in-memory {nodes, edges} graph handed to it by modals/forms-admin.js (parsed from the current
   builderForm's WorkflowJson) and handed back on close, exactly like that module already treats
   builderForm.fields — no separate save step here, "Save Form" persists both in one PUT. Geometry
   (attachment sides, orthogonal routing, parallel-edge offsets) reuses features/graph-geometry.js,
   the same module views/workflow-editor.js was refactored to use in this same pass — see that
   module's own doc comment for why a Form Workflow needs no id-remap on clone, unlike the Board's.

   Node shape: {id, x, y, type: 'start'|'author'|'approval'|'end', label, authorGates, approverGates,
   approvalMode: 'any'|'all'}. Edge shape: {id, fromNodeId, toNodeId} — a single plain-transition
   type, no Allowed/Disallowed/Conditional distinction (gating lives on the NODE, not the edge, see
   features/form-workflow-engine.js's own doc comment). No conditional edges in v1, per the approved
   plan's own explicit scope note.
   ========================================================= */

export var FORM_WF_NODE_W = 180;
export var FORM_WF_NODE_H = 64;
var FORM_WF_MARGIN = 40;
var FORM_WF_GAP_X = 100;
var FORM_WF_EDGE_STUB = 24;
var FORM_WF_MULTI_EDGE_SPACING = 24;

var NODE_TYPE_META = {
  start:    {label: 'Start',    icon: 'rocket'},
  author:   {label: 'Author',   icon: 'edit'},
  approval: {label: 'Approval', icon: 'check'},
  end:      {label: 'End',      icon: 'checkSquare'},
  // "Action" nodes auto-execute the instant the graph transitions into them — no gating, no user
  // action needed (unlike Author/Approval) — see FormSubmissionService.ApplyNextNodeAsync (and its
  // PHP twins) for the server-side execution this UI just configures. raiseTaskInPortal is the only
  // actionType implemented so far.
  action:   {label: 'Action',   icon: 'sparkle'}
};

var GATE_USER_TYPE_LABELS = {teamMember: 'Team Member', projectAdmin: 'Project Admin', orgAdmin: 'Org Admin'};

var _toast = function(msg){ console.error(msg); };
export function setFormWorkflowEditorDeps(deps){
  if(deps.toast) _toast = deps.toast;
}

export var formWorkflowEditorState = {
  workflow: {nodes: [], edges: []},
  readOnly: false,
  mode: 'select', // 'select' | 'connect'
  draggingNodeId: null, dragMoved: false, dragPointerStartX: 0, dragPointerStartY: 0, dragNodeStartX: 0, dragNodeStartY: 0,
  drawingFromNodeId: null,
  popoverNodeId: null,
  popoverEdgeId: null,
  orgUsers: [],
  orgUsersLoaded: false,
  portals: [],
  portalsLoaded: false
};

/* Called by modals/forms-admin.js when opening the Workflow sub-editor for the form version
   currently in the field builder — `workflow` is a plain already-parsed {nodes, edges} object (see
   features/form-workflow-engine.js's parseFormWorkflow), mutated in place by this whole module so
   the caller can just re-serialize the SAME object reference on close. */
export function loadFormWorkflowGraph(workflow, readOnly){
  formWorkflowEditorState.workflow = workflow && Array.isArray(workflow.nodes) && Array.isArray(workflow.edges) ? workflow : {nodes: [], edges: []};
  formWorkflowEditorState.readOnly = !!readOnly;
  formWorkflowEditorState.mode = 'select';
  formWorkflowEditorState.draggingNodeId = null;
  formWorkflowEditorState.drawingFromNodeId = null;
  closeFormWorkflowNodePopover();
  closeFormWorkflowEdgePopover();
  if(!formWorkflowEditorState.orgUsersLoaded){
    chatApi.orgUsers().then(function(users){
      formWorkflowEditorState.orgUsers = users || [];
      formWorkflowEditorState.orgUsersLoaded = true;
    }, function(){ formWorkflowEditorState.orgUsersLoaded = true; });
  }
  // Only Org Admins reach this editor at all (Forms authoring is Org-Admin-only), so the same
  // OrgAdmin-gated /organisations/me/portals listing is always reachable here — no separate
  // "am I allowed to see this" check needed beyond what already gates the whole Forms Admin modal.
  if(!formWorkflowEditorState.portalsLoaded){
    portalsApi.list().then(function(portals){
      formWorkflowEditorState.portals = portals || [];
      formWorkflowEditorState.portalsLoaded = true;
    }, function(){ formWorkflowEditorState.portalsLoaded = true; });
  }
  updateFormWorkflowModeButtons();
  updateFormWorkflowAddButtons();
  renderFormWorkflowEditor();
}
export function getFormWorkflowGraph(){
  return formWorkflowEditorState.workflow;
}

function orgUserName(userId){
  var u = formWorkflowEditorState.orgUsers.filter(function(x){ return x.id === userId; })[0];
  return u ? u.displayName : 'Unknown user';
}
function gateLabel(gate){
  return gate.kind === 'namedUser' ? orgUserName(gate.value) : (GATE_USER_TYPE_LABELS[gate.value] || gate.value);
}

// ---- Layout / geometry (thin wrappers over features/graph-geometry.js, mirroring
// views/workflow-editor.js's own split) ----

function sideMidpoint(pos, side){ return ggSideMidpoint(pos, side, FORM_WF_NODE_W, FORM_WF_NODE_H); }
function formWfEdgeGeometry(fromPos, toPos, offset){ return edgeGeometry(fromPos, toPos, offset, FORM_WF_NODE_W, FORM_WF_NODE_H); }
function formWfMultiEdgeOffsets(edges){
  var positions = {};
  formWorkflowEditorState.workflow.nodes.forEach(function(n){ positions[n.id] = {x: n.x, y: n.y}; });
  return computeMultiEdgeOffsets(edges, positions, function(e){ return e.fromNodeId; }, function(e){ return e.toNodeId; }, FORM_WF_MULTI_EDGE_SPACING);
}
function edgePathD(fromPos, toPos, midOverride, offset){
  var geom = formWfEdgeGeometry(fromPos, toPos, offset);
  var points = buildOrthogonalPoints(geom.start, geom.dir1, geom.end, geom.dir2, midOverride, FORM_WF_EDGE_STUB);
  return roundedOrthogonalPathD(points, DEPMAP_CORNER_RADIUS);
}

function computeFormWorkflowLayout(){
  var positions = {};
  var maxX = FORM_WF_MARGIN, maxY = FORM_WF_MARGIN;
  formWorkflowEditorState.workflow.nodes.forEach(function(n){
    positions[n.id] = {x: n.x || 0, y: n.y || 0};
    maxX = Math.max(maxX, (n.x || 0) + FORM_WF_NODE_W);
    maxY = Math.max(maxY, (n.y || 0) + FORM_WF_NODE_H);
  });
  return {positions: positions, width: maxX + FORM_WF_MARGIN, height: maxY + FORM_WF_MARGIN};
}

function gateSummary(node){
  if(node.type === 'author') return (node.authorGates || []).length + ' gate' + ((node.authorGates || []).length === 1 ? '' : 's');
  if(node.type === 'approval') return (node.approverGates || []).length + ' gate' + ((node.approverGates || []).length === 1 ? '' : 's') + ' · ' + (node.approvalMode === 'all' ? 'ALL' : 'ANY');
  if(node.type === 'action'){
    var cfg = node.config || {};
    var portal = formWorkflowEditorState.portals.filter(function(p){ return p.id === cfg.portalId; })[0];
    // The target Portal is resolved dynamically at submit time (whichever Portal the submission
    // actually came through) — cfg.portalId is only ever a fallback for a "free floating" (not
    // filled out via any Portal) submission, so this summary reads as a default, not a requirement.
    return portal ? ('Raise task · default Portal: ' + portal.name) : 'Raise task in the submitter\'s Portal';
  }
  return '';
}

export function renderFormWorkflowEditor(){
  var inner = document.getElementById('formWorkflowInner');
  if(!inner) return;
  var workflow = formWorkflowEditorState.workflow;

  if(workflow.nodes.length === 0){
    inner.innerHTML = '<div class="kf-depmap-empty">' + iconSvg('workflow', 36) + '<div>No workflow yet — use the buttons above to add a Start node and build out the approval flow.</div></div>';
    hydrateIcons(inner);
    return;
  }

  var layout = computeFormWorkflowLayout();

  var edgeOffsets = formWfMultiEdgeOffsets(workflow.edges);
  var edgeGeoms = {};
  workflow.edges.forEach(function(e){
    var fromPos = layout.positions[e.fromNodeId], toPos = layout.positions[e.toNodeId];
    if(!fromPos || !toPos) return;
    edgeGeoms[e.id] = formWfEdgeGeometry(fromPos, toPos, edgeOffsets[e.id]);
  });
  computeEdgeLaneOverrides(Object.keys(edgeGeoms).map(function(id){ return edgeGeoms[id]; }), FORM_WF_EDGE_STUB);

  var defsHTML = '<defs>' +
    '<marker id="kf-fwf-dot-start" viewBox="0 0 10 10" refX="0.75" refY="5" markerWidth="8" markerHeight="8" orient="auto"><circle cx="5" cy="5" r="3" fill="var(--kf-surface)" stroke="var(--kf-blue)" stroke-width="1.6"/></marker>' +
    '<marker id="kf-fwf-dot-end" viewBox="0 0 10 10" refX="9.25" refY="5" markerWidth="8" markerHeight="8" orient="auto"><circle cx="5" cy="5" r="3" fill="var(--kf-blue)" stroke="var(--kf-blue)" stroke-width="1.6"/></marker>' +
  '</defs>';

  var edgesHTML = workflow.edges.map(function(e){
    var fromPos = layout.positions[e.fromNodeId], toPos = layout.positions[e.toNodeId];
    if(!fromPos || !toPos) return '';
    var d = edgePathD(fromPos, toPos, edgeGeoms[e.id] ? edgeGeoms[e.id].midOverride : null, edgeOffsets[e.id]);
    return (
      '<g class="kf-wfedge-group" data-edge-id="' + e.id + '">' +
        '<path class="kf-wfedge" d="' + d + '" fill="none" stroke="var(--kf-blue)" stroke-width="2.5" marker-start="url(#kf-fwf-dot-start)" marker-end="url(#kf-fwf-dot-end)"></path>' +
        '<path class="kf-wfedge-hit" data-edge-id="' + e.id + '" d="' + d + '" fill="none" stroke="transparent" stroke-width="16"></path>' +
      '</g>'
    );
  }).join('');

  var nodesHTML = workflow.nodes.map(function(n){
    var pos = layout.positions[n.id];
    var meta = NODE_TYPE_META[n.type] || NODE_TYPE_META.start;
    var label = n.label || meta.label;
    var summary = gateSummary(n);
    return (
      '<g class="kf-wfnode kf-fwfnode kf-fwfnode-' + n.type + '" data-node-id="' + n.id + '" transform="translate(' + pos.x + ',' + pos.y + ')">' +
        '<rect class="kf-wfnode-box" x="0" y="0" width="' + FORM_WF_NODE_W + '" height="' + FORM_WF_NODE_H + '" rx="6" style="fill:var(--kf-surface);stroke:var(--kf-border-strong);" stroke-width="1.5"></rect>' +
        '<g transform="translate(10,10)" style="color:var(--kf-blue);">' + iconSvg(meta.icon, 16) + '</g>' +
        '<text x="34" y="26" font-size="13" font-weight="600" style="fill:var(--kf-text);">' + escapeHTML(label.length > 16 ? label.slice(0, 15) + '…' : label) + '</text>' +
        '<text x="12" y="46" font-size="10" style="fill:var(--kf-text-faint);">' + escapeHTML(meta.label) + (summary ? ' · ' + escapeHTML(summary) : '') + '</text>' +
      '</g>'
    );
  }).join('');

  inner.innerHTML = '<svg width="' + layout.width + '" height="' + layout.height + '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" xmlns="http://www.w3.org/2000/svg">' + defsHTML + edgesHTML + nodesHTML + '</svg>';
}

export function updateFormWorkflowModeButtons(){
  document.querySelectorAll('.kf-form-workflow-mode-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-mode') === formWorkflowEditorState.mode);
  });
}
export function setFormWorkflowMode(mode){
  if(formWorkflowEditorState.readOnly) return;
  formWorkflowEditorState.mode = mode === 'connect' ? 'connect' : 'select';
  formWorkflowEditorState.drawingFromNodeId = null;
  var draft = document.getElementById('formWorkflowDraftEdge');
  if(draft) draft.remove();
  updateFormWorkflowModeButtons();
}
function updateFormWorkflowAddButtons(){
  ['formWorkflowAddStartBtn', 'formWorkflowAddAuthorBtn', 'formWorkflowAddApprovalBtn', 'formWorkflowAddEndBtn', 'formWorkflowAddActionBtn', 'formWorkflowModeConnectBtn'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.classList.toggle('hidden', formWorkflowEditorState.readOnly);
  });
}

function nextNodePosition(){
  var nodes = formWorkflowEditorState.workflow.nodes;
  if(nodes.length === 0) return {x: FORM_WF_MARGIN, y: FORM_WF_MARGIN};
  var maxX = Math.max.apply(null, nodes.map(function(n){ return n.x || 0; }));
  var sameColumn = nodes.filter(function(n){ return (n.x || 0) === maxX; });
  var maxY = Math.max.apply(null, sameColumn.map(function(n){ return n.y || 0; }));
  // A fresh column starts once the current one already has 3 nodes stacked — keeps the graph from
  // growing into one impossibly tall single column for a large approval chain with many branches.
  if(sameColumn.length >= 3) return {x: maxX + FORM_WF_NODE_W + FORM_WF_GAP_X, y: FORM_WF_MARGIN};
  return {x: maxX, y: maxY + FORM_WF_NODE_H + 30};
}

export function addFormWorkflowNode(type){
  if(formWorkflowEditorState.readOnly) return;
  var pos = nextNodePosition();
  var node = {
    id: uid('fwfnode'), type: type, x: pos.x, y: pos.y,
    label: (NODE_TYPE_META[type] || NODE_TYPE_META.start).label,
    authorGates: type === 'author' ? [] : undefined,
    approverGates: type === 'approval' ? [] : undefined,
    approvalMode: type === 'approval' ? 'any' : undefined,
    actionType: type === 'action' ? 'raiseTaskInPortal' : undefined,
    config: type === 'action' ? {portalId: null, priorityColumn: 'medium', assigneeGate: null, titleTemplate: ''} : undefined
  };
  formWorkflowEditorState.workflow.nodes.push(node);
  renderFormWorkflowEditor();
}

function removeFormWorkflowNode(nodeId){
  var workflow = formWorkflowEditorState.workflow;
  workflow.nodes = workflow.nodes.filter(function(n){ return n.id !== nodeId; });
  workflow.edges = workflow.edges.filter(function(e){ return e.fromNodeId !== nodeId && e.toNodeId !== nodeId; });
}

// ---- Pointer interaction (drag nodes in Select mode, draw edges in Connect mode) ----
// Mirrors views/workflow-editor.js's own handleWorkflow*/start* functions in shape — no zoom/pan
// here (a Form Workflow graph is small enough that a plain scrollable container is enough, unlike
// the Board Workflow's potentially-large column graph), so there's no scale factor to divide by.

function startFormWorkflowNodeDrag(nodeId, clientX, clientY){
  var node = formWorkflowEditorState.workflow.nodes.filter(function(n){ return n.id === nodeId; })[0];
  if(!node) return;
  formWorkflowEditorState.draggingNodeId = nodeId;
  formWorkflowEditorState.dragMoved = false;
  formWorkflowEditorState.dragPointerStartX = clientX;
  formWorkflowEditorState.dragPointerStartY = clientY;
  formWorkflowEditorState.dragNodeStartX = node.x || 0;
  formWorkflowEditorState.dragNodeStartY = node.y || 0;
}

function clientPointToSvgPoint(clientX, clientY){
  var svg = document.querySelector('#formWorkflowInner svg');
  if(!svg) return {x: 0, y: 0};
  var rect = svg.getBoundingClientRect();
  return {x: clientX - rect.left, y: clientY - rect.top};
}
function updateFormWorkflowDraftEdge(clientX, clientY){
  var draft = document.getElementById('formWorkflowDraftEdge');
  var fromNode = formWorkflowEditorState.workflow.nodes.filter(function(n){ return n.id === formWorkflowEditorState.drawingFromNodeId; })[0];
  if(!draft || !fromNode) return;
  var point = clientPointToSvgPoint(clientX, clientY);
  var fromPos = {x: fromNode.x || 0, y: fromNode.y || 0};
  var fromCenter = {x: fromPos.x + FORM_WF_NODE_W / 2, y: fromPos.y + FORM_WF_NODE_H / 2};
  var side = pickAttachmentSide(fromCenter, point);
  var start = sideMidpoint(fromPos, side);
  var dir1 = sideNormal(side);
  var stub = {x: start.x + dir1.x * FORM_WF_EDGE_STUB, y: start.y + dir1.y * FORM_WF_EDGE_STUB};
  draft.setAttribute('d', roundedOrthogonalPathD([start, stub, point], DEPMAP_CORNER_RADIUS));
}
function startFormWorkflowEdgeDraw(nodeId, clientX, clientY){
  formWorkflowEditorState.drawingFromNodeId = nodeId;
  var svg = document.querySelector('#formWorkflowInner svg');
  if(!svg) return;
  var draft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  draft.setAttribute('id', 'formWorkflowDraftEdge');
  draft.setAttribute('fill', 'none');
  draft.setAttribute('stroke', 'var(--kf-blue)');
  draft.setAttribute('stroke-width', '2.5');
  draft.setAttribute('stroke-dasharray', '5,4');
  svg.appendChild(draft);
  updateFormWorkflowDraftEdge(clientX, clientY);
}

export function handleFormWorkflowScrollMouseDown(e){
  if(formWorkflowEditorState.readOnly) return;
  if(e.button !== 0) return;
  var nodeEl = e.target.closest ? e.target.closest('.kf-fwfnode') : null;
  if(!nodeEl) return;
  var nodeId = nodeEl.getAttribute('data-node-id');
  if(formWorkflowEditorState.mode === 'select') startFormWorkflowNodeDrag(nodeId, e.clientX, e.clientY);
  else startFormWorkflowEdgeDraw(nodeId, e.clientX, e.clientY);
}

export function handleFormWorkflowPointerMove(e){
  if(formWorkflowEditorState.draggingNodeId){
    var node = formWorkflowEditorState.workflow.nodes.filter(function(n){ return n.id === formWorkflowEditorState.draggingNodeId; })[0];
    if(!node) return;
    var dx = e.clientX - formWorkflowEditorState.dragPointerStartX;
    var dy = e.clientY - formWorkflowEditorState.dragPointerStartY;
    if(Math.abs(dx) > 2 || Math.abs(dy) > 2) formWorkflowEditorState.dragMoved = true;
    node.x = Math.max(0, formWorkflowEditorState.dragNodeStartX + dx);
    node.y = Math.max(0, formWorkflowEditorState.dragNodeStartY + dy);
    var nodeEl = document.querySelector('.kf-fwfnode[data-node-id="' + node.id + '"]');
    if(nodeEl) nodeEl.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
    renderFormWorkflowEditor();
    return;
  }
  if(formWorkflowEditorState.drawingFromNodeId){
    updateFormWorkflowDraftEdge(e.clientX, e.clientY);
  }
}

export function handleFormWorkflowPointerUp(e){
  if(formWorkflowEditorState.draggingNodeId){
    formWorkflowEditorState.draggingNodeId = null;
    if(formWorkflowEditorState.dragMoved){
      setTimeout(function(){ formWorkflowEditorState.dragMoved = false; }, 50);
    }
    return;
  }
  if(formWorkflowEditorState.drawingFromNodeId){
    var fromNodeId = formWorkflowEditorState.drawingFromNodeId;
    formWorkflowEditorState.drawingFromNodeId = null;
    var draft = document.getElementById('formWorkflowDraftEdge');
    if(draft) draft.remove();
    var targetEl = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
    var targetNodeEl = targetEl && targetEl.closest ? targetEl.closest('.kf-fwfnode') : null;
    var toNodeId = targetNodeEl ? targetNodeEl.getAttribute('data-node-id') : null;
    if(toNodeId && toNodeId !== fromNodeId){
      var workflow = formWorkflowEditorState.workflow;
      var alreadyExists = workflow.edges.some(function(edge){ return edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId; });
      if(!alreadyExists){
        workflow.edges.push({id: uid('fwfedge'), fromNodeId: fromNodeId, toNodeId: toNodeId});
      }
      renderFormWorkflowEditor();
    }
  }
}

export function handleFormWorkflowInnerClick(e){
  if(formWorkflowEditorState.dragMoved) return;
  if(formWorkflowEditorState.mode !== 'select') return;
  var hit = e.target.closest ? e.target.closest('.kf-wfedge-hit') : null;
  if(hit){
    openFormWorkflowEdgePopover(hit.getAttribute('data-edge-id'), e.clientX, e.clientY);
    return;
  }
  var nodeHit = e.target.closest ? e.target.closest('.kf-fwfnode') : null;
  if(!nodeHit) return;
  openFormWorkflowNodePopover(nodeHit.getAttribute('data-node-id'), e.clientX, e.clientY);
}

// ---- Node config popover (label + type-specific gates editor) ----

function findNode(nodeId){
  return formWorkflowEditorState.workflow.nodes.filter(function(n){ return n.id === nodeId; })[0] || null;
}

function renderGateListHTML(gates){
  if(!gates || gates.length === 0) return '<div class="kf-form-wf-gate-empty">No one can act on this step yet — add a gate below.</div>';
  return gates.map(function(g, i){
    return '<div class="kf-form-wf-gate-row" data-gate-index="' + i + '">' +
      '<span class="kf-form-wf-gate-label">' + escapeHTML(gateLabel(g)) + '</span>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-remove-gate="' + i + '" title="Remove">&times;</button>' +
    '</div>';
  }).join('');
}

/* `prefix` ('author'|'approval') scopes every id in this row so the Author and Approval sections —
   both always present in the popover's DOM at once, just toggled .hidden — never collide on a
   shared id. A real bug found live during this Phase's own verification: with one shared hardcoded
   id set for both sections, document.getElementById always resolved to whichever section's markup
   happened to come FIRST in the DOM (Author's), so interacting with the Approval section's visible
   controls was silently reading/writing the Author section's hidden, identically-id'd elements
   instead — gate adds landed on the wrong node's gate list entirely. */
function renderGateAddRowHTML(prefix){
  var userOptions = formWorkflowEditorState.orgUsers.map(function(u){
    return '<option value="' + escapeHTML(u.id) + '">' + escapeHTML(u.displayName) + '</option>';
  }).join('');
  return (
    '<div class="kf-form-wf-gate-add-row">' +
      '<select id="formWorkflowGateKindSelect-' + prefix + '">' +
        '<option value="userType">User type</option>' +
        '<option value="namedUser">Specific person</option>' +
      '</select>' +
      '<select id="formWorkflowGateUserTypeSelect-' + prefix + '">' +
        '<option value="teamMember">Team Member</option>' +
        '<option value="projectAdmin">Project Admin</option>' +
        '<option value="orgAdmin">Org Admin</option>' +
      '</select>' +
      '<select id="formWorkflowGateNamedUserSelect-' + prefix + '" class="hidden">' + userOptions + '</select>' +
      '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" id="formWorkflowGateAddBtn-' + prefix + '">Add</button>' +
    '</div>'
  );
}

export function openFormWorkflowNodePopover(nodeId, clientX, clientY){
  var node = findNode(nodeId);
  if(!node) return;
  formWorkflowEditorState.popoverNodeId = nodeId;
  var meta = NODE_TYPE_META[node.type] || NODE_TYPE_META.start;
  document.getElementById('formWorkflowNodePopoverTitle').textContent = meta.label + ' step';
  document.getElementById('formWorkflowNodeLabelInput').value = node.label || '';
  document.getElementById('formWorkflowNodeLabelInput').disabled = formWorkflowEditorState.readOnly;

  var isAuthor = node.type === 'author', isApproval = node.type === 'approval', isAction = node.type === 'action';
  document.getElementById('formWorkflowAuthorGatesSection').classList.toggle('hidden', !isAuthor);
  document.getElementById('formWorkflowApprovalGatesSection').classList.toggle('hidden', !isApproval);
  document.getElementById('formWorkflowActionSection').classList.toggle('hidden', !isAction);

  if(isAuthor) renderGateEditorSection('author', node.authorGates);
  if(isApproval){
    document.getElementById('formWorkflowApprovalModeSelect').value = node.approvalMode === 'all' ? 'all' : 'any';
    document.getElementById('formWorkflowApprovalModeSelect').disabled = formWorkflowEditorState.readOnly;
    renderGateEditorSection('approval', node.approverGates);
  }
  if(isAction) renderActionSection(node);

  document.getElementById('formWorkflowNodeDeleteBtn').classList.toggle('hidden', formWorkflowEditorState.readOnly);
  document.getElementById('formWorkflowNodeSaveBtn').classList.toggle('hidden', formWorkflowEditorState.readOnly);

  var popover = document.getElementById('formWorkflowNodePopover');
  popover.classList.remove('hidden');
  var popW = popover.offsetWidth || 300;
  var left = Math.max(8, Math.min(clientX, window.innerWidth - popW - 12));
  var top = Math.min(clientY, window.innerHeight - 12);
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}

var GATE_SECTION_IDS = {
  author: {list: 'formWorkflowAuthorGatesList', addWrap: 'formWorkflowAuthorGateAddWrap'},
  approval: {list: 'formWorkflowApprovalGatesList', addWrap: 'formWorkflowApprovalGateAddWrap'}
};

/* Re-renders BOTH the gate list and the add-row together on every open/add/remove — deliberately not
   a "just patch the list" partial update, so the add-row's own inputs (and their listeners) are
   always freshly created rather than re-wired onto elements that already have a listener from a
   previous render (the exact "each add doubles/triples the next add" class of bug the id-collision
   fix above was masking half of — re-wiring listeners onto persistent elements without removing the
   old ones is the other half). Matches modals/forms-admin.js's own wireOptionsEditor convention. */
function renderGateEditorSection(prefix, gatesArray){
  var ids = GATE_SECTION_IDS[prefix];
  document.getElementById(ids.list).innerHTML = renderGateListHTML(gatesArray);
  document.getElementById(ids.addWrap).innerHTML = formWorkflowEditorState.readOnly ? '' : renderGateAddRowHTML(prefix);
  if(formWorkflowEditorState.readOnly) return;

  document.querySelectorAll('#' + ids.list + ' [data-remove-gate]').forEach(function(btn){
    btn.addEventListener('click', function(){
      gatesArray.splice(parseInt(btn.getAttribute('data-remove-gate'), 10), 1);
      renderGateEditorSection(prefix, gatesArray);
    });
  });
  var kindSelect = document.getElementById('formWorkflowGateKindSelect-' + prefix);
  var userTypeSelect = document.getElementById('formWorkflowGateUserTypeSelect-' + prefix);
  var namedUserSelect = document.getElementById('formWorkflowGateNamedUserSelect-' + prefix);
  var addBtn = document.getElementById('formWorkflowGateAddBtn-' + prefix);
  kindSelect.addEventListener('change', function(){
    var isNamed = kindSelect.value === 'namedUser';
    userTypeSelect.classList.toggle('hidden', isNamed);
    namedUserSelect.classList.toggle('hidden', !isNamed);
  });
  addBtn.addEventListener('click', function(){
    var gate = kindSelect.value === 'namedUser'
      ? {kind: 'namedUser', value: namedUserSelect.value}
      : {kind: 'userType', value: userTypeSelect.value};
    if(gate.kind === 'namedUser' && !gate.value) return;
    var alreadyPresent = gatesArray.some(function(g){ return gateKey(g) === gateKey(gate); });
    if(!alreadyPresent) gatesArray.push(gate);
    renderGateEditorSection(prefix, gatesArray);
  });
}

/* Populates the Action section's three selects + title input from node.config every time the
   popover opens — no persistent listeners to worry about doubling (unlike renderGateEditorSection's
   add-row), since each select is just read from directly in saveFormWorkflowNodePopover rather than
   wired with its own change handler. */
function renderActionSection(node){
  var cfg = node.config || {};
  var portalSelect = document.getElementById('formWorkflowActionPortalSelect');
  portalSelect.innerHTML = '<option value="">Select a Portal…</option>' + formWorkflowEditorState.portals.map(function(p){
    return '<option value="' + escapeHTML(p.id) + '">' + escapeHTML(p.name) + '</option>';
  }).join('');
  portalSelect.value = cfg.portalId || '';
  portalSelect.disabled = formWorkflowEditorState.readOnly;

  document.getElementById('formWorkflowActionPrioritySelect').value = cfg.priorityColumn || 'medium';
  document.getElementById('formWorkflowActionPrioritySelect').disabled = formWorkflowEditorState.readOnly;

  var assigneeSelect = document.getElementById('formWorkflowActionAssigneeSelect');
  var userOptions = formWorkflowEditorState.orgUsers.map(function(u){
    return '<option value="' + escapeHTML(u.id) + '">' + escapeHTML(u.displayName) + '</option>';
  }).join('');
  assigneeSelect.innerHTML = '<option value="">Form\'s approver, if known</option>' + userOptions;
  assigneeSelect.value = (cfg.assigneeGate && cfg.assigneeGate.kind === 'namedUser') ? cfg.assigneeGate.value : '';
  assigneeSelect.disabled = formWorkflowEditorState.readOnly;

  document.getElementById('formWorkflowActionTitleInput').value = cfg.titleTemplate || '';
  document.getElementById('formWorkflowActionTitleInput').disabled = formWorkflowEditorState.readOnly;
}

export function closeFormWorkflowNodePopover(){
  document.getElementById('formWorkflowNodePopover').classList.add('hidden');
  formWorkflowEditorState.popoverNodeId = null;
}
export function isFormWorkflowNodePopoverOpen(){
  return !document.getElementById('formWorkflowNodePopover').classList.contains('hidden');
}
export function saveFormWorkflowNodePopover(){
  var node = findNode(formWorkflowEditorState.popoverNodeId);
  if(!node) return;
  node.label = document.getElementById('formWorkflowNodeLabelInput').value.trim() || (NODE_TYPE_META[node.type] || NODE_TYPE_META.start).label;
  if(node.type === 'approval') node.approvalMode = document.getElementById('formWorkflowApprovalModeSelect').value === 'all' ? 'all' : 'any';
  if(node.type === 'action'){
    var portalId = document.getElementById('formWorkflowActionPortalSelect').value || null;
    var assigneeUserId = document.getElementById('formWorkflowActionAssigneeSelect').value;
    node.config = {
      portalId: portalId,
      priorityColumn: document.getElementById('formWorkflowActionPrioritySelect').value,
      assigneeGate: assigneeUserId ? {kind: 'namedUser', value: assigneeUserId} : null,
      titleTemplate: document.getElementById('formWorkflowActionTitleInput').value.trim() || null
    };
  }
  closeFormWorkflowNodePopover();
  renderFormWorkflowEditor();
}
export function deleteFormWorkflowNodeFromPopover(){
  if(!formWorkflowEditorState.popoverNodeId) return;
  removeFormWorkflowNode(formWorkflowEditorState.popoverNodeId);
  closeFormWorkflowNodePopover();
  renderFormWorkflowEditor();
}

// ---- Edge popover (delete only — a Form Workflow edge has no type/condition to configure) ----

export function openFormWorkflowEdgePopover(edgeId, clientX, clientY){
  var edge = formWorkflowEditorState.workflow.edges.filter(function(e){ return e.id === edgeId; })[0];
  if(!edge) return;
  formWorkflowEditorState.popoverEdgeId = edgeId;
  var fromNode = findNode(edge.fromNodeId), toNode = findNode(edge.toNodeId);
  document.getElementById('formWorkflowEdgePopoverTitle').textContent =
    (fromNode ? (fromNode.label || NODE_TYPE_META[fromNode.type].label) : '?') + ' → ' + (toNode ? (toNode.label || NODE_TYPE_META[toNode.type].label) : '?');
  document.getElementById('formWorkflowEdgeDeleteBtn').classList.toggle('hidden', formWorkflowEditorState.readOnly);

  var popover = document.getElementById('formWorkflowEdgePopover');
  popover.classList.remove('hidden');
  var popW = popover.offsetWidth || 240;
  var left = Math.max(8, Math.min(clientX, window.innerWidth - popW - 12));
  var top = Math.min(clientY, window.innerHeight - 12);
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}
export function closeFormWorkflowEdgePopover(){
  document.getElementById('formWorkflowEdgePopover').classList.add('hidden');
  formWorkflowEditorState.popoverEdgeId = null;
}
export function isFormWorkflowEdgePopoverOpen(){
  return !document.getElementById('formWorkflowEdgePopover').classList.contains('hidden');
}
export function deleteFormWorkflowEdgeFromPopover(){
  if(!formWorkflowEditorState.popoverEdgeId) return;
  var workflow = formWorkflowEditorState.workflow;
  workflow.edges = workflow.edges.filter(function(e){ return e.id !== formWorkflowEditorState.popoverEdgeId; });
  closeFormWorkflowEdgePopover();
  renderFormWorkflowEditor();
}
