"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../views/board.js';
import { formsApi } from '../api.js';
import { confirmDialog } from './confirm.js';
import { FIELD_TYPES, defaultFieldConfig, fieldSummary, renderFieldTypeConfigHTML } from '../features/form-fields.js';
import { iconSvg, hydrateIcons } from '../icons.js';
import { uid } from '../storage.js';
import { parseFormWorkflow } from '../features/form-workflow-engine.js';
import { loadFormWorkflowGraph, getFormWorkflowGraph } from '../views/form-workflow-editor.js';
import { utcISOToLocalDisplayDate } from '../date-utils.js';

/* Enterprise Forms & Workflow — Org-Admin authoring UI. Phase 2 built the field builder; Phase 3
   (this pass) adds versioning on top of the same table/service: #formsAdminOverlay's picker now
   shows one row PER FORM GROUP (not per version — grouped client-side from the flat list the API
   still returns, see groupFormsByGroupId), and a new #formVersionHistoryOverlay lists every version
   of one group with per-version Edit/Publish/Delete actions plus a "New Version From Latest" clone
   action. #formFieldBuilderOverlay (one form VERSION's name/description + its FieldsJson array,
   edited entirely in-memory and written back in a single PUT on Save) and the smaller
   #formFieldEditorOverlay (add/edit one field within the builder) are unchanged from Phase 2. */

var _toast = toast;

var adminForms = [];
var builderForm = null; // {id, formGroupId, name, description, versionNumber, status, fields: [...]}
var editingFieldId = null; // id of the field currently open in the field editor, or null when adding a brand-new one
var editingFieldDraft = null; // the in-progress field object the editor overlay is currently mutating
var historyFormGroupId = null;
var historyVersions = []; // FormVersionSummaryDto[] for historyFormGroupId, oldest-to-newest (server order)

// ---- Picker ----

export function openFormsAdminOverlay(){
  document.getElementById('formsAdminOverlay').classList.remove('hidden');
  hideFormsAdminCreateRow();
  loadAndRenderFormsAdminList();
}
export function closeFormsAdminOverlay(){
  document.getElementById('formsAdminOverlay').classList.add('hidden');
}

function loadAndRenderFormsAdminList(){
  formsApi.list().then(function(forms){
    adminForms = forms;
    renderFormsAdminList();
  }, function(e){
    _toast('Could not load forms: ' + (e.message || 'unknown error'));
  });
}

var STATUS_LABELS = {draft: 'Draft', published: 'Published', archived: 'Archived'};

/* Groups the flat version list the API returns into one entry per FormGroupId — {formGroupId,
   name, versions: [...] (all versions of this group), primary: (the version this group's row
   represents)}. Primary is whichever version a member would currently see (Published) if one
   exists, else the highest-numbered Draft (the one an admin is actively iterating on), else just
   the highest version number overall (an edge case: every version somehow archived). */
function groupFormsByGroupId(forms){
  var byGroup = {};
  forms.forEach(function(f){
    if(!byGroup[f.formGroupId]) byGroup[f.formGroupId] = [];
    byGroup[f.formGroupId].push(f);
  });
  return Object.keys(byGroup).map(function(groupId){
    var versions = byGroup[groupId].slice().sort(function(a, b){ return b.versionNumber - a.versionNumber; });
    var primary = versions.filter(function(v){ return v.status === 'published'; })[0]
      || versions.filter(function(v){ return v.status === 'draft'; })[0]
      || versions[0];
    return {formGroupId: groupId, name: primary.name, description: primary.description, versions: versions, primary: primary};
  }).sort(function(a, b){ return new Date(b.primary.dateLastModified) - new Date(a.primary.dateLastModified); });
}

function renderFormsAdminList(){
  var list = document.getElementById('formsAdminList');
  var groups = groupFormsByGroupId(adminForms);
  document.getElementById('formsAdminEmpty').classList.toggle('hidden', groups.length > 0);
  list.innerHTML = groups.map(function(g){
    var f = g.primary;
    return '<div class="kf-form-admin-row" data-form-group-id="' + g.formGroupId + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(g.name) + '</span>' +
        '<span class="kf-form-status-badge kf-form-status-' + f.status + '">' + (STATUS_LABELS[f.status] || f.status) + '</span>' +
        '<span class="kf-form-admin-row-version">v' + f.versionNumber + (g.versions.length > 1 ? ' • ' + g.versions.length + ' versions' : '') + '</span>' +
      '</div>' +
      (g.description ? '<div class="kf-form-admin-row-desc">' + escapeHTML(g.description) + '</div>' : '') +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-edit-form="' + f.id + '"><span class="kf-icon" data-icon="edit" data-size="13"></span>Edit</button>' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-view-versions="' + g.formGroupId + '"><span class="kf-icon" data-icon="clock" data-size="13"></span>Versions</button>' +
        (g.versions.length === 1 && f.status === 'draft' ? '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-delete-form="' + f.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Delete</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-edit-form]').forEach(function(btn){
    btn.addEventListener('click', function(){ openFormFieldBuilder(btn.getAttribute('data-edit-form')); });
  });
  list.querySelectorAll('[data-view-versions]').forEach(function(btn){
    btn.addEventListener('click', function(){ openFormVersionHistory(btn.getAttribute('data-view-versions'), findGroupName(btn.getAttribute('data-view-versions'))); });
  });
  list.querySelectorAll('[data-delete-form]').forEach(function(btn){
    btn.addEventListener('click', function(){ deleteFormFromAdmin(btn.getAttribute('data-delete-form')); });
  });
  hydrateIcons(list);
}

function findGroupName(formGroupId){
  var match = adminForms.filter(function(f){ return f.formGroupId === formGroupId; })[0];
  return match ? match.name : 'Form';
}

function deleteFormFromAdmin(formId){
  var form = adminForms.filter(function(f){ return f.id === formId; })[0];
  if(!form) return;
  confirmDialog(
    'Delete "' + form.name + '"?',
    'This cannot be undone.' + (form.status !== 'draft' ? ' Only Draft versions can be deleted — this one is ' + (STATUS_LABELS[form.status] || form.status).toLowerCase() + '.' : ''),
    function(){
      formsApi.remove(formId).then(function(){
        _toast('Form deleted.');
        loadAndRenderFormsAdminList();
      }, function(e){
        _toast('Could not delete form: ' + (e.message || 'unknown error'));
      });
    }
  );
}

// ---- Version history (one form group's every version — Phase 3) ----

export function openFormVersionHistory(formGroupId, name){
  historyFormGroupId = formGroupId;
  document.getElementById('formVersionHistoryTitle').textContent = 'Versions — ' + (name || 'Form');
  document.getElementById('formVersionHistoryOverlay').classList.remove('hidden');
  loadAndRenderVersionHistory();
}
export function closeFormVersionHistory(){
  document.getElementById('formVersionHistoryOverlay').classList.add('hidden');
  historyFormGroupId = null;
  historyVersions = [];
}

function loadAndRenderVersionHistory(){
  formsApi.listVersions(historyFormGroupId).then(function(versions){
    historyVersions = versions;
    renderVersionHistoryList();
  }, function(e){
    _toast('Could not load versions: ' + (e.message || 'unknown error'));
  });
}

function renderVersionHistoryList(){
  var list = document.getElementById('formVersionHistoryList');
  var hasDraft = historyVersions.some(function(v){ return v.status === 'draft'; });
  document.getElementById('formVersionHistoryNewBtn').classList.toggle('hidden', hasDraft);

  var sorted = historyVersions.slice().sort(function(a, b){ return b.versionNumber - a.versionNumber; });
  list.innerHTML = sorted.map(function(v){
    return '<div class="kf-form-admin-row" data-version-id="' + v.id + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">v' + v.versionNumber + '</span>' +
        '<span class="kf-form-status-badge kf-form-status-' + v.status + '">' + (STATUS_LABELS[v.status] || v.status) + '</span>' +
        '<span class="kf-form-admin-row-version">' + (v.publishedAt ? 'Published ' + utcISOToLocalDisplayDate(v.publishedAt) : 'Created ' + utcISOToLocalDisplayDate(v.dateCreated)) + '</span>' +
      '</div>' +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-edit-version="' + v.id + '"><span class="kf-icon" data-icon="edit" data-size="13"></span>' + (v.status === 'draft' ? 'Edit' : 'View') + '</button>' +
        (v.status === 'draft' ? '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-publish-version="' + v.id + '"><span class="kf-icon" data-icon="check" data-size="13"></span>Publish</button>' : '') +
        (v.status === 'draft' ? '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-delete-version="' + v.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Delete</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-edit-version]').forEach(function(btn){
    btn.addEventListener('click', function(){
      // Every .kf-overlay shares one z-index — stacking is purely DOM source order, not "most
      // recently shown," so a later-in-DOM overlay (this history one) would otherwise render on
      // top of the builder even after the builder opens. Close history first, same reasoning as
      // cloneLatestVersion below.
      closeFormVersionHistory();
      openFormFieldBuilder(btn.getAttribute('data-edit-version'));
    });
  });
  list.querySelectorAll('[data-publish-version]').forEach(function(btn){
    btn.addEventListener('click', function(){ publishVersionFromHistory(btn.getAttribute('data-publish-version')); });
  });
  list.querySelectorAll('[data-delete-version]').forEach(function(btn){
    btn.addEventListener('click', function(){ deleteVersionFromHistory(btn.getAttribute('data-delete-version')); });
  });
  hydrateIcons(list);
}

function publishVersionFromHistory(formId){
  formsApi.publish(formId).then(function(){
    _toast('Version published.');
    loadAndRenderVersionHistory();
    loadAndRenderFormsAdminList();
  }, function(e){
    _toast('Could not publish version: ' + (e.message || 'unknown error'));
  });
}

function deleteVersionFromHistory(formId){
  var version = historyVersions.filter(function(v){ return v.id === formId; })[0];
  if(!version) return;
  confirmDialog(
    'Delete v' + version.versionNumber + '?',
    'This cannot be undone.',
    function(){
      formsApi.remove(formId).then(function(){
        _toast('Version deleted.');
        loadAndRenderVersionHistory();
        loadAndRenderFormsAdminList();
      }, function(e){
        _toast('Could not delete version: ' + (e.message || 'unknown error'));
      });
    }
  );
}

export function cloneLatestVersion(){
  if(!historyFormGroupId) return;
  formsApi.cloneVersion(historyFormGroupId).then(function(created){
    _toast('New draft version created.');
    loadAndRenderFormsAdminList();
    // Close history before opening the builder — same DOM-order stacking reasoning as the
    // data-edit-version handler above (both overlays share one z-index, so the later-in-DOM one
    // would otherwise render on top of the builder regardless of open order).
    closeFormVersionHistory();
    openFormFieldBuilder(created.id);
  }, function(e){
    _toast('Could not create a new version: ' + (e.message || 'unknown error'));
  });
}

export function showFormsAdminCreateRow(){
  document.getElementById('formsAdminNameInput').value = '';
  document.getElementById('formsAdminCreateRow').classList.remove('hidden');
  document.getElementById('formsAdminNameInput').focus();
}
export function hideFormsAdminCreateRow(){
  document.getElementById('formsAdminCreateRow').classList.add('hidden');
}
export function createFormFromAdmin(){
  var name = document.getElementById('formsAdminNameInput').value.trim();
  if(!name){ _toast('Please enter a name.'); return; }
  formsApi.create({name: name, description: null, fieldsJson: null}).then(function(created){
    hideFormsAdminCreateRow();
    _toast('Form created.');
    loadAndRenderFormsAdminList();
    openFormFieldBuilder(created.id);
  }, function(e){
    _toast('Could not create form: ' + (e.message || 'unknown error'));
  });
}

// ---- Field builder (one form's name/description + fields) ----

function parseFieldsJson(json){
  if(!json) return [];
  try {
    var parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e){
    return [];
  }
}

export function openFormFieldBuilder(formId){
  formsApi.get(formId).then(function(form){
    builderForm = Object.assign({}, form, {fields: parseFieldsJson(form.fieldsJson)});
    document.getElementById('formFieldBuilderTitle').textContent = 'Edit Form — ' + form.name;
    document.getElementById('formBuilderNameInput').value = form.name;
    document.getElementById('formBuilderDescInput').value = form.description || '';
    var readOnly = form.status !== 'draft';
    document.getElementById('formBuilderNameInput').disabled = readOnly;
    document.getElementById('formBuilderDescInput').disabled = readOnly;
    document.getElementById('addFormFieldBtn').classList.toggle('hidden', readOnly);
    document.getElementById('formBuilderSaveBtn').classList.toggle('hidden', readOnly);
    renderFormBuilderFieldsList();
    renderFormBuilderWorkflowSummary();
    document.getElementById('formFieldBuilderOverlay').classList.remove('hidden');
  }, function(e){
    _toast('Could not load form: ' + (e.message || 'unknown error'));
  });
}
function renderFormBuilderWorkflowSummary(){
  var workflow = parseFormWorkflow(builderForm.workflowJson);
  var el = document.getElementById('formBuilderWorkflowSummary');
  if(workflow.nodes.length === 0){
    el.textContent = 'No workflow configured yet';
    return;
  }
  el.textContent = workflow.nodes.length + ' step' + (workflow.nodes.length === 1 ? '' : 's') + ' · ' +
    workflow.edges.length + ' connection' + (workflow.edges.length === 1 ? '' : 's');
}

export function openFormWorkflowEditorForBuilder(){
  if(!builderForm) return;
  document.getElementById('formWorkflowEditorTitle').textContent = 'Workflow — ' + builderForm.name;
  loadFormWorkflowGraph(parseFormWorkflow(builderForm.workflowJson), builderForm.status !== 'draft');
  document.getElementById('formWorkflowEditorOverlay').classList.remove('hidden');
}
export function closeFormWorkflowEditorForBuilder(){
  if(builderForm) builderForm.workflowJson = JSON.stringify(getFormWorkflowGraph());
  document.getElementById('formWorkflowEditorOverlay').classList.add('hidden');
  renderFormBuilderWorkflowSummary();
}

export function closeFormFieldBuilder(){
  document.getElementById('formFieldBuilderOverlay').classList.add('hidden');
  builderForm = null;
}

function renderFormBuilderFieldsList(){
  var list = document.getElementById('formBuilderFieldsList');
  var fields = builderForm.fields;
  var readOnly = builderForm.status !== 'draft';
  document.getElementById('formBuilderFieldsEmpty').classList.toggle('hidden', fields.length > 0);

  list.innerHTML = fields.map(function(f, i){
    return '<div class="kf-form-field-row" data-field-id="' + f.id + '">' +
      '<span class="kf-icon kf-setting-row-icon" data-icon="' + (FIELD_TYPES.filter(function(t){ return t.value === f.type; })[0] || {}).icon + '" data-size="16"></span>' +
      '<span class="kf-form-field-row-text">' +
        '<span class="kf-form-field-row-label">' + escapeHTML(f.label || '(untitled field)') + '</span>' +
        '<span class="kf-form-field-row-summary">' + escapeHTML(fieldSummary(f)) + '</span>' +
      '</span>' +
      (readOnly ? '' :
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-move-field-up="' + f.id + '" title="Move up"' + (i === 0 ? ' disabled' : '') + '><span class="kf-icon" style="transform:rotate(90deg);">' + iconSvg('chevronLeft', 14) + '</span></button>' +
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-move-field-down="' + f.id + '" title="Move down"' + (i === fields.length - 1 ? ' disabled' : '') + '><span class="kf-icon" style="transform:rotate(-90deg);">' + iconSvg('chevronLeft', 14) + '</span></button>' +
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-edit-field="' + f.id + '" title="Edit field">' + iconSvg('edit', 14) + '</button>' +
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-remove-field="' + f.id + '" title="Remove field">' + iconSvg('trash', 14) + '</button>') +
    '</div>';
  }).join('');

  if(readOnly) return;
  list.querySelectorAll('[data-move-field-up]').forEach(function(btn){
    btn.addEventListener('click', function(){ moveBuilderField(btn.getAttribute('data-move-field-up'), -1); });
  });
  list.querySelectorAll('[data-move-field-down]').forEach(function(btn){
    btn.addEventListener('click', function(){ moveBuilderField(btn.getAttribute('data-move-field-down'), 1); });
  });
  list.querySelectorAll('[data-edit-field]').forEach(function(btn){
    btn.addEventListener('click', function(){ openFieldEditor(btn.getAttribute('data-edit-field')); });
  });
  list.querySelectorAll('[data-remove-field]').forEach(function(btn){
    btn.addEventListener('click', function(){ removeBuilderField(btn.getAttribute('data-remove-field')); });
  });
}

function moveBuilderField(fieldId, direction){
  var fields = builderForm.fields;
  var idx = fields.findIndex(function(f){ return f.id === fieldId; });
  var otherIdx = idx + direction;
  if(idx < 0 || otherIdx < 0 || otherIdx >= fields.length) return;
  var tmp = fields[idx];
  fields[idx] = fields[otherIdx];
  fields[otherIdx] = tmp;
  renderFormBuilderFieldsList();
}

function removeBuilderField(fieldId){
  builderForm.fields = builderForm.fields.filter(function(f){ return f.id !== fieldId; });
  renderFormBuilderFieldsList();
}

export function saveFormBuilder(){
  var name = document.getElementById('formBuilderNameInput').value.trim();
  if(!name){ _toast('Please enter a name.'); return; }
  var description = document.getElementById('formBuilderDescInput').value.trim();
  formsApi.update(builderForm.id, {
    name: name, description: description || null,
    fieldsJson: JSON.stringify(builderForm.fields), workflowJson: builderForm.workflowJson || null
  }).then(function(){
    _toast('Form saved.');
    closeFormFieldBuilder();
    loadAndRenderFormsAdminList();
  }, function(e){
    _toast('Could not save form: ' + (e.message || 'unknown error'));
  });
}

// ---- Field editor (add/edit one field within the builder above) ----

export function openFieldEditor(fieldId){
  editingFieldId = fieldId || null;
  var existing = fieldId ? builderForm.fields.filter(function(f){ return f.id === fieldId; })[0] : null;
  editingFieldDraft = existing ? JSON.parse(JSON.stringify(existing)) : defaultFieldConfig('text');

  document.getElementById('formFieldEditorTitle').textContent = existing ? 'Edit Field' : 'Add Field';
  document.getElementById('formFieldTypeSelect').value = editingFieldDraft.type;
  document.getElementById('formFieldTypeSelect').disabled = !!existing; // changing type on an existing field would orphan its type-specific config — remove + re-add instead, same convention as Dashboard's own widget-type lock on edit
  document.getElementById('formFieldLabelInput').value = editingFieldDraft.label || '';
  document.getElementById('formFieldHelpInput').value = editingFieldDraft.helpText || '';
  document.getElementById('formFieldRequiredCheckbox').checked = !!editingFieldDraft.required;
  renderFieldTypeConfig();
  document.getElementById('formFieldEditorOverlay').classList.remove('hidden');
}
export function closeFieldEditor(){
  document.getElementById('formFieldEditorOverlay').classList.add('hidden');
  editingFieldId = null;
  editingFieldDraft = null;
}

function renderFieldTypeConfig(){
  document.getElementById('formFieldTypeConfigFields').innerHTML = renderFieldTypeConfigHTML(editingFieldDraft);
  wireFieldTypeConfigInputs();
}

/* Called when the type <select> itself changes — resets to a fresh default config for the newly
   chosen type (same "start clean, don't try to carry over incompatible config" rule Dashboard's own
   onDashboardWidgetTypeChanged follows). Only reachable when adding a brand-new field (the type
   select is disabled while editing an existing one). */
export function onFormFieldTypeChanged(){
  editingFieldDraft = defaultFieldConfig(document.getElementById('formFieldTypeSelect').value);
  renderFieldTypeConfig();
}

function wireFieldTypeConfigInputs(){
  var mutexCb = document.getElementById('formFieldMutexCheckbox');
  if(mutexCb) mutexCb.addEventListener('change', function(){ editingFieldDraft.mutex = mutexCb.checked; });

  var multipleCb = document.getElementById('formFieldMultipleCheckbox');
  if(multipleCb) multipleCb.addEventListener('change', function(){ editingFieldDraft.multiple = multipleCb.checked; });

  var includesTimeCb = document.getElementById('formFieldIncludesTimeCheckbox');
  if(includesTimeCb) includesTimeCb.addEventListener('change', function(){ editingFieldDraft.includesTime = includesTimeCb.checked; });

  var groupModeSelect = document.getElementById('formFieldGroupModeSelect');
  if(groupModeSelect) groupModeSelect.addEventListener('change', function(){
    editingFieldDraft.groupMode = groupModeSelect.value;
    document.getElementById('formFieldRadioOptionsWrap').classList.toggle('hidden', groupModeSelect.value === 'single');
  });

  var minInput = document.getElementById('formFieldMinInput');
  if(minInput) minInput.addEventListener('input', function(){ editingFieldDraft.min = minInput.value === '' ? null : Number(minInput.value); });
  var maxInput = document.getElementById('formFieldMaxInput');
  if(maxInput) maxInput.addEventListener('input', function(){ editingFieldDraft.max = maxInput.value === '' ? null : Number(maxInput.value); });

  wireOptionsEditor();
}

function wireOptionsEditor(){
  var addBtn = document.getElementById('formFieldAddOptionBtn');
  if(!addBtn) return;
  addBtn.addEventListener('click', function(){
    if(!editingFieldDraft.options) editingFieldDraft.options = [];
    editingFieldDraft.options.push({id: uid('opt'), label: ''});
    renderFieldTypeConfig();
    var inputs = document.querySelectorAll('.kf-form-option-input');
    if(inputs.length) inputs[inputs.length - 1].focus();
  });
  document.querySelectorAll('[data-remove-option]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var idx = parseInt(btn.getAttribute('data-remove-option'), 10);
      editingFieldDraft.options.splice(idx, 1);
      renderFieldTypeConfig();
    });
  });
  document.querySelectorAll('[data-move-option-up]').forEach(function(btn){
    btn.addEventListener('click', function(){ moveDraftOption(parseInt(btn.getAttribute('data-move-option-up'), 10), -1); });
  });
  document.querySelectorAll('[data-move-option-down]').forEach(function(btn){
    btn.addEventListener('click', function(){ moveDraftOption(parseInt(btn.getAttribute('data-move-option-down'), 10), 1); });
  });
  document.querySelectorAll('.kf-form-option-input').forEach(function(input){
    input.addEventListener('input', function(){
      var idx = parseInt(input.getAttribute('data-option-index'), 10);
      editingFieldDraft.options[idx].label = input.value;
    });
  });
}

function moveDraftOption(idx, direction){
  var options = editingFieldDraft.options;
  var otherIdx = idx + direction;
  if(otherIdx < 0 || otherIdx >= options.length) return;
  var tmp = options[idx];
  options[idx] = options[otherIdx];
  options[otherIdx] = tmp;
  renderFieldTypeConfig();
}

export function saveFieldEditor(){
  var label = document.getElementById('formFieldLabelInput').value.trim();
  if(!label){ _toast('Please enter a label.'); return; }
  editingFieldDraft.label = label;
  editingFieldDraft.helpText = document.getElementById('formFieldHelpInput').value.trim();
  editingFieldDraft.required = document.getElementById('formFieldRequiredCheckbox').checked;

  if(editingFieldId){
    var idx = builderForm.fields.findIndex(function(f){ return f.id === editingFieldId; });
    if(idx !== -1) builderForm.fields[idx] = editingFieldDraft;
  } else {
    builderForm.fields.push(editingFieldDraft);
  }
  closeFieldEditor();
  renderFormBuilderFieldsList();
}
