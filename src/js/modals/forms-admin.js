"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../views/board.js';
import { formsApi } from '../api.js';
import { confirmDialog } from './confirm.js';
import { FIELD_TYPES, defaultFieldConfig, fieldSummary, renderFieldTypeConfigHTML } from '../features/form-fields.js';
import { iconSvg, hydrateIcons } from '../icons.js';
import { uid } from '../storage.js';

/* Enterprise Forms & Workflow — Org-Admin authoring UI (Phase 2 of the approved plan). Two nested
   overlays: #formsAdminOverlay (a picker listing every form version in the org — Phase 3 will filter
   this down to "one row per form group, showing its current version" once versioning exists; for
   now every row IS its own version, since Phase 1/2 only ever create a single Draft) and
   #formFieldBuilderOverlay (one form's name/description + its FieldsJson array, edited entirely
   in-memory and written back in a single PUT on Save — no per-field API calls, unlike Dashboard
   widgets, since fields aren't separate DB rows here). A third, smaller overlay
   (#formFieldEditorOverlay) adds/edits one field at a time within the builder. */

var _toast = toast;

var adminForms = [];
var builderForm = null; // {id, formGroupId, name, description, versionNumber, status, fields: [...]}
var editingFieldId = null; // id of the field currently open in the field editor, or null when adding a brand-new one
var editingFieldDraft = null; // the in-progress field object the editor overlay is currently mutating

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

function renderFormsAdminList(){
  var list = document.getElementById('formsAdminList');
  document.getElementById('formsAdminEmpty').classList.toggle('hidden', adminForms.length > 0);
  list.innerHTML = adminForms.map(function(f){
    return '<div class="kf-form-admin-row" data-form-id="' + f.id + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(f.name) + '</span>' +
        '<span class="kf-form-status-badge kf-form-status-' + f.status + '">' + (STATUS_LABELS[f.status] || f.status) + '</span>' +
        '<span class="kf-form-admin-row-version">v' + f.versionNumber + '</span>' +
      '</div>' +
      (f.description ? '<div class="kf-form-admin-row-desc">' + escapeHTML(f.description) + '</div>' : '') +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-edit-form="' + f.id + '"><span class="kf-icon" data-icon="edit" data-size="13"></span>Edit</button>' +
        '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-delete-form="' + f.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-edit-form]').forEach(function(btn){
    btn.addEventListener('click', function(){ openFormFieldBuilder(btn.getAttribute('data-edit-form')); });
  });
  list.querySelectorAll('[data-delete-form]').forEach(function(btn){
    btn.addEventListener('click', function(){ deleteFormFromAdmin(btn.getAttribute('data-delete-form')); });
  });
  hydrateIcons(list);
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
    document.getElementById('formFieldBuilderOverlay').classList.remove('hidden');
  }, function(e){
    _toast('Could not load form: ' + (e.message || 'unknown error'));
  });
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
