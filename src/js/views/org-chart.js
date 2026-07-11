"use strict";
import { getTeamCommitteeById, getMemberById, escapeHTML } from '../utils.js';
import { getCurrentProject } from '../store.js';
import { TEAM_COMMITTEE_TYPES } from '../config.js';
import { iconSvg } from '../icons.js';
import { memberInitials } from '../date-utils.js';
import { ui } from '../ui.js';

function iconHTML(name, size){ return '<span class="kf-icon">'+iconSvg(name,size)+'</span>'; }

var _toast = function(msg){ console.error(msg); };
export function setOrgChartDeps(deps){
  if(deps.toast) _toast = deps.toast;
}

/* =========================================================
   SVG ORG CHART
   Renders project.teamsCommittees — already a single parentId
   tree mixing teams and committees — as a vertical, top-down
   org chart of just one type at a time. When a node's real
   parent doesn't match the selected type, it is skipped and
   the node is attached to the nearest ancestor that does match
   (or promoted to a root if none do), so switching the toggle
   never leaves a node dangling or hides it outright.
   ========================================================= */
export var orgChartState = {scale: 1, panActive: false, panMoved: false, panStartX: 0, panStartY: 0, panStartScrollLeft: 0, panStartScrollTop: 0};
export var ORGCHART_MIN_ZOOM = 0.3;
export var ORGCHART_MAX_ZOOM = 2.5;
export var lastOrgChartLayout = null;

export var ORGCHART_NODE_W = 180;
export var ORGCHART_NODE_H = 62;
export var ORGCHART_GAP_X = 30;
export var ORGCHART_GAP_Y = 56;
export var ORGCHART_MARGIN = 30;

export var ORGCHART_TYPE_ACCENT = {team: '#0c66e4', committee: '#6554c0'};

function getEffectiveParentId(node, filterType, tcMap){
  var current = node.parentId ? tcMap[node.parentId] : null;
  var guard = 0;
  while(current && current.type !== filterType && guard < 1000){
    current = current.parentId ? tcMap[current.parentId] : null;
    guard++;
  }
  return current ? current.id : null;
}

/* Builds a forest of {tc, children[]} for just the selected type,
   reattaching nodes past any filtered-out ancestors. */
export function buildOrgChartForest(project, filterType){
  var all = project.teamsCommittees || [];
  var tcMap = {};
  all.forEach(function(tc){ tcMap[tc.id] = tc; });
  var included = all.filter(function(tc){ return tc.type === filterType; });

  var byParent = {};
  included.forEach(function(tc){
    var key = getEffectiveParentId(tc, filterType, tcMap) || '__root__';
    if(!byParent[key]) byParent[key] = [];
    byParent[key].push(tc);
  });
  Object.keys(byParent).forEach(function(key){
    byParent[key].sort(function(a, b){ return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}); });
  });

  function buildNode(tc){
    return {tc: tc, children: (byParent[tc.id] || []).map(buildNode)};
  }
  return (byParent['__root__'] || []).map(buildNode);
}

/* Two-pass tree layout: leaves are placed left-to-right in DFS
   order, and each internal node is centered over the average x of
   its children — which, because leaves are assigned strictly
   increasing x within a subtree, never overlaps a sibling subtree. */
export function computeOrgChartLayout(project, filterType){
  var roots = buildOrgChartForest(project, filterType);
  var nodes = [];
  var edges = [];
  var positions = {};
  var leafCursor = 0;

  function place(n, depth){
    var y = ORGCHART_MARGIN + depth * (ORGCHART_NODE_H + ORGCHART_GAP_Y);
    var x;
    if(n.children.length === 0){
      x = ORGCHART_MARGIN + leafCursor * (ORGCHART_NODE_W + ORGCHART_GAP_X);
      leafCursor++;
    } else {
      var childXs = n.children.map(function(c){ return place(c, depth + 1); });
      x = childXs.reduce(function(a, b){ return a + b; }, 0) / childXs.length;
    }
    positions[n.tc.id] = {x: x, y: y};
    nodes.push({tc: n.tc, x: x, y: y, w: ORGCHART_NODE_W, h: ORGCHART_NODE_H});
    n.children.forEach(function(c){ edges.push({fromId: n.tc.id, toId: c.tc.id}); });
    return x;
  }
  roots.forEach(function(r){ place(r, 0); });

  var maxX = ORGCHART_MARGIN, maxY = ORGCHART_MARGIN;
  nodes.forEach(function(n){
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  });

  return {
    nodes: nodes,
    edges: edges,
    positions: positions,
    width: roots.length ? maxX + ORGCHART_MARGIN : ORGCHART_MARGIN * 2,
    height: roots.length ? maxY + ORGCHART_MARGIN : ORGCHART_MARGIN * 2
  };
}

export function renderOrgChart(){
  var project = getCurrentProject();
  var inner = document.getElementById('orgChartInner');
  var legend = document.getElementById('orgChartLegend');
  var filterType = ui.orgChartFilter;
  var typeLabel = TEAM_COMMITTEE_TYPES[filterType];
  document.getElementById('orgChartTitle').textContent = 'Org Chart' + (project ? ' — ' + project.name : '');

  legend.innerHTML =
    '<span class="kf-legend-item"><span class="kf-legend-swatch" style="background:' + ORGCHART_TYPE_ACCENT[filterType] + ';"></span>' + escapeHTML(typeLabel) + '</span>' +
    '<span class="kf-legend-item">' + iconSvg('team', 12) + ' Number of direct members</span>' +
    '<span class="kf-legend-item">Click a box to see its members</span>';

  var hasAny = project && (project.teamsCommittees || []).some(function(tc){ return tc.type === filterType; });
  if(!hasAny){
    inner.innerHTML = '<div class="kf-depmap-empty">' + iconHTML('inbox', 36) + '<div>No ' + escapeHTML(typeLabel.toLowerCase()) + 's yet — add some in Teams &amp; Committees to see them here.</div></div>';
    lastOrgChartLayout = null;
    return;
  }

  var layout = computeOrgChartLayout(project, filterType);
  lastOrgChartLayout = layout;
  var accent = ORGCHART_TYPE_ACCENT[filterType];

  var edgesHTML = layout.edges.map(function(e){
    var fromPos = layout.positions[e.fromId], toPos = layout.positions[e.toId];
    if(!fromPos || !toPos) return '';
    var px = fromPos.x + ORGCHART_NODE_W / 2, py = fromPos.y + ORGCHART_NODE_H;
    var cx = toPos.x + ORGCHART_NODE_W / 2, cy = toPos.y;
    var midY = py + ORGCHART_GAP_Y / 2;
    var path = 'M ' + px + ' ' + py + ' L ' + px + ' ' + midY + ' L ' + cx + ' ' + midY + ' L ' + cx + ' ' + cy;
    return '<path class="kf-org-edge" d="' + path + '" fill="none" stroke="var(--kf-border-strong)" stroke-width="2"></path>';
  }).join('');

  var nodesHTML = layout.nodes.map(function(n){
    var tc = n.tc;
    var members = tc.memberIds || [];
    var name = tc.name.length > 22 ? tc.name.slice(0, 21) + '…' : tc.name;
    return (
      '<g class="kf-orgnode" data-tc-id="' + tc.id + '" transform="translate(' + n.x + ',' + n.y + ')">' +
        '<rect class="kf-orgnode-box" x="0" y="0" width="' + n.w + '" height="' + n.h + '" rx="6" style="fill:var(--kf-surface);stroke:var(--kf-border);" stroke-width="1.5"></rect>' +
        '<rect x="0" y="0" width="5" height="' + n.h + '" rx="2" fill="' + accent + '"></rect>' +
        '<text x="16" y="18" font-size="10" font-weight="700" style="fill:var(--kf-text-faint);">' + escapeHTML(tc.key) + '</text>' +
        '<text x="16" y="36" font-size="13" font-weight="600" style="fill:var(--kf-text);"><title>' + escapeHTML(tc.name) + '</title>' + escapeHTML(name) + '</text>' +
        '<g transform="translate(16,' + (n.h - 16) + ')" style="color:var(--kf-text-faint);">' + iconSvg('team', 13) + '</g>' +
        '<text x="34" y="' + (n.h - 5) + '" font-size="11" font-weight="600" style="fill:var(--kf-text-faint);">' + members.length + '</text>' +
      '</g>'
    );
  }).join('');

  var svgHTML =
    '<svg width="' + layout.width + '" height="' + layout.height + '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" xmlns="http://www.w3.org/2000/svg">' +
      edgesHTML + nodesHTML +
    '</svg>';

  inner.innerHTML = svgHTML;
  applyOrgChartZoom();
}

export function applyOrgChartZoom(){
  var svg = document.querySelector('#orgChartInner svg');
  document.getElementById('orgChartZoomLabel').textContent = Math.round(orgChartState.scale * 100) + '%';
  if(!svg || !lastOrgChartLayout) return;
  svg.setAttribute('width', Math.round(lastOrgChartLayout.width * orgChartState.scale));
  svg.setAttribute('height', Math.round(lastOrgChartLayout.height * orgChartState.scale));
}

export function setOrgChartZoom(delta){
  orgChartState.scale = Math.max(ORGCHART_MIN_ZOOM, Math.min(ORGCHART_MAX_ZOOM, Math.round((orgChartState.scale + delta) * 100) / 100));
  applyOrgChartZoom();
}
export function resetOrgChartZoom(){
  orgChartState.scale = 1;
  applyOrgChartZoom();
  var scroll = document.getElementById('orgChartScroll');
  scroll.scrollLeft = 0;
  scroll.scrollTop = 0;
}

export function zoomOrgChartAtPoint(deltaScale, clientX, clientY){
  if(!lastOrgChartLayout) return;
  var scroll = document.getElementById('orgChartScroll');
  if(!scroll) return;

  var oldScale = orgChartState.scale;
  var newScale = Math.max(ORGCHART_MIN_ZOOM, Math.min(ORGCHART_MAX_ZOOM, Math.round((oldScale + deltaScale) * 100) / 100));
  if(newScale === oldScale) return;

  var rect = scroll.getBoundingClientRect();
  var offsetX = clientX != null ? clientX - rect.left : rect.width / 2;
  var offsetY = clientY != null ? clientY - rect.top : rect.height / 2;

  var oldWidth = lastOrgChartLayout.width * oldScale;
  var oldHeight = lastOrgChartLayout.height * oldScale;
  var fracX = oldWidth > 0 ? (scroll.scrollLeft + offsetX) / oldWidth : 0;
  var fracY = oldHeight > 0 ? (scroll.scrollTop + offsetY) / oldHeight : 0;

  orgChartState.scale = newScale;
  applyOrgChartZoom();

  var newWidth = lastOrgChartLayout.width * newScale;
  var newHeight = lastOrgChartLayout.height * newScale;
  scroll.scrollLeft = fracX * newWidth - offsetX;
  scroll.scrollTop = fracY * newHeight - offsetY;
}

export function updateOrgChartFilterToggleButton(){
  var btn = document.getElementById('orgChartFilterToggle');
  var label = document.getElementById('orgChartFilterToggleLabel');
  if(!btn) return;
  var showingCommittees = ui.orgChartFilter === 'committee';
  btn.classList.toggle('active', showingCommittees);
  label.textContent = showingCommittees ? 'Showing: Committees' : 'Showing: Teams';
  btn.title = showingCommittees ? 'Switch to Teams' : 'Switch to Committees';
}

export function toggleOrgChartFilter(){
  ui.orgChartFilter = ui.orgChartFilter === 'committee' ? 'team' : 'committee';
  closeOrgChartMemberPopover();
  updateOrgChartFilterToggleButton();
  renderOrgChart();
}

export function openOrgChartMemberPopover(tcId, anchorRect){
  var project = getCurrentProject();
  var tc = project && getTeamCommitteeById(project, tcId);
  if(!tc) return;

  var popover = document.getElementById('orgChartMemberPopover');
  var members = (tc.memberIds || []).map(function(id){ return getMemberById(project, id); }).filter(Boolean)
    .sort(function(a, b){ return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}); });

  document.getElementById('orgChartMemberPopoverTitle').innerHTML =
    escapeHTML(tc.name) + ' <span class="kf-decision-type-pill">' + escapeHTML(TEAM_COMMITTEE_TYPES[tc.type]) + '</span>';

  var listEl = document.getElementById('orgChartMemberPopoverList');
  listEl.innerHTML = members.length ? members.map(function(m){
    return '<div class="kf-tc-member-item"><span class="kf-avatar kf-avatar-sm" style="background:' + m.color + ';">' + escapeHTML(memberInitials(m.name)) + '</span>' + escapeHTML(m.name) + (m.role ? ' <span class="kf-health-top-member-role">' + escapeHTML(m.role) + '</span>' : '') + '</div>';
  }).join('') : '<div class="kf-tc-empty" style="padding:10px 0;">No direct members.</div>';

  popover.classList.remove('hidden');
  var popW = popover.offsetWidth || 240;
  var left = Math.min(anchorRect.left, window.innerWidth - popW - 12);
  left = Math.max(8, left);
  var top = anchorRect.bottom + 8;
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}

export function closeOrgChartMemberPopover(){
  document.getElementById('orgChartMemberPopover').classList.add('hidden');
}
export function isOrgChartMemberPopoverOpen(){
  return !document.getElementById('orgChartMemberPopover').classList.contains('hidden');
}

export function openOrgChartOverlay(){
  var project = getCurrentProject();
  if(!project){ _toast('No project selected.'); return; }
  orgChartState.scale = 1;
  orgChartState.panActive = false;
  orgChartState.panMoved = false;
  closeOrgChartMemberPopover();
  updateOrgChartFilterToggleButton();
  renderOrgChart();
  document.getElementById('orgChartOverlay').classList.remove('hidden');
}
export function closeOrgChartOverlay(){
  document.getElementById('orgChartOverlay').classList.add('hidden');
  orgChartState.panActive = false;
  orgChartState.panMoved = false;
  closeOrgChartMemberPopover();
  document.getElementById('orgChartScroll').classList.remove('kf-depmap-panning');
}
export function isOrgChartOpen(){
  return !document.getElementById('orgChartOverlay').classList.contains('hidden');
}
