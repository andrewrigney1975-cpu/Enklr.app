"use strict";
import { escapeHTML } from '../views/board.js';
import { utcISOToLocalDisplayDate, utcISOToLocalDisplayDateTime } from '../date-utils.js';

/* Pure per-field-type helpers for the Enterprise Forms FILL-OUT UI (modals/forms-fillout.js) —
   mirrors features/form-fields.js's role for the builder, but renders an INPUT (or a read-only
   value) instead of a config panel. AnswersJson (see Domain/Entities/FormSubmission.cs's own doc
   comment) is a flat {fieldId: value} map:
     text/textarea -> string
     numeric -> number or null
     checkboxGroup -> array of selected option ids (mutex or not, always an array)
     radio (single mode) -> boolean
     radio (mutexGroup) -> single selected option id, or null
     radio (multiGroup) -> array of selected option ids
     select (single) -> single option id, or null
     select (multiple) -> array of option ids
     datetime -> ISO date string ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'), or null
   No DOM/API/state beyond what's needed to render+read one field's own answer — the caller
   (modals/forms-fillout.js) owns the overlay, the fetch/save calls, and validation summary. */

function optionLabel(field, optionId){
  var match = (field.options || []).filter(function(o){ return o.id === optionId; })[0];
  return match ? match.label : optionId;
}

/* Renders one field's fillable input(s), pre-populated from `value` if given (editing an existing
   Draft) — wrapped in a container carrying data-field-id so collectAnswerValue can find it again at
   save/submit time without needing per-keystroke state tracking. */
export function renderAnswerInputHTML(field, value){
  var reqMark = field.required ? ' <span class="kf-form-answer-required">*</span>' : '';
  var help = field.helpText ? '<div class="kf-form-answer-help">' + escapeHTML(field.helpText) + '</div>' : '';
  var body = '';

  if(field.type === 'text'){
    body = '<input type="text" data-answer-input value="' + escapeHTML(value != null ? value : '') + '">';
  } else if(field.type === 'textarea'){
    body = '<textarea data-answer-input rows="3">' + escapeHTML(value != null ? value : '') + '</textarea>';
  } else if(field.type === 'numeric'){
    var minAttr = field.min != null ? ' min="' + field.min + '"' : '';
    var maxAttr = field.max != null ? ' max="' + field.max + '"' : '';
    body = '<input type="number" data-answer-input value="' + (value != null ? value : '') + '"' + minAttr + maxAttr + '>';
  } else if(field.type === 'checkboxGroup'){
    var checkedIds = Array.isArray(value) ? value : [];
    var inputType = field.mutex ? 'radio' : 'checkbox';
    body = (field.options || []).map(function(o){
      return '<label class="kf-form-answer-option"><input type="' + inputType + '" name="answer-' + field.id + '" data-answer-option value="' + escapeHTML(o.id) + '"' + (checkedIds.indexOf(o.id) !== -1 ? ' checked' : '') + '> ' + escapeHTML(o.label) + '</label>';
    }).join('');
  } else if(field.type === 'radio' && field.groupMode === 'single'){
    body = '<label class="kf-form-answer-option"><input type="checkbox" data-answer-toggle' + (value === true ? ' checked' : '') + '> ' + escapeHTML(field.label) + '</label>';
  } else if(field.type === 'radio'){
    var multi = field.groupMode === 'multiGroup';
    var checkedRadioIds = multi ? (Array.isArray(value) ? value : []) : (value != null ? [value] : []);
    body = (field.options || []).map(function(o){
      return '<label class="kf-form-answer-option"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="answer-' + field.id + '" data-answer-option value="' + escapeHTML(o.id) + '"' + (checkedRadioIds.indexOf(o.id) !== -1 ? ' checked' : '') + '> ' + escapeHTML(o.label) + '</label>';
    }).join('');
  } else if(field.type === 'select' || field.type === 'priority'){
    var selectedIds = field.multiple ? (Array.isArray(value) ? value : []) : (value != null ? [value] : []);
    var opts = (field.multiple ? '' : '<option value="">— Select —</option>') + (field.options || []).map(function(o){
      return '<option value="' + escapeHTML(o.id) + '"' + (selectedIds.indexOf(o.id) !== -1 ? ' selected' : '') + '>' + escapeHTML(o.label) + '</option>';
    }).join('');
    body = '<select data-answer-input' + (field.multiple ? ' multiple' : '') + '>' + opts + '</select>';
  } else if(field.type === 'datetime'){
    body = '<input type="' + (field.includesTime ? 'datetime-local' : 'date') + '" data-answer-input value="' + escapeHTML(value != null ? value : '') + '">';
  }

  // radio(single) already folds the field's own label into its one checkbox row, so it skips the
  // usual separate label line above the input.
  var labelLine = (field.type === 'radio' && field.groupMode === 'single') ? '' :
    '<label>' + escapeHTML(field.label) + reqMark + '</label>';

  return '<div class="kf-form-answer-field" data-field-id="' + field.id + '">' + labelLine + help + body + '</div>';
}

export function collectAnswerValue(field, fieldEl){
  if(!fieldEl) return null;
  if(field.type === 'checkboxGroup' || (field.type === 'radio' && field.groupMode !== 'single')){
    var checked = Array.from(fieldEl.querySelectorAll('[data-answer-option]:checked')).map(function(el){ return el.value; });
    if(field.type === 'radio' && field.groupMode === 'mutexGroup') return checked[0] || null;
    return checked;
  }
  if(field.type === 'radio' && field.groupMode === 'single'){
    var toggle = fieldEl.querySelector('[data-answer-toggle]');
    return !!(toggle && toggle.checked);
  }
  if(field.type === 'select' && field.multiple){
    var select = fieldEl.querySelector('[data-answer-input]');
    return select ? Array.from(select.selectedOptions).map(function(o){ return o.value; }) : [];
  }
  var input = fieldEl.querySelector('[data-answer-input]');
  if(!input) return null;
  if(field.type === 'numeric') return input.value === '' ? null : Number(input.value);
  if(field.type === 'select' || field.type === 'priority') return input.value === '' ? null : input.value;
  return input.value === '' ? null : input.value;
}

/* Every field's own answer, read from the currently-rendered form — the caller then JSON.stringifies
   this as AnswersJson. */
export function collectAllAnswers(fields, containerEl){
  var answers = {};
  fields.forEach(function(field){
    var fieldEl = containerEl.querySelector('.kf-form-answer-field[data-field-id="' + field.id + '"]');
    answers[field.id] = collectAnswerValue(field, fieldEl);
  });
  return answers;
}

function isAnswerEmpty(field, value){
  if(value == null) return true;
  if(Array.isArray(value)) return value.length === 0;
  if(field.type === 'radio' && field.groupMode === 'single') return value !== true;
  if(typeof value === 'string') return value.trim() === '';
  return false;
}

/* Field labels missing a required answer — the caller shows these back to the user rather than
   submitting; purely client-side (a UI convenience, same as every other "required" check in this
   app), the real gate/authorization check happens server-side in FormSubmissionService.SubmitAsync. */
export function findMissingRequiredFields(fields, answers){
  return fields.filter(function(f){ return f.required && isAnswerEmpty(f, answers[f.id]); });
}

/* Read-only rendering of one field's own answer (a submitted/approved/rejected submission, or any
   submission viewed by someone other than its own author) — plain label:value text, no inputs. */
export function renderAnswerReadOnlyHTML(field, value){
  var display;
  if(value == null || (Array.isArray(value) && value.length === 0) || value === ''){
    display = '<span class="kf-form-answer-empty">—</span>';
  } else if(field.type === 'radio' && field.groupMode === 'single'){
    display = value === true ? 'Yes' : 'No';
  } else if(Array.isArray(value)){
    display = escapeHTML(value.map(function(id){ return optionLabel(field, id); }).join(', '));
  } else if(field.type === 'checkboxGroup' || (field.type === 'radio' && field.groupMode !== 'single') || field.type === 'select' || field.type === 'priority'){
    display = escapeHTML(optionLabel(field, value));
  } else if(field.type === 'datetime'){
    // Rendered in the viewer's own locale (dd/mm/yyyy for an Australian user, etc — see
    // date-utils.js's own toLocaleDateString(undefined, ...) convention) rather than the raw stored
    // ISO/date-only string a bare String(value) would otherwise show verbatim.
    var formatted = field.includesTime ? utcISOToLocalDisplayDateTime(value) : utcISOToLocalDisplayDate(value);
    display = escapeHTML(formatted || String(value));
  } else {
    display = escapeHTML(String(value));
  }
  var label = (field.type === 'radio' && field.groupMode === 'single') ? '' : '<label>' + escapeHTML(field.label) + '</label>';
  return '<div class="kf-form-answer-field kf-form-answer-readonly">' + label + '<div class="kf-form-answer-value">' + display + '</div></div>';
}
