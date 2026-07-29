"use strict";
import { escapeHTML } from '../views/board.js';
import { uid } from '../storage.js';
import { iconSvg } from '../icons.js';

/* Pure per-field-type helpers for the Enterprise Forms field builder (modals/forms-admin.js) — no
   DOM/API/state here, same "pure renderer" role features/dashboard-widgets.js plays for Dashboard
   widgets. A field is a plain object living inside one Form version's FieldsJson array (see
   Domain/Entities/Form.cs's own doc comment — that JSON is opaque and unvalidated server-side, the
   frontend owns the whole shape):

   {id, type: 'text'|'textarea'|'numeric'|'checkboxGroup'|'radio'|'select'|'datetime',
    label, helpText, required (bool), order (int),
    // checkboxGroup only: options: [{id, label}], mutex (bool — true = pick-one-of-group)
    // radio only: options: [{id, label}], groupMode: 'single'|'mutexGroup'|'multiGroup'
    // select only: options: [{id, label}], multiple (bool)
    // numeric only: min, max (nullable numbers)
    // datetime only: includesTime (bool)}
*/

export var FIELD_TYPES = [
  {value: 'text', label: 'Text', icon: 'ty_document'},
  {value: 'textarea', label: 'Textarea', icon: 'ty_document'},
  {value: 'numeric', label: 'Numeric', icon: 'list'},
  {value: 'checkboxGroup', label: 'Checkbox', icon: 'checkSquare'},
  {value: 'radio', label: 'Radio button', icon: 'check'},
  {value: 'select', label: 'Select', icon: 'list'},
  {value: 'datetime', label: 'Date and time', icon: 'clock'}
];

export function fieldTypeLabel(type){
  var match = FIELD_TYPES.filter(function(t){ return t.value === type; })[0];
  return match ? match.label : type;
}

/* A fresh field object for a brand-new field of the given type — sensible, immediately-usable
   defaults (an empty options list still renders, just with nothing to pick from yet, matching this
   app's own "corrupted/missing collapses to a safe default" convention rather than blocking on
   "you must add an option first"). */
export function defaultFieldConfig(type){
  var base = {id: uid('field'), type: type, label: '', helpText: '', required: false};
  if(type === 'checkboxGroup') return Object.assign(base, {options: [], mutex: false});
  if(type === 'radio') return Object.assign(base, {options: [], groupMode: 'single'});
  if(type === 'select') return Object.assign(base, {options: [], multiple: false});
  if(type === 'numeric') return Object.assign(base, {min: null, max: null});
  if(type === 'datetime') return Object.assign(base, {includesTime: false});
  return base;
}

/* Short one-line description for a field row in the builder's list — e.g. "Checkbox • 3 options,
   pick one" or "Text • required". Purely descriptive, never used for validation. */
export function fieldSummary(field){
  var parts = [fieldTypeLabel(field.type)];
  if(field.type === 'checkboxGroup' || field.type === 'select' || field.type === 'radio'){
    var optionCount = (field.options || []).length;
    if(field.type === 'radio' && field.groupMode === 'single'){
      // no options — a single toggle
    } else {
      parts.push(optionCount + ' option' + (optionCount === 1 ? '' : 's'));
      if(field.type === 'checkboxGroup') parts.push(field.mutex ? 'pick one' : 'pick any');
      if(field.type === 'radio') parts.push(field.groupMode === 'multiGroup' ? 'pick any' : 'pick one');
      if(field.type === 'select' && field.multiple) parts.push('multiple');
    }
  }
  if(field.type === 'numeric' && (field.min != null || field.max != null)){
    parts.push('range ' + (field.min != null ? field.min : '–') + '–' + (field.max != null ? field.max : '–'));
  }
  if(field.type === 'datetime' && field.includesTime) parts.push('with time');
  if(field.required) parts.push('required');
  return parts.join(' • ');
}

/* Options-list mini-editor markup shared by checkboxGroup/radio/select — a plain add/remove/rename
   row list, same "no drag reordering, just explicit controls" idiom as the rest of this app's small
   editors (Dashboard's own widget-order list uses up/down buttons, not drag, for the same reason). */
function renderOptionsEditorHTML(options){
  var list = options || [];
  var rows = list.map(function(o, i){
    return '<div class="kf-form-option-row" data-option-id="' + escapeHTML(o.id) + '">' +
      '<input type="text" class="kf-form-option-input" value="' + escapeHTML(o.label) + '" placeholder="Option label" data-option-index="' + i + '">' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-move-option-up="' + i + '" title="Move up"' + (i === 0 ? ' disabled' : '') + '><span class="kf-icon" style="transform:rotate(90deg);">' + iconSvg('chevronLeft', 12) + '</span></button>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-move-option-down="' + i + '" title="Move down"' + (i === list.length - 1 ? ' disabled' : '') + '><span class="kf-icon" style="transform:rotate(-90deg);">' + iconSvg('chevronLeft', 12) + '</span></button>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-remove-option="' + i + '" title="Remove option">&times;</button>' +
    '</div>';
  }).join('');
  return '<div class="kf-form-options-editor">' +
    '<div id="formFieldOptionsRows">' + rows + '</div>' +
    '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" id="formFieldAddOptionBtn"><span class="kf-icon" data-icon="plus" data-size="12"></span>Add option</button>' +
  '</div>';
}

/* Builds the type-specific portion of the field editor sub-form (everything beyond the common
   label/help/required fields, which the caller renders once, unconditionally). Returns an HTML
   string only — modals/forms-admin.js is responsible for injecting it and wiring the resulting
   inputs (this file stays pure, no DOM/event code, matching dashboard-widgets.js's own split). */
export function renderFieldTypeConfigHTML(field){
  if(field.type === 'checkboxGroup'){
    return renderOptionsEditorHTML(field.options) +
      '<div class="kf-checkbox-row">' +
        '<input type="checkbox" id="formFieldMutexCheckbox"' + (field.mutex ? ' checked' : '') + '>' +
        '<label for="formFieldMutexCheckbox" style="text-transform:none;font-weight:500;">Only one may be checked at a time</label>' +
      '</div>';
  }
  if(field.type === 'radio'){
    var mode = field.groupMode || 'single';
    return '<div class="kf-field">' +
        '<label for="formFieldGroupModeSelect">Options</label>' +
        '<select id="formFieldGroupModeSelect">' +
          '<option value="single"' + (mode === 'single' ? ' selected' : '') + '>Single toggle (no options list)</option>' +
          '<option value="mutexGroup"' + (mode === 'mutexGroup' ? ' selected' : '') + '>Group — pick exactly one</option>' +
          '<option value="multiGroup"' + (mode === 'multiGroup' ? ' selected' : '') + '>Group — pick any number</option>' +
        '</select>' +
      '</div>' +
      '<div id="formFieldRadioOptionsWrap" class="' + (mode === 'single' ? 'hidden' : '') + '">' + renderOptionsEditorHTML(field.options) + '</div>';
  }
  if(field.type === 'select'){
    return renderOptionsEditorHTML(field.options) +
      '<div class="kf-checkbox-row">' +
        '<input type="checkbox" id="formFieldMultipleCheckbox"' + (field.multiple ? ' checked' : '') + '>' +
        '<label for="formFieldMultipleCheckbox" style="text-transform:none;font-weight:500;">Allow multiple selections</label>' +
      '</div>';
  }
  if(field.type === 'numeric'){
    return '<div class="kf-field-row">' +
      '<div class="kf-field"><label for="formFieldMinInput">Min <span style="font-weight:400;color:var(--kf-text-faint);">(optional)</span></label><input type="number" id="formFieldMinInput" value="' + (field.min != null ? field.min : '') + '"></div>' +
      '<div class="kf-field"><label for="formFieldMaxInput">Max <span style="font-weight:400;color:var(--kf-text-faint);">(optional)</span></label><input type="number" id="formFieldMaxInput" value="' + (field.max != null ? field.max : '') + '"></div>' +
    '</div>';
  }
  if(field.type === 'datetime'){
    return '<div class="kf-checkbox-row">' +
        '<input type="checkbox" id="formFieldIncludesTimeCheckbox"' + (field.includesTime ? ' checked' : '') + '>' +
        '<label for="formFieldIncludesTimeCheckbox" style="text-transform:none;font-weight:500;">Include a time, not just a date</label>' +
      '</div>';
  }
  return '';
}
