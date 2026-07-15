"use strict";
import { getCurrentProject } from '../store.js';
import { escapeHTML, getTaskById, getDocumentById, getRiskById, getPrincipleById, getObjectiveById } from '../utils.js';
import { RISK_LIKELIHOOD_META, RISK_IMPACT_META } from '../config.js';
import { riskScore, riskScoreBand } from '../mutations.js';
import { markdownToHtml } from '../rich-text/markdown.js';

/* =========================================================
   ENTITY REPORTS — a single generic, printable report view shared by Risks/Decisions/Principles/
   Objectives (openReportOverlay(entityType)), rather than four near-identical bespoke views. Each
   entity config below is the only per-entity-type knowledge this module needs: how to list its
   items, how (or whether) to render a ratings block, and which of its own fields are id-links to
   other entities. Printing is the platform's own window.print() — the on-screen overlay is a normal
   .kf-overlay/.kf-modal like every other read-only view in this app; @media print rules in
   styles.css isolate just this overlay's content when the browser's print dialog opens.
   ========================================================= */

function byKey(a, b){ return a.key.localeCompare(b.key, undefined, {numeric: true}); }

var ENTITY_CONFIGS = {
  risks: {
    title: 'Risks',
    getItems: function(project){ return (project.risks || []).slice().sort(byKey); },
    renderRatings: function(item){
      var score = riskScore(item);
      var band = riskScoreBand(score);
      var likelihoodLabel = (RISK_LIKELIHOOD_META[item.likelihood] || {}).label || item.likelihood;
      var impactLabel = (RISK_IMPACT_META[item.impact] || {}).label || item.impact;
      return '<div class="kf-report-ratings">' +
        '<span class="kf-risk-score-badge ' + band + '">Score ' + score + ' — ' + band.charAt(0).toUpperCase() + band.slice(1) + '</span>' +
        '<span class="kf-report-rating-detail">Likelihood: ' + escapeHTML(String(likelihoodLabel)) + '</span>' +
        '<span class="kf-report-rating-detail">Impact: ' + escapeHTML(String(impactLabel)) + '</span>' +
      '</div>';
    },
    relatedFields: [
      {label: 'Documents', idsField: 'documentIds', resolver: getDocumentById},
      {label: 'Principles', idsField: 'principleIds', resolver: getPrincipleById},
      {label: 'Objectives', idsField: 'objectiveIds', resolver: getObjectiveById},
      {label: 'Task', idField: 'taskId', resolver: getTaskById}
    ]
  },
  decisions: {
    title: 'Decisions',
    getItems: function(project){ return (project.decisions || []).slice().sort(byKey); },
    renderRatings: null,
    relatedFields: [
      {label: 'Documents', idsField: 'documentIds', resolver: getDocumentById},
      {label: 'Risks', idsField: 'riskIds', resolver: getRiskById},
      {label: 'Principles', idsField: 'principleIds', resolver: getPrincipleById},
      {label: 'Objectives', idsField: 'objectiveIds', resolver: getObjectiveById},
      {label: 'Task', idField: 'taskId', resolver: getTaskById}
    ]
  },
  principles: {
    title: 'Principles',
    getItems: function(project){ return (project.principles || []).slice().sort(byKey); },
    renderRatings: null,
    // Principle has no id-link fields at all — its only relational field is a plain external
    // documentUrl string, handled as a special case in renderRelatedEntities below.
    relatedFields: []
  },
  objectives: {
    title: 'Objectives',
    getItems: function(project){ return (project.objectives || []).slice().sort(byKey); },
    renderRatings: null,
    relatedFields: [
      {label: 'Principles', idsField: 'principleIds', resolver: getPrincipleById}
    ]
  }
};

function renderRelatedEntities(project, item, config){
  var groups = [];
  (config.relatedFields || []).forEach(function(f){
    if(f.idsField){
      var resolved = (item[f.idsField] || []).map(function(id){ return f.resolver(project, id); }).filter(Boolean);
      if(resolved.length) groups.push({label: f.label, items: resolved});
    } else if(f.idField && item[f.idField]){
      var single = f.resolver(project, item[f.idField]);
      if(single) groups.push({label: f.label, items: [single]});
    }
  });
  if(item.documentUrl){
    groups.push({label: 'Reference URL', items: [{url: item.documentUrl}]});
  }

  if(groups.length === 0){
    return '<div class="kf-report-related kf-report-related-empty">No related entities.</div>';
  }
  return '<div class="kf-report-related">' + groups.map(function(g){
    var itemsHTML = g.items.map(function(it){
      if(it.url){
        return '<a href="' + escapeHTML(it.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(it.url) + '</a>';
      }
      return '<span class="kf-dep-key">' + escapeHTML(it.key) + '</span><span class="kf-dep-title">' + escapeHTML(it.title) + '</span>';
    }).join(', ');
    return '<div class="kf-report-related-group"><span class="kf-report-related-label">' + escapeHTML(g.label) + ':</span> ' + itemsHTML + '</div>';
  }).join('') + '</div>';
}

function renderReportItem(project, item, config){
  var descHTML = item.description
    ? '<div class="kf-richtext-content">' + markdownToHtml(item.description) + '</div>'
    : '<div class="kf-report-no-desc">No description.</div>';
  var ratingsHTML = config.renderRatings ? config.renderRatings(item) : '';
  var relatedHTML = renderRelatedEntities(project, item, config);
  return '<div class="kf-report-item">' +
    '<h3 class="kf-report-item-title"><span class="kf-report-item-key">' + escapeHTML(item.key) + '</span>' + escapeHTML(item.title) + '</h3>' +
    descHTML + ratingsHTML + relatedHTML +
  '</div>';
}

export function openReportOverlay(entityType){
  var config = ENTITY_CONFIGS[entityType];
  var project = getCurrentProject();
  if(!config || !project) return;

  document.getElementById('reportTitle').textContent = project.name + ' - ' + config.title;

  var items = config.getItems(project);
  var bodyEl = document.getElementById('reportBody');
  bodyEl.innerHTML = items.length
    ? items.map(function(item){ return renderReportItem(project, item, config); }).join('')
    : '<div class="kf-health-empty">No ' + config.title.toLowerCase() + ' yet.</div>';

  document.getElementById('reportOverlay').classList.remove('hidden');
}
export function closeReportOverlay(){
  document.getElementById('reportOverlay').classList.add('hidden');
}
export function isReportOverlayOpen(){
  return !document.getElementById('reportOverlay').classList.contains('hidden');
}
export function printReport(){
  window.print();
}
