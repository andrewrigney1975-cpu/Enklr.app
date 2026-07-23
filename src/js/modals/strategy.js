"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../utils.js';
import { iconSvg } from '../icons.js';
import { getCurrentProject } from '../store.js';
import { strategyApi, projectStrategyApi, portfolioApi, isOrgAdmin } from '../api.js';
import { confirmDialog } from './confirm.js';
import { buildRadarSvg } from '../views/strategy-radar.js';

/* Enterprise Strategy Management — Org-Admin-only definition/CRUD (Strategy -> Pillars -> Enablers/
   Metrics, plus metric-entry recording with a trend line) and a read-only view for regular project
   members, both sharing one overlay. The dashboard half (radar chart, mode toggle, project
   picker/overlay comparison) is fed by one shaped payload (StrategyFulfilmentMatrixDto) regardless
   of which of the three modes is active — see StrategyFulfilmentService's own doc comment. */

var _isAdmin = false;
var _project = null;
var _strategies = [];
var _selectedStrategyId = null;
var _tree = [];
var _matrix = null;
var _dashboardMode = 'project'; // 'project' | 'aggregate' | 'compare'
var _compareIds = [];
var _metricHistoryCache = {};

export function openStrategyOverlay(){
  _project = getCurrentProject();
  if(!_project){ toast('No project selected.'); return; }
  _isAdmin = isOrgAdmin();
  document.getElementById('strategyOverlay').classList.remove('hidden');
  document.getElementById('strategyManagePanel').classList.toggle('hidden', !_isAdmin);
  // Strategy on a Page is a cross-project, whole-org aggregate (like the Portfolio Dashboard) — only
  // ever reachable by an Org Admin, same as that feature.
  document.getElementById('strategyOnAPageBtn').classList.toggle('kf-vis-hidden', !_isAdmin);
  document.getElementById('strategyDefinitionList').innerHTML = '<div class="kf-health-empty">Loading…</div>';
  document.getElementById('strategyRadarInner').innerHTML = '<div class="kf-health-empty">Loading…</div>';
  loadAll();
}

export function closeStrategyOverlay(){
  document.getElementById('strategyOverlay').classList.add('hidden');
}

export function isStrategyOverlayOpen(){
  return !document.getElementById('strategyOverlay').classList.contains('hidden');
}

function loadAll(){
  if(_isAdmin){
    strategyApi.list().then(function(list){
      _strategies = list || [];
      var active = _strategies.filter(function(s){ return s.isActive; })[0];
      _selectedStrategyId = active ? active.id : (_strategies[0] ? _strategies[0].id : null);
      renderStrategySwitcher();
      loadTreeAndMatrix();
    }, function(){
      document.getElementById('strategyDefinitionList').innerHTML = '<div class="kf-health-empty">Could not load strategies.</div>';
    });
  } else {
    loadTreeAndMatrix();
  }
}

function loadTreeAndMatrix(){
  var treePromise = _isAdmin
    ? (_selectedStrategyId ? strategyApi.getTree(_selectedStrategyId) : Promise.resolve([]))
    : projectStrategyApi.getTree(_project.serverProjectId).catch(function(){ return []; });

  // Same "always fetch the full org list in compare mode" reasoning as loadTreeAndMatrixDashboardOnly.
  var matrixPromise = _dashboardMode === 'project' || !_isAdmin
    ? projectStrategyApi.getFulfilment(_project.serverProjectId).catch(function(){ return null; })
    : strategyApi.getFulfilmentMatrix(null).catch(function(){ return null; });

  Promise.all([treePromise, matrixPromise]).then(function(results){
    _tree = results[0] || [];
    _matrix = results[1];
    renderDefinitionTree();
    renderDashboard();
  });
}

// ---------------- Strategy switcher (OrgAdmin only) ----------------

function renderStrategySwitcher(){
  var wrap = document.getElementById('strategySwitcherWrap');
  if(!_isAdmin){ wrap.innerHTML = ''; return; }
  var options = _strategies.slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; }).map(function(s){
    return '<option value="' + s.id + '"' + (s.id === _selectedStrategyId ? ' selected' : '') + '>' + escapeHTML(s.name) + (s.isActive ? ' (Active)' : '') + '</option>';
  }).join('');
  var current = _strategies.filter(function(s){ return s.id === _selectedStrategyId; })[0];
  wrap.innerHTML =
    '<select id="strategySwitcherSelect" class="kf-strategy-switcher-select" aria-label="Select strategy">' + (options || '<option value="">No strategies yet</option>') + '</select>' +
    '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" id="strategyNewBtn">New</button>' +
    (current && !current.isActive ? '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" id="strategyActivateBtn">Activate</button>' : '') +
    (current ? '<button type="button" class="kf-btn kf-btn-ghost" id="strategyDeleteBtn" title="Delete this strategy">' + iconSvg('trash', 14) + '</button>' : '');

  var select = document.getElementById('strategySwitcherSelect');
  if(select) select.addEventListener('change', function(){
    _selectedStrategyId = select.value || null;
    loadTreeAndMatrix();
  });
  var newBtn = document.getElementById('strategyNewBtn');
  if(newBtn) newBtn.addEventListener('click', function(){
    var name = window.prompt('New strategy name:', 'FY' + (new Date().getFullYear()) + ' Strategy');
    if(name === null) return;
    strategyApi.create(name.trim() || 'Untitled Strategy').then(function(created){
      _strategies.push(created);
      _selectedStrategyId = created.id;
      renderStrategySwitcher();
      loadTreeAndMatrix();
    }, function(){ toast('Could not create strategy.'); });
  });
  var activateBtn = document.getElementById('strategyActivateBtn');
  if(activateBtn) activateBtn.addEventListener('click', function(){
    strategyApi.activate(_selectedStrategyId).then(function(){
      _strategies = _strategies.map(function(s){ return Object.assign({}, s, {isActive: s.id === _selectedStrategyId}); });
      renderStrategySwitcher();
      loadTreeAndMatrix();
      toast('Strategy activated.');
    }, function(){ toast('Could not activate strategy.'); });
  });
  var deleteBtn = document.getElementById('strategyDeleteBtn');
  if(deleteBtn) deleteBtn.addEventListener('click', function(){
    var s = _strategies.filter(function(x){ return x.id === _selectedStrategyId; })[0];
    if(!s) return;
    confirmDialog('Delete "' + s.name + '"?', 'This permanently deletes every Pillar, Enabler, Metric, and fulfilment value under this strategy. This cannot be undone.', function(){
      strategyApi.remove(s.id).then(function(){
        _strategies = _strategies.filter(function(x){ return x.id !== s.id; });
        _selectedStrategyId = _strategies[0] ? _strategies[0].id : null;
        renderStrategySwitcher();
        loadTreeAndMatrix();
      }, function(){ toast('Could not delete strategy.'); });
    });
  });
}

// ---------------- Definition tree (Pillars -> Enablers/Metrics) ----------------

function renderDefinitionTree(){
  var listEl = document.getElementById('strategyDefinitionList');
  var addPillarRow = _isAdmin && _selectedStrategyId
    ? '<div class="kf-member-row"><input type="text" class="kf-member-name-input" id="strategyNewPillarInput" placeholder="New pillar name" maxlength="150"><button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" id="strategyAddPillarBtn">Add Pillar</button></div>'
    : '';

  if(_tree.length === 0){
    listEl.innerHTML = addPillarRow + '<div class="kf-health-empty">' + (_isAdmin ? 'No pillars defined yet. Add one above.' : 'No active strategy has been defined for this organisation yet.') + '</div>';
  } else {
    listEl.innerHTML = addPillarRow + _tree.slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; }).map(renderPillarBlock).join('');
  }

  var addPillarBtn = document.getElementById('strategyAddPillarBtn');
  if(addPillarBtn) addPillarBtn.addEventListener('click', function(){
    var input = document.getElementById('strategyNewPillarInput');
    var name = input.value.trim();
    if(!name){ toast('Please enter a pillar name.'); return; }
    strategyApi.createPillar(_selectedStrategyId, name, null).then(function(pillar){
      _tree.push(Object.assign({}, pillar, {metrics: [], enablers: []}));
      renderDefinitionTree();
    }, function(){ toast('Could not add pillar.'); });
  });

  wireDefinitionTreeEvents(listEl);
}

function renderMetricRow(m, ownerType, ownerId){
  var history = _metricHistoryCache[m.id];
  var trendHTML = '';
  if(history && history.length > 0){
    trendHTML = buildMetricTrendSvg(history, m.targetValue);
  }
  return '<div class="kf-strategy-metric-row" data-metric-id="' + m.id + '">' +
    '<div class="kf-strategy-metric-header">' +
      (_isAdmin
        ? '<input type="text" class="kf-member-name-input kf-strategy-metric-name-input" value="' + escapeHTML(m.name) + '" maxlength="150" aria-label="Metric name">' +
          '<input type="text" class="kf-strategy-metric-unit-input" value="' + escapeHTML(m.unitLabel || '') + '" maxlength="20" placeholder="unit" aria-label="Unit label">' +
          '<input type="number" class="kf-strategy-metric-target-input" value="' + (m.targetValue != null ? m.targetValue : '') + '" placeholder="target" aria-label="Target value">' +
          '<button class="kf-btn kf-btn-ghost" data-action="delete-metric" title="Delete metric">' + iconSvg('trash', 13) + '</button>'
        : '<span class="kf-strategy-metric-name">' + escapeHTML(m.name) + (m.unitLabel ? ' (' + escapeHTML(m.unitLabel) + ')' : '') + (m.targetValue != null ? ' — target ' + m.targetValue : '') + '</span>') +
    '</div>' +
    '<div class="kf-strategy-metric-entry-row">' +
      (_isAdmin
        ? '<input type="number" class="kf-strategy-metric-value-input" placeholder="Value" aria-label="New value">' +
          '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-action="record-metric">Record</button>'
        : '') +
      '<button type="button" class="kf-strategy-metric-history-toggle" data-action="toggle-history">' + (history ? 'Hide history' : 'Show history') + '</button>' +
    '</div>' +
    (history ? '<div class="kf-strategy-metric-trend">' + trendHTML + '</div>' : '') +
  '</div>';
}

function renderPillarBlock(p){
  var metricsHTML = (p.metrics || []).slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; }).map(function(m){ return renderMetricRow(m, 'pillar', p.id); }).join('');
  var enablersHTML = (p.enablers || []).slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; }).map(function(en){
    var enMetricsHTML = (en.metrics || []).slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; }).map(function(m){ return renderMetricRow(m, 'enabler', en.id); }).join('');
    return '<div class="kf-strategy-enabler" data-enabler-id="' + en.id + '">' +
      '<div class="kf-member-row">' +
        (_isAdmin
          ? '<input type="text" class="kf-member-name-input kf-strategy-enabler-name-input" value="' + escapeHTML(en.name) + '" maxlength="150" aria-label="Enabler name">' +
            '<button class="kf-btn kf-btn-ghost" data-action="delete-enabler" title="Delete enabler">' + iconSvg('trash', 13) + '</button>'
          : '<span class="kf-strategy-enabler-name">' + iconSvg('link', 13) + escapeHTML(en.name) + '</span>') +
      '</div>' +
      (en.description ? '<div class="kf-strategy-description">' + escapeHTML(en.description) + '</div>' : '') +
      enMetricsHTML +
      (_isAdmin ? '<div class="kf-member-row"><input type="text" class="kf-member-name-input kf-strategy-new-metric-input" placeholder="New metric name" maxlength="150"><button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-action="add-metric-to-enabler">Add Metric</button></div>' : '') +
    '</div>';
  }).join('');

  return '<div class="kf-strategy-pillar" data-pillar-id="' + p.id + '">' +
    '<div class="kf-member-row kf-strategy-pillar-header">' +
      (_isAdmin
        ? '<input type="text" class="kf-member-name-input kf-strategy-pillar-name-input" value="' + escapeHTML(p.name) + '" maxlength="150" aria-label="Pillar name">' +
          '<button class="kf-btn kf-btn-ghost" data-action="delete-pillar" title="Delete pillar">' + iconSvg('trash', 14) + '</button>'
        : '<span class="kf-strategy-pillar-name">' + iconSvg('strategyCompass', 15) + escapeHTML(p.name) + '</span>') +
    '</div>' +
    (p.description ? '<div class="kf-strategy-description">' + escapeHTML(p.description) + '</div>' : '') +
    metricsHTML +
    (_isAdmin
      ? '<div class="kf-strategy-pillar-actions">' +
          '<div class="kf-member-row"><input type="text" class="kf-member-name-input kf-strategy-new-metric-input" placeholder="New metric name" maxlength="150"><button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-action="add-metric-to-pillar">Add Metric</button></div>' +
          '<div class="kf-member-row"><input type="text" class="kf-member-name-input kf-strategy-new-enabler-input" placeholder="New enabler name" maxlength="150"><button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-action="add-enabler">Add Enabler</button></div>' +
        '</div>'
      : '') +
    enablersHTML +
  '</div>';
}

function buildMetricTrendSvg(history, targetValue){
  var w = 240, h = 48, pad = 4;
  var values = history.map(function(e){ return e.value; });
  if(targetValue != null) values = values.concat([targetValue]);
  var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
  if(min === max){ min -= 1; max += 1; }
  var points = history.map(function(e, i){
    var x = pad + (i / Math.max(1, history.length - 1)) * (w - pad * 2);
    var y = h - pad - ((e.value - min) / (max - min)) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  var targetLine = targetValue != null
    ? '<line x1="' + pad + '" y1="' + (h - pad - ((targetValue - min) / (max - min)) * (h - pad * 2)).toFixed(1) + '" x2="' + (w - pad) + '" y2="' + (h - pad - ((targetValue - min) / (max - min)) * (h - pad * 2)).toFixed(1) + '" class="kf-strategy-trend-target" />'
    : '';
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" class="kf-strategy-trend-svg">' + targetLine +
    '<polyline points="' + points + '" class="kf-strategy-trend-line" fill="none" />' +
  '</svg>';
}

function wireDefinitionTreeEvents(listEl){
  listEl.querySelectorAll('[data-action="delete-pillar"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var pillarId = btn.closest('[data-pillar-id]').getAttribute('data-pillar-id');
      confirmDialog('Delete this pillar?', 'Its enablers, metrics, and fulfilment values will all be deleted too.', function(){
        strategyApi.deletePillar(pillarId).then(function(){
          _tree = _tree.filter(function(p){ return p.id !== pillarId; });
          renderDefinitionTree();
          renderDashboard();
        }, function(){ toast('Could not delete pillar.'); });
      });
    });
  });
  listEl.querySelectorAll('.kf-strategy-pillar-name-input').forEach(function(input){
    input.addEventListener('change', function(){
      var p = findPillar(input.closest('[data-pillar-id]').getAttribute('data-pillar-id'));
      if(!p) return;
      var name = input.value.trim() || p.name;
      strategyApi.updatePillar(p.id, name, p.description, p.sortOrder).then(function(updated){
        p.name = updated.name;
        renderDashboard();
      }, function(){ toast('Could not rename pillar.'); });
    });
  });
  listEl.querySelectorAll('[data-action="add-enabler"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var pillarEl = btn.closest('[data-pillar-id]');
      var pillarId = pillarEl.getAttribute('data-pillar-id');
      var input = pillarEl.querySelector('.kf-strategy-new-enabler-input');
      var name = input.value.trim();
      if(!name){ toast('Please enter an enabler name.'); return; }
      strategyApi.createEnabler(pillarId, name, null).then(function(enabler){
        var p = findPillar(pillarId);
        p.enablers = (p.enablers || []).concat([Object.assign({}, enabler, {metrics: []})]);
        renderDefinitionTree();
      }, function(){ toast('Could not add enabler.'); });
    });
  });
  listEl.querySelectorAll('[data-action="delete-enabler"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var enablerId = btn.closest('[data-enabler-id]').getAttribute('data-enabler-id');
      confirmDialog('Delete this enabler?', 'Its metrics will be deleted too.', function(){
        strategyApi.deleteEnabler(enablerId).then(function(){
          _tree.forEach(function(p){ p.enablers = (p.enablers || []).filter(function(en){ return en.id !== enablerId; }); });
          renderDefinitionTree();
        }, function(){ toast('Could not delete enabler.'); });
      });
    });
  });
  listEl.querySelectorAll('.kf-strategy-enabler-name-input').forEach(function(input){
    input.addEventListener('change', function(){
      var enablerId = input.closest('[data-enabler-id]').getAttribute('data-enabler-id');
      var en = findEnabler(enablerId);
      if(!en) return;
      var name = input.value.trim() || en.name;
      strategyApi.updateEnabler(enablerId, name, en.description, en.sortOrder).then(function(updated){
        en.name = updated.name;
      }, function(){ toast('Could not rename enabler.'); });
    });
  });
  listEl.querySelectorAll('[data-action="add-metric-to-pillar"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var pillarEl = btn.closest('[data-pillar-id]');
      var pillarId = pillarEl.getAttribute('data-pillar-id');
      var input = pillarEl.querySelector('.kf-strategy-pillar-actions .kf-strategy-new-metric-input');
      var name = input.value.trim();
      if(!name){ toast('Please enter a metric name.'); return; }
      strategyApi.createMetricOnPillar(pillarId, name, null, null).then(function(metric){
        var p = findPillar(pillarId);
        p.metrics = (p.metrics || []).concat([metric]);
        renderDefinitionTree();
      }, function(){ toast('Could not add metric.'); });
    });
  });
  listEl.querySelectorAll('[data-action="add-metric-to-enabler"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var enablerEl = btn.closest('[data-enabler-id]');
      var enablerId = enablerEl.getAttribute('data-enabler-id');
      var input = enablerEl.querySelector('.kf-strategy-new-metric-input');
      var name = input.value.trim();
      if(!name){ toast('Please enter a metric name.'); return; }
      strategyApi.createMetricOnEnabler(enablerId, name, null, null).then(function(metric){
        var en = findEnabler(enablerId);
        en.metrics = (en.metrics || []).concat([metric]);
        renderDefinitionTree();
      }, function(){ toast('Could not add metric.'); });
    });
  });
  listEl.querySelectorAll('.kf-strategy-metric-name-input, .kf-strategy-metric-unit-input, .kf-strategy-metric-target-input').forEach(function(input){
    input.addEventListener('change', function(){
      var row = input.closest('[data-metric-id]');
      var metricId = row.getAttribute('data-metric-id');
      var m = findMetric(metricId);
      if(!m) return;
      var name = row.querySelector('.kf-strategy-metric-name-input').value.trim() || m.name;
      var unitLabel = row.querySelector('.kf-strategy-metric-unit-input').value.trim();
      var targetRaw = row.querySelector('.kf-strategy-metric-target-input').value;
      var targetValue = targetRaw === '' ? null : Number(targetRaw);
      strategyApi.updateMetric(metricId, name, targetValue, unitLabel, m.sortOrder).then(function(updated){
        m.name = updated.name; m.unitLabel = updated.unitLabel; m.targetValue = updated.targetValue;
      }, function(){ toast('Could not update metric.'); });
    });
  });
  listEl.querySelectorAll('[data-action="delete-metric"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var metricId = btn.closest('[data-metric-id]').getAttribute('data-metric-id');
      confirmDialog('Delete this metric?', 'Its recorded history will be deleted too.', function(){
        strategyApi.deleteMetric(metricId).then(function(){
          _tree.forEach(function(p){
            p.metrics = (p.metrics || []).filter(function(m){ return m.id !== metricId; });
            (p.enablers || []).forEach(function(en){ en.metrics = (en.metrics || []).filter(function(m){ return m.id !== metricId; }); });
          });
          delete _metricHistoryCache[metricId];
          renderDefinitionTree();
        }, function(){ toast('Could not delete metric.'); });
      });
    });
  });
  listEl.querySelectorAll('[data-action="record-metric"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var row = btn.closest('[data-metric-id]');
      var metricId = row.getAttribute('data-metric-id');
      var valueInput = row.querySelector('.kf-strategy-metric-value-input');
      var value = Number(valueInput.value);
      if(!isFinite(value)){ toast('Please enter a numeric value.'); return; }
      strategyApi.recordMetricEntry(metricId, value, null).then(function(){
        valueInput.value = '';
        delete _metricHistoryCache[metricId];
        loadMetricHistory(metricId, row);
        toast('Recorded.');
      }, function(){ toast('Could not record value.'); });
    });
  });
  listEl.querySelectorAll('[data-action="toggle-history"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var row = btn.closest('[data-metric-id]');
      var metricId = row.getAttribute('data-metric-id');
      if(_metricHistoryCache[metricId]){
        delete _metricHistoryCache[metricId];
        renderDefinitionTree();
      } else {
        loadMetricHistory(metricId, row);
      }
    });
  });
}

function loadMetricHistory(metricId, row){
  var historyPromise = _isAdmin ? strategyApi.getMetricHistory(metricId) : projectStrategyApi.getMetricHistory(_project.serverProjectId, metricId);
  historyPromise.then(function(history){
    _metricHistoryCache[metricId] = history || [];
    renderDefinitionTree();
  }, function(){ toast('Could not load metric history.'); });
}

function findPillar(pillarId){ return _tree.filter(function(p){ return p.id === pillarId; })[0]; }
function findEnabler(enablerId){
  for(var i = 0; i < _tree.length; i++){
    var found = (_tree[i].enablers || []).filter(function(en){ return en.id === enablerId; })[0];
    if(found) return found;
  }
  return null;
}
function findMetric(metricId){
  for(var i = 0; i < _tree.length; i++){
    var p = _tree[i];
    var direct = (p.metrics || []).filter(function(m){ return m.id === metricId; })[0];
    if(direct) return direct;
    for(var j = 0; j < (p.enablers || []).length; j++){
      var viaEnabler = (p.enablers[j].metrics || []).filter(function(m){ return m.id === metricId; })[0];
      if(viaEnabler) return viaEnabler;
    }
  }
  return null;
}

// ---------------- Dashboard (radar + mode toggle) ----------------

export function setStrategyDashboardMode(mode){
  _dashboardMode = mode;
  if(mode === 'compare' && _compareIds.length === 0 && _matrix && _matrix.projects.length > 0){
    _compareIds = _matrix.projects.slice(0, Math.min(2, _matrix.projects.length)).map(function(p){ return p.projectId; });
  }
  loadTreeAndMatrixDashboardOnly();
}

function loadTreeAndMatrixDashboardOnly(){
  // Compare mode deliberately fetches the FULL org project list (projectIds omitted), not just
  // _compareIds — the picker's checkboxes are built from _matrix.projects, so scoping the fetch to
  // only the already-selected ids would make every other project permanently unpickable. Series
  // rendering below filters client-side to _compareIds instead.
  var matrixPromise = _dashboardMode === 'project' || !_isAdmin
    ? projectStrategyApi.getFulfilment(_project.serverProjectId).catch(function(){ return null; })
    : strategyApi.getFulfilmentMatrix(null).catch(function(){ return null; });
  matrixPromise.then(function(matrix){
    _matrix = matrix;
    renderDashboard();
  });
}

export function onStrategyCompareProjectToggle(projectId, checked){
  if(checked){
    if(_compareIds.length >= 4){ toast('You can compare up to 4 projects at once.'); return; }
    _compareIds.push(projectId);
  } else {
    _compareIds = _compareIds.filter(function(id){ return id !== projectId; });
  }
  loadTreeAndMatrixDashboardOnly();
}

function renderDashboard(){
  document.querySelectorAll('.kf-strategy-mode-btn').forEach(function(btn){
    btn.classList.toggle('kf-strategy-mode-active', btn.getAttribute('data-mode') === _dashboardMode);
  });
  document.getElementById('strategyModeToggleWrap').classList.toggle('hidden', !_isAdmin);
  var pickerEl = document.getElementById('strategyComparePickerWrap');

  var radarEl = document.getElementById('strategyRadarInner');
  if(!_matrix || !_matrix.activeStrategy || _matrix.pillars.length === 0){
    radarEl.innerHTML = '<div class="kf-health-empty">No active strategy with pillars to chart yet.</div>';
    pickerEl.innerHTML = '';
    pickerEl.classList.add('hidden');
    return;
  }

  var pillars = _matrix.pillars;
  var series = [];
  if(_dashboardMode === 'aggregate' && _isAdmin){
    series = [{label: 'Portfolio average', values: _matrix.aggregate}];
    pickerEl.classList.add('hidden');
    pickerEl.innerHTML = '';
  } else if(_dashboardMode === 'compare' && _isAdmin){
    series = _matrix.projects.filter(function(p){ return _compareIds.indexOf(p.projectId) !== -1; })
      .map(function(p){ return {label: p.projectKey + ' — ' + p.projectName, values: p.fulfilment}; });
    pickerEl.classList.remove('hidden');
    pickerEl.innerHTML = renderComparePicker();
    wireComparePicker(pickerEl);
  } else {
    var proj = _matrix.projects[0];
    series = proj ? [{label: proj.projectKey + ' — ' + proj.projectName, values: proj.fulfilment}] : [];
    pickerEl.classList.add('hidden');
    pickerEl.innerHTML = '';
  }

  radarEl.innerHTML = series.length > 0
    ? buildRadarSvg(pillars, series, {size: 440})
    : '<div class="kf-health-empty">No fulfilment values set for this project yet.</div>';
}

function renderComparePicker(){
  var atLimit = _compareIds.length >= 4;
  return '<div class="kf-strategy-compare-picker">' + (_matrix.projects || []).map(function(p){
    var checked = _compareIds.indexOf(p.projectId) !== -1;
    // Once 4 are selected, every OTHER (unchecked) project becomes unselectable — its own checkbox
    // stays enabled so it can still be unchecked to free up a slot.
    var disabled = atLimit && !checked;
    return '<label class="kf-strategy-compare-item' + (disabled ? ' kf-strategy-compare-item-disabled' : '') + '"><input type="checkbox" data-project-id="' + p.projectId + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '> ' + escapeHTML(p.projectKey) + ' — ' + escapeHTML(p.projectName) + '</label>';
  }).join('') + '</div>';
}

function wireComparePicker(pickerEl){
  pickerEl.querySelectorAll('input[type="checkbox"]').forEach(function(cb){
    cb.addEventListener('change', function(){
      onStrategyCompareProjectToggle(cb.getAttribute('data-project-id'), cb.checked);
    });
  });
}
