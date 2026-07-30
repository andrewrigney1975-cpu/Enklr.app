"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../views/board.js';
import { portalHomeApi } from '../api.js';
import { confirmDialog } from './confirm.js';
import { renderAnswerInputHTML, collectAllAnswers, findMissingRequiredFields } from '../features/form-answers.js';
import { setPortalHash, clearPortalHash, parsePortalSlugFromHash } from '../features/hash-router.js';
import { iconSvg, hydrateIcons } from '../icons.js';

/* Organisational Portals — the fullscreen, end-user experience (kf-modal-full, see PORTALS.md's own
   design brief for the token system this file's markup/CSS embody). Three panes: Start a request
   (available forms) / My requests (a status-stepper per submission, the signature device this page
   is meant to be remembered by) / Answers (a knowledge-base-style Q&A accordion). A form is filled
   out in a layered kf-modal-md detail overlay (#portalHomeFilloutOverlay), mirroring
   modals/forms-fillout.js's own detail shape but backed by portalHomeApi (this Portal's own
   actioner Project) instead of projectFormsApi. */

var _toast = toast;

var currentPortal = null; // PortalDto
var currentForms = [];
var currentRequests = [];
var currentQa = null; // {topics, entries}
var detail = null; // {mode: 'new'|'draft', form, fields, submissionId, submission}
var expandedQaEntryIds = {};

var STEPPER_STEPS = ['Draft', 'Submitted', 'In review', 'Approved'];

// ---- Open/close ----

export function openPortalHomeBySlug(slug){
  portalHomeApi.getBySlug(slug).then(function(portal){
    currentPortal = portal;
    setPortalHash(portal.slug);
    document.getElementById('portalHomeOverlay').classList.remove('hidden');
    document.getElementById('portalHomeIconLarge').innerHTML = portal.iconName ? iconSvg(portal.iconName, 48) : '';
    document.getElementById('portalHomeGreeting').textContent = 'Welcome to the ' + portal.name + ' Portal';
    document.getElementById('portalHomeDesc').textContent = portal.description || '';
    loadAndRenderPortalHome();
  }, function(){
    _toast('That Portal isn\'t available.');
  });
}

/* Populates the side nav's dynamic "Portals" section — one icon button per published Portal this
   user actually has access to (server-side re-derived, PortalHomeService.ListAccessibleAsync).
   Called once at init() (after login), same call-site convention as openWhiteboardFromHashIfPresent/
   initChat — not re-run on every render, so a Portal published/granted mid-session only appears in
   the side nav after the next reload. */
export function loadAndRenderSideNavPortals(){
  portalHomeApi.listAccessible().then(function(portals){
    var section = document.getElementById('sideNavPortalsSection');
    var list = document.getElementById('sideNavPortalsList');
    portals = portals || [];
    section.classList.toggle('hidden', portals.length === 0);
    list.innerHTML = portals.map(function(p){
      return '<button type="button" class="kf-side-nav-item" data-portal-slug="' + escapeHTML(p.slug) + '" title="' + escapeHTML(p.name) + '">' +
        (p.iconName ? iconSvg(p.iconName, 21) : iconSvg('sparkle', 21)) +
        '<span class="kf-side-nav-text">' + escapeHTML(p.name) + '</span>' +
      '</button>';
    }).join('');
    list.querySelectorAll('[data-portal-slug]').forEach(function(btn){
      btn.addEventListener('click', function(){ openPortalHomeBySlug(btn.getAttribute('data-portal-slug')); });
    });
  }, function(){ /* Not server-authoritative / no server session — leave the section hidden. */ });
}
export function closePortalHomeOverlay(){
  document.getElementById('portalHomeOverlay').classList.add('hidden');
  clearPortalHash();
  currentPortal = null;
}

/* Called on hashchange AND once eagerly on initial app load (same two-call-site convention as
   openTaskFromHashIfPresent/openWhiteboardFromHashIfPresent in app.js). */
export function openPortalHomeFromHashIfPresent(){
  var slug = parsePortalSlugFromHash();
  if(!slug) return;
  openPortalHomeBySlug(slug);
}

function loadAndRenderPortalHome(){
  if(!currentPortal) return;
  var portalId = currentPortal.id;
  portalHomeApi.listAvailableForms(portalId).then(function(forms){
    currentForms = forms || [];
    renderPortalHomeForms();
  }, function(){});
  portalHomeApi.listMySubmissions(portalId).then(function(subs){
    currentRequests = subs || [];
    renderPortalHomeRequests();
  }, function(){});
  portalHomeApi.listQa(portalId).then(function(qa){
    currentQa = qa || {topics: [], entries: []};
    renderPortalHomeQa();
  }, function(){});
}

// ---- Left pane: available forms ----

function renderPortalHomeForms(){
  document.getElementById('portalHomeFormsEmpty').classList.toggle('hidden', currentForms.length > 0);
  var list = document.getElementById('portalHomeFormsList');
  list.innerHTML = currentForms.map(function(f){
    return '<div class="kf-portal-home-form-tile" data-form-group-id="' + f.formGroupId + '">' +
      iconSvg('formFillOut', 18) +
      '<span>' + escapeHTML(f.formName || 'Untitled form') + '</span>' +
    '</div>';
  }).join('');
  list.querySelectorAll('[data-form-group-id]').forEach(function(tile){
    tile.addEventListener('click', function(){ openNewPortalSubmission(tile.getAttribute('data-form-group-id')); });
  });
  hydrateIcons(list);
}

// ---- Middle pane: my requests, the status-stepper ----

function stepIndexForStatus(status){
  if(status === 'draft') return 0;
  if(status === 'submitted') return 1;
  if(status === 'inProgress') return 2;
  if(status === 'approved') return 3;
  if(status === 'rejected') return 2;
  return 0;
}
function renderStepperHTML(status){
  var current = stepIndexForStatus(status);
  var rejected = status === 'rejected';
  return '<div class="kf-portal-stepper">' + STEPPER_STEPS.map(function(label, i){
    var cls = i < current ? 'done' : (i === current ? (rejected ? 'rejected' : 'current') : '');
    var stepLabel = (rejected && i === current) ? 'Rejected' : label;
    return '<div class="kf-portal-stepper-step ' + cls + '">' +
      '<div class="kf-portal-stepper-line"></div>' +
      '<div class="kf-portal-stepper-dot"></div>' +
      '<div class="kf-portal-stepper-label">' + escapeHTML(stepLabel) + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function renderPortalHomeRequests(){
  document.getElementById('portalHomeRequestsEmpty').classList.toggle('hidden', currentRequests.length > 0);
  var list = document.getElementById('portalHomeRequestsList');
  list.innerHTML = currentRequests.map(function(r){
    return '<div class="kf-portal-request-card" data-submission-id="' + r.id + '" data-status="' + r.status + '">' +
      '<div class="kf-portal-request-name">' + escapeHTML(r.formName) + '</div>' +
      renderStepperHTML(r.status) +
    '</div>';
  }).join('');
  list.querySelectorAll('[data-submission-id]').forEach(function(card){
    card.addEventListener('click', function(){
      if(card.getAttribute('data-status') === 'draft') openExistingPortalSubmission(card.getAttribute('data-submission-id'));
    });
  });
}

// ---- Right pane: Q&A accordion ----

function renderPortalHomeQa(){
  var topics = currentQa.topics || [], entries = currentQa.entries || [];
  document.getElementById('portalHomeQaEmpty').classList.toggle('hidden', entries.length > 0);
  var topicTitleById = {};
  topics.forEach(function(t){ topicTitleById[t.id] = t.title; });

  var grouped = topics.map(function(t){ return {title: t.title, entries: entries.filter(function(e){ return e.portalTopicId === t.id; })}; })
    .filter(function(g){ return g.entries.length > 0; });
  var ungrouped = entries.filter(function(e){ return !e.portalTopicId; });
  if(ungrouped.length > 0) grouped.push({title: null, entries: ungrouped});

  var list = document.getElementById('portalHomeQaList');
  list.innerHTML = grouped.map(function(g){
    return (g.title ? '<div class="kf-portal-qa-topic">' + escapeHTML(g.title) + '</div>' : '') +
      g.entries.map(renderPortalQaEntryHTML).join('');
  }).join('');

  list.querySelectorAll('[data-qa-entry-id]').forEach(function(q){
    q.addEventListener('click', function(){
      var id = q.getAttribute('data-qa-entry-id');
      expandedQaEntryIds[id] = !expandedQaEntryIds[id];
      renderPortalHomeQa();
    });
  });
  hydrateIcons(list);
}

function renderPortalQaEntryHTML(e){
  var expanded = !!expandedQaEntryIds[e.id];
  return '<div class="kf-portal-qa-entry' + (expanded ? ' expanded' : '') + '">' +
    '<div class="kf-portal-qa-question" data-qa-entry-id="' + e.id + '">' +
      '<span>' + escapeHTML(e.question) + '</span>' +
      iconSvg('chevronRight', 14) +
    '</div>' +
    '<div class="kf-portal-qa-answer' + (expanded ? '' : ' hidden') + '">' + escapeHTML(e.answer || '') + '</div>' +
  '</div>';
}

// ---- Form fill-out detail (mirrors modals/forms-fillout.js's own shape, backed by portalHomeApi) ----

function parseFieldsJson(json){
  if(!json) return [];
  try { var parsed = JSON.parse(json); return Array.isArray(parsed) ? parsed : []; }
  catch(e){ return []; }
}
function parseAnswersJson(json){
  if(!json) return {};
  try { var parsed = JSON.parse(json); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch(e){ return {}; }
}

/* currentForms entries are PortalFormDto — id/formGroupId/formName/formStatus/fieldsJson, the last
   resolved server-side from whichever Form version is currently published for that group (see
   PortalService.ResolvePortalFormDtosAsync's own doc comment for why FieldsJson had to be added
   there: this Portal-facing surface has no Org-Admin-only formsApi access of its own to fetch it a
   different way). No submission is created until the user actually clicks Submit/Save Draft below —
   opening the picker is a pure read. */
function openNewPortalSubmission(formGroupId){
  var f = currentForms.filter(function(x){ return x.formGroupId === formGroupId; })[0];
  if(!f) return;
  detail = {mode: 'new', formVersionId: f.formVersionId, formName: f.formName, formGroupId: formGroupId, fields: parseFieldsJson(f.fieldsJson), submissionId: null, submission: null};
  renderPortalFilloutDetail();
}

function openExistingPortalSubmission(submissionId){
  var item = currentRequests.filter(function(r){ return r.id === submissionId; })[0];
  if(!item) return;
  var f = currentForms.filter(function(x){ return x.formVersionId === item.formVersionId; })[0];
  detail = {mode: 'draft', formVersionId: item.formVersionId, formName: item.formName, fields: f ? parseFieldsJson(f.fieldsJson) : [], submissionId: submissionId, submission: null};
  renderPortalFilloutDetail();
}

function renderPortalFilloutDetail(){
  document.getElementById('portalHomeFilloutTitle').textContent = detail.formName;
  document.getElementById('portalHomeFilloutMissingWarning').classList.add('hidden');
  var answers = detail.submission ? parseAnswersJson(detail.submission.answersJson) : {};
  document.getElementById('portalHomeFilloutFields').innerHTML = detail.fields.map(function(field){
    return renderAnswerInputHTML(field, answers[field.id]);
  }).join('');
  document.getElementById('portalHomeFilloutDeleteBtn').classList.toggle('hidden', detail.mode !== 'draft');
  document.getElementById('portalHomeFilloutOverlay').classList.remove('hidden');
}
export function closePortalHomeFilloutOverlay(){
  document.getElementById('portalHomeFilloutOverlay').classList.add('hidden');
  detail = null;
}

/* Mirrors modals/forms-fillout.js's own saveFormFilloutDraft — a brand-new submission
   (detail.submissionId still null) is created outright; an existing Draft is just updated. */
export function savePortalHomeFilloutDraft(){
  if(!detail) return;
  var fieldsRoot = document.getElementById('portalHomeFilloutFields');
  var answersJson = JSON.stringify(collectAllAnswers(detail.fields, fieldsRoot));

  var request = detail.submissionId
    ? portalHomeApi.updateSubmission(currentPortal.id, detail.submissionId, answersJson)
    : portalHomeApi.createSubmission(currentPortal.id, detail.formVersionId, answersJson);

  request.then(function(submission){
    _toast('Draft saved.');
    detail.submissionId = submission.id;
    detail.submission = submission;
    detail.mode = 'draft';
    closePortalHomeFilloutOverlay();
    loadAndRenderPortalHome();
  }, function(e){ _toast('Could not save draft: ' + (e.message || 'unknown error')); });
}

export function submitPortalHomeFillout(){
  if(!detail) return;
  var fieldsRoot = document.getElementById('portalHomeFilloutFields');
  var answers = collectAllAnswers(detail.fields, fieldsRoot);
  var missing = findMissingRequiredFields(detail.fields, answers);
  if(missing.length > 0){
    var el = document.getElementById('portalHomeFilloutMissingWarning');
    el.textContent = 'Please fill in: ' + missing.map(function(f){ return f.label; }).join(', ');
    el.classList.remove('hidden');
    return;
  }
  var answersJson = JSON.stringify(answers);
  var afterSaved = function(submissionId){
    portalHomeApi.submitSubmission(currentPortal.id, submissionId).then(function(){
      _toast('Submitted.');
      closePortalHomeFilloutOverlay();
      loadAndRenderPortalHome();
    }, function(e){ _toast('Could not submit: ' + (e.message || 'unknown error')); });
  };

  if(detail.submissionId){
    portalHomeApi.updateSubmission(currentPortal.id, detail.submissionId, answersJson).then(function(){
      afterSaved(detail.submissionId);
    }, function(e){ _toast('Could not save answers before submitting: ' + (e.message || 'unknown error')); });
  } else {
    portalHomeApi.createSubmission(currentPortal.id, detail.formVersionId, answersJson).then(function(submission){
      afterSaved(submission.id);
    }, function(e){ _toast('Could not create submission: ' + (e.message || 'unknown error')); });
  }
}

export function deletePortalHomeFilloutDraft(){
  if(!detail || !detail.submissionId) return;
  confirmDialog('Delete this draft?', 'This cannot be undone.', function(){
    portalHomeApi.deleteSubmission(currentPortal.id, detail.submissionId).then(function(){
      _toast('Draft deleted.');
      closePortalHomeFilloutOverlay();
      loadAndRenderPortalHome();
    }, function(e){ _toast('Could not delete draft: ' + (e.message || 'unknown error')); });
  });
}
