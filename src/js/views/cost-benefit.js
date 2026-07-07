"use strict";
import { getTasksArray, getColumn, getMemberById, getTaskTypeById } from '../utils.js';
import { getCurrentProject } from '../store.js';
import { ui } from '../ui.js';
import { getPriority } from '../ui.js';
import { PRIORITY_COLORS, PRIORITY_ORDER, TASK_SCORE_MIN, TASK_SCORE_MAX } from '../config.js';
import { iconSvg } from '../icons.js';
import { clampTaskScore } from '../date-utils.js';

function escapeHTML(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function iconHTML(name, size){ return '<span class="kf-icon">'+iconSvg(name,size)+'</span>'; }
function buildEl(tag, className, innerHTML){ var el = document.createElement(tag); if(className) el.className = className; if(innerHTML !== undefined) el.innerHTML = innerHTML; return el; }
var _toast = function(msg){ console.error(msg); };
var _openTaskModal = function(){};
export function setCostBenefitDeps(deps){
  if(deps.toast) _toast = deps.toast;
  if(deps.openTaskModal) _openTaskModal = deps.openTaskModal;
}

/* =========================================================
   COST/BENEFIT CHART
   Plots tasks on a Gartner-style quadrant chart: Task Cost on the
   x-axis, Business Value on the y-axis, split at the midpoint (500)
   of the shared 1-1000 scale used by both fields.
   ========================================================= */
export var CB_WIDTH = 880;
export var CB_HEIGHT = 680;
export var CB_MARGIN_LEFT = 76;
export var CB_MARGIN_RIGHT = 30;
export var CB_MARGIN_TOP = 44;
export var CB_MARGIN_BOTTOM = 64;
export var CB_SPLIT = 500;

export var cbZoomState = {scale: 1, panActive: false, panMoved: false, panStartX: 0, panStartY: 0, panStartScrollLeft: 0, panStartScrollTop: 0};
export var CB_MIN_ZOOM = 0.3;
export var CB_MAX_ZOOM = 2.5;

/* Marker size scales with priority: Trivial uses the base size, and
   each step up increases linearly so Critical ends up exactly 4x the
   base — Low/Medium/High fall at even intervals in between. */
export var CB_BASE_RADIUS = 7;
export var CB_PRIORITY_RADIUS_MULTIPLIER = {
  trivial: 1,
  low: 1.75,
  medium: 2.5,
  high: 3.25,
  critical: 4
};
export function cbRadiusForPriority(priority){
  var multiplier = CB_PRIORITY_RADIUS_MULTIPLIER.hasOwnProperty(priority) ? CB_PRIORITY_RADIUS_MULTIPLIER[priority] : CB_PRIORITY_RADIUS_MULTIPLIER.medium;
  return CB_BASE_RADIUS * multiplier;
}

export function cbScaleX(cost){
  var plotWidth = CB_WIDTH - CB_MARGIN_LEFT - CB_MARGIN_RIGHT;
  return CB_MARGIN_LEFT + (cost - TASK_SCORE_MIN) / (TASK_SCORE_MAX - TASK_SCORE_MIN) * plotWidth;
}
export function cbScaleY(value){
  var plotHeight = CB_HEIGHT - CB_MARGIN_TOP - CB_MARGIN_BOTTOM;
  return CB_MARGIN_TOP + plotHeight - (value - TASK_SCORE_MIN) / (TASK_SCORE_MAX - TASK_SCORE_MIN) * plotHeight;
}

function cbTaskVisible(t){
  return (!t.archived || ui.cbShowArchived) &&
    (ui.cbColumnFilter.size === 0 || ui.cbColumnFilter.has(t.columnId));
}

export function computeCostBenefitLayout(project){
  var tasks = getTasksArray(project).filter(cbTaskVisible);

  /* Tasks sharing the exact same (cost, value) point — very common
     since both default to 1 — are spread in a small ring around their
     shared point instead of stacking exactly on top of each other.
     The ring radius is sized to the largest marker in the group so
     bigger (higher-priority) markers don't overlap their neighbors. */
  var groups = {};
  tasks.forEach(function(t){
    var cost = clampTaskScore(t.taskCost);
    var value = clampTaskScore(t.businessValue);
    var key = cost + '_' + value;
    if(!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  var points = [];
  Object.keys(groups).forEach(function(key){
    var group = groups[key].sort(function(a, b){ return a.key.localeCompare(b.key, undefined, {numeric:true}); });
    var cost = clampTaskScore(group[0].taskCost);
    var value = clampTaskScore(group[0].businessValue);
    var cx = cbScaleX(cost);
    var cy = cbScaleY(value);
    var maxRadius = Math.max.apply(null, group.map(function(t){ return cbRadiusForPriority(t.priority); }));
    var jitterRadius = group.length > 1 ? maxRadius * 1.3 : 0;
    group.forEach(function(t, i){
      var angle = group.length > 1 ? (2 * Math.PI * i / group.length) : 0;
      points.push({
        task: t,
        cost: cost,
        value: value,
        radius: cbRadiusForPriority(t.priority),
        x: cx + jitterRadius * Math.cos(angle),
        y: cy + jitterRadius * Math.sin(angle)
      });
    });
  });

  return {points: points};
}

export function renderCostBenefitChart(){
  var project = getCurrentProject();
  var inner = document.getElementById('costBenefitInner');
  var legend = document.getElementById('costBenefitLegend');
  document.getElementById('costBenefitTitle').textContent = 'Cost/Benefit Chart' + (project ? ' — ' + project.name : '');

  legend.innerHTML = PRIORITY_ORDER.map(function(key){
    var conf = getPriority(key);
    var dotSize = Math.round(8 * CB_PRIORITY_RADIUS_MULTIPLIER[key]);
    return '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:' + conf.accent + ';width:' + dotSize + 'px;height:' + dotSize + 'px;"></span>' + escapeHTML(conf.label) + '</span>';
  }).join('') +
  '<span class="kf-legend-item" style="color:var(--kf-text-faint);">Marker size = priority</span>' +
  '<span class="kf-legend-item" style="margin-left:auto;color:var(--kf-text-faint);">Quadrants split at the midpoint (500) of the 1–1000 scale</span>' +
  (ui.cbShowArchived ? '<span class="kf-legend-item">' + iconSvg('archive',12) + ' Archived task (greyed out)</span>' : '');

  var hasTasks = project && getTasksArray(project).some(cbTaskVisible);
  if(!hasTasks){
    inner.innerHTML = '';
    inner.appendChild(buildEl('div', 'kf-depmap-empty', iconHTML('inbox',36) + '<div>No tasks yet — set Business Value and Task Cost on a task to plot it here.</div>'));
    return;
  }

  var layout = computeCostBenefitLayout(project);
  var plotLeft = CB_MARGIN_LEFT, plotRight = CB_WIDTH - CB_MARGIN_RIGHT;
  var plotTop = CB_MARGIN_TOP, plotBottom = CB_HEIGHT - CB_MARGIN_BOTTOM;
  var splitX = cbScaleX(CB_SPLIT), splitY = cbScaleY(CB_SPLIT);

  var quadrantsHTML =
    '<rect x="' + plotLeft + '" y="' + plotTop + '" width="' + (splitX - plotLeft) + '" height="' + (splitY - plotTop) + '" fill="var(--kf-surface)"></rect>' +
    '<rect x="' + splitX + '" y="' + plotTop + '" width="' + (plotRight - splitX) + '" height="' + (splitY - plotTop) + '" fill="var(--kf-column-bg)"></rect>' +
    '<rect x="' + plotLeft + '" y="' + splitY + '" width="' + (splitX - plotLeft) + '" height="' + (plotBottom - splitY) + '" fill="var(--kf-column-bg)"></rect>' +
    '<rect x="' + splitX + '" y="' + splitY + '" width="' + (plotRight - splitX) + '" height="' + (plotBottom - splitY) + '" fill="var(--kf-surface)"></rect>';

  var labelPad = 10;
  var quadrantLabelsHTML =
    '<text x="' + (plotLeft + labelPad) + '" y="' + (plotTop + 18) + '" font-size="12" font-weight="700" letter-spacing="0.4" style="fill:var(--kf-text-faint);">QUICK WINS</text>' +
    '<text x="' + (plotRight - labelPad) + '" y="' + (plotTop + 18) + '" font-size="12" font-weight="700" letter-spacing="0.4" text-anchor="end" style="fill:var(--kf-text-faint);">MAJOR PROJECTS</text>' +
    '<text x="' + (plotLeft + labelPad) + '" y="' + (plotBottom - 10) + '" font-size="12" font-weight="700" letter-spacing="0.4" style="fill:var(--kf-text-faint);">FILL-INS</text>' +
    '<text x="' + (plotRight - labelPad) + '" y="' + (plotBottom - 10) + '" font-size="12" font-weight="700" letter-spacing="0.4" text-anchor="end" style="fill:var(--kf-text-faint);">REVIEW DEMAND</text>';

  var axesHTML =
    '<line x1="' + plotLeft + '" y1="' + plotTop + '" x2="' + plotLeft + '" y2="' + plotBottom + '" style="stroke:var(--kf-border-strong);" stroke-width="1.5"></line>' +
    '<line x1="' + plotLeft + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotBottom + '" style="stroke:var(--kf-border-strong);" stroke-width="1.5"></line>' +
    '<line x1="' + splitX + '" y1="' + plotTop + '" x2="' + splitX + '" y2="' + plotBottom + '" style="stroke:var(--kf-border);" stroke-width="1.5" stroke-dasharray="5,4"></line>' +
    '<line x1="' + plotLeft + '" y1="' + splitY + '" x2="' + plotRight + '" y2="' + splitY + '" style="stroke:var(--kf-border);" stroke-width="1.5" stroke-dasharray="5,4"></line>' +
    '<line x1="' + plotLeft + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotTop + '" style="stroke:var(--kf-border);" stroke-width="1.5" stroke-dasharray="5,4"></line>';

  var tickValues = [1, 250, 500, 750, 1000];
  var ticksHTML = tickValues.map(function(tickVal){
    var tx = cbScaleX(tickVal);
    var ty = cbScaleY(tickVal);
    return (
      '<line x1="' + tx + '" y1="' + plotBottom + '" x2="' + tx + '" y2="' + (plotBottom + 5) + '" style="stroke:var(--kf-border-strong);"></line>' +
      '<text x="' + tx + '" y="' + (plotBottom + 20) + '" font-size="11" text-anchor="middle" style="fill:var(--kf-text-faint);">' + tickVal + '</text>' +
      '<line x1="' + (plotLeft - 5) + '" y1="' + ty + '" x2="' + plotLeft + '" y2="' + ty + '" style="stroke:var(--kf-border-strong);"></line>' +
      '<text x="' + (plotLeft - 10) + '" y="' + (ty + 3) + '" font-size="11" text-anchor="end" style="fill:var(--kf-text-faint);">' + tickVal + '</text>'
    );
  }).join('');

  var axisMidX = (plotLeft + plotRight) / 2;
  var axisMidY = (plotTop + plotBottom) / 2;
  var axisTitlesHTML =
    '<text x="' + axisMidX + '" y="' + (CB_HEIGHT - 14) + '" font-size="13" font-weight="700" text-anchor="middle" style="fill:var(--kf-text-secondary);">Task Cost</text>' +
    '<text x="18" y="' + axisMidY + '" font-size="13" font-weight="700" text-anchor="middle" transform="rotate(-90, 18, ' + axisMidY + ')" style="fill:var(--kf-text-secondary);">Business Value</text>';

  var pointsHTML = layout.points.map(function(p){
    var t = p.task;
    var prio = getPriority(t.priority);
    var labelOffset = p.radius + 6;
    return (
      '<g class="kf-cb-point' + (t.archived ? ' kf-cb-point-archived' : '') + '" data-task-id="' + t.id + '">' +
        '<title>' + escapeHTML(t.key) + ' — ' + escapeHTML(t.title) + ' (Cost ' + p.cost + ', Value ' + p.value + ')' + (t.archived ? ' [Archived]' : '') + '</title>' +
        '<circle class="kf-cb-dot" cx="' + p.x + '" cy="' + p.y + '" r="' + p.radius + '" fill="' + prio.accent + '" style="stroke:var(--kf-surface);" stroke-width="1.5"></circle>' +
        '<text x="' + (p.x + labelOffset) + '" y="' + (p.y + 4) + '" font-size="10" font-weight="600" style="fill:var(--kf-text-secondary);">' + escapeHTML(t.key) + '</text>' +
      '</g>'
    );
  }).join('');

  inner.innerHTML =
    '<svg width="' + CB_WIDTH + '" height="' + CB_HEIGHT + '" viewBox="0 0 ' + CB_WIDTH + ' ' + CB_HEIGHT + '" xmlns="http://www.w3.org/2000/svg">' +
      quadrantsHTML + axesHTML + quadrantLabelsHTML + ticksHTML + axisTitlesHTML + pointsHTML +
    '</svg>';
  applyCbZoom();
}

export function applyCbZoom(){
  var svg = document.querySelector('#costBenefitInner svg');
  var label = document.getElementById('costBenefitZoomLabel');
  if(label) label.textContent = Math.round(cbZoomState.scale * 100) + '%';
  if(!svg) return;
  svg.setAttribute('width', Math.round(CB_WIDTH * cbZoomState.scale));
  svg.setAttribute('height', Math.round(CB_HEIGHT * cbZoomState.scale));
}

export function setCbZoom(delta){
  cbZoomState.scale = Math.max(CB_MIN_ZOOM, Math.min(CB_MAX_ZOOM, Math.round((cbZoomState.scale + delta) * 100) / 100));
  applyCbZoom();
}
export function resetCbZoom(){
  cbZoomState.scale = 1;
  applyCbZoom();
  var scroll = document.getElementById('costBenefitScroll');
  scroll.scrollLeft = 0;
  scroll.scrollTop = 0;
}

/* Zoom by `deltaScale`, keeping the point under (clientX, clientY) visually
   fixed — the standard "zoom toward the cursor" behavior for scroll-wheel
   zoom. Falls back to zooming around the viewport center if no cursor
   position is given (e.g. from the toolbar zoom buttons). */
export function zoomCbAtPoint(deltaScale, clientX, clientY){
  var scroll = document.getElementById('costBenefitScroll');
  if(!scroll) return;

  var oldScale = cbZoomState.scale;
  var newScale = Math.max(CB_MIN_ZOOM, Math.min(CB_MAX_ZOOM, Math.round((oldScale + deltaScale) * 100) / 100));
  if(newScale === oldScale) return;

  var rect = scroll.getBoundingClientRect();
  var offsetX = clientX != null ? clientX - rect.left : rect.width / 2;
  var offsetY = clientY != null ? clientY - rect.top : rect.height / 2;

  var oldWidth = CB_WIDTH * oldScale;
  var oldHeight = CB_HEIGHT * oldScale;
  var fracX = oldWidth > 0 ? (scroll.scrollLeft + offsetX) / oldWidth : 0;
  var fracY = oldHeight > 0 ? (scroll.scrollTop + offsetY) / oldHeight : 0;

  cbZoomState.scale = newScale;
  applyCbZoom();

  var newWidth = CB_WIDTH * newScale;
  var newHeight = CB_HEIGHT * newScale;
  scroll.scrollLeft = fracX * newWidth - offsetX;
  scroll.scrollTop = fracY * newHeight - offsetY;
}

export function updateCostBenefitArchiveToggleButton(){
  var btn = document.getElementById('costBenefitArchiveToggle');
  var label = document.getElementById('costBenefitArchiveToggleLabel');
  if(!btn) return;
  btn.classList.toggle('active', ui.cbShowArchived);
  label.textContent = ui.cbShowArchived ? 'Hide archived' : 'Show archived';
  btn.title = ui.cbShowArchived ? 'Hide archived tasks' : 'Show archived tasks';
}

export function toggleCostBenefitShowArchived(){
  ui.cbShowArchived = !ui.cbShowArchived;
  updateCostBenefitArchiveToggleButton();
  renderCostBenefitChart();
}

/* Column filter dropdown — mirrors the Assignee filter on the main
   board toolbar (see renderAssigneeFilterChips() in views/board.js):
   a button showing the current selection, a checkbox-list panel, and
   a "Clear selection" row once something is checked. */
export function renderCbColumnFilterPanel(){
  var project = getCurrentProject();
  var wrap = document.getElementById('costBenefitColumnFilterWrap');
  var panel = document.getElementById('costBenefitColumnFilterPanel');
  var label = document.getElementById('costBenefitColumnFilterLabel');
  if(!wrap || !project) return;

  var columns = project.columns || [];
  var n = ui.cbColumnFilter.size;
  if(n === 0){
    label.textContent = 'Column';
  } else if(n === 1){
    var onlyCol = getColumn(project, ui.cbColumnFilter.values().next().value);
    label.textContent = onlyCol ? onlyCol.name : 'Column';
  } else {
    label.textContent = n + ' columns';
  }
  wrap.classList.toggle('active', n > 0);

  panel.innerHTML = '';
  columns.forEach(function(c){
    var row = document.createElement('label');
    row.className = 'kf-dropdown-filter-row';
    var checked = ui.cbColumnFilter.has(c.id);
    row.innerHTML =
      '<input type="checkbox" ' + (checked ? 'checked' : '') + '>' +
      '<span class="kf-dot" style="background:' + (c.color || '#c1c7d0') + '"></span>' +
      '<span class="kf-dropdown-filter-name">' + escapeHTML(c.name) + '</span>';
    row.querySelector('input').addEventListener('change', function(e){
      if(e.target.checked) ui.cbColumnFilter.add(c.id);
      else ui.cbColumnFilter.delete(c.id);
      renderCbColumnFilterPanel();
      renderCostBenefitChart();
    });
    panel.appendChild(row);
  });

  if(n > 0){
    var divider = document.createElement('div');
    divider.className = 'kf-dropdown-filter-divider';
    panel.appendChild(divider);
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'kf-dropdown-filter-clear';
    clearBtn.textContent = 'Clear selection';
    clearBtn.addEventListener('click', function(){
      ui.cbColumnFilter.clear();
      renderCbColumnFilterPanel();
      renderCostBenefitChart();
    });
    panel.appendChild(clearBtn);
  }
}
export function toggleCbColumnFilterPanel(){
  document.getElementById('costBenefitColumnFilterPanel').classList.toggle('hidden');
}
export function closeCbColumnFilterPanel(){
  document.getElementById('costBenefitColumnFilterPanel').classList.add('hidden');
}

export function openCostBenefitOverlay(){
  var project = getCurrentProject();
  if(!project){ _toast('No project selected.'); return; }
  cbZoomState.scale = 1;
  cbZoomState.panActive = false;
  cbZoomState.panMoved = false;
  updateCostBenefitArchiveToggleButton();
  renderCbColumnFilterPanel();
  renderCostBenefitChart();
  document.getElementById('costBenefitOverlay').classList.remove('hidden');
}
export function closeCostBenefitOverlay(){
  document.getElementById('costBenefitOverlay').classList.add('hidden');
  cbZoomState.panActive = false;
  cbZoomState.panMoved = false;
  document.getElementById('costBenefitScroll').classList.remove('kf-costbenefit-panning');
}
export function isCostBenefitOverlayOpen(){
  return !document.getElementById('costBenefitOverlay').classList.contains('hidden');
}
