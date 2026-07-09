"use strict";
import { ui, toast } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { escapeHTML } from '../views/board.js';
import { iconSvg } from '../icons.js';
import { utcISOToLocalDisplayDate } from '../date-utils.js';
import { getPrincipleById } from '../utils.js';
import { addPrinciple, updatePrinciple, deletePrinciple } from '../mutations.js';
import { updateDocUrlOpenButtonVisibilityFor, openUrlInputInNewTab } from './documents.js';
import { confirmDialog } from './confirm.js';
import { principleApi } from '../api.js';
import { isServerAuthoritative, refreshProjectFromServer } from '../features/migration.js';

export function openPrinciplesOverlay(){
  var project = getCurrentProject();
  if(!project){ toast('No project selected.'); return; }
  ui.principlesSearchTerm = '';
  document.getElementById('principlesSearchInput').value = '';
  showPrinciplesListView();
  document.getElementById('principlesOverlay').classList.remove('hidden');
}
export function closePrinciplesOverlay(){
  document.getElementById('principlesOverlay').classList.add('hidden');
}
export function isPrinciplesOverlayOpen(){
  return !document.getElementById('principlesOverlay').classList.contains('hidden');
}

export function showPrinciplesListView(){
  ui.editingPrincipleId = null;
  document.getElementById('principlesModalTitle').textContent = 'Principles';
  document.getElementById('principlesListView').classList.remove('hidden');
  document.getElementById('principlesFormView').classList.add('hidden');
  document.getElementById('principlesListFooter').classList.remove('hidden');
  document.getElementById('principlesFormFooter').classList.add('hidden');
  renderPrinciplesList();
}

export function showPrinciplesFormView(principleId){
  var project = getCurrentProject();
  if(!project) return;
  ui.editingPrincipleId = principleId || null;
  var principle = principleId ? getPrincipleById(project, principleId) : null;

  document.getElementById('principlesModalTitle').textContent = principle ? 'Edit Principle' : 'New Principle';
  document.getElementById('principlesListView').classList.add('hidden');
  document.getElementById('principlesFormView').classList.remove('hidden');
  document.getElementById('principlesListFooter').classList.add('hidden');
  document.getElementById('principlesFormFooter').classList.remove('hidden');
  document.getElementById('deletePrincipleBtn').classList.toggle('hidden', !principle);

  document.getElementById('principleTitleInput').value = principle ? principle.title : '';
  document.getElementById('principleDescriptionInput').value = principle ? principle.description : '';
  document.getElementById('principleDocUrlInput').value = principle && principle.documentUrl ? principle.documentUrl : '';
  updateDocUrlOpenButtonVisibilityFor('principleDocUrlInput', 'principleDocUrlOpenBtn');

  var metaEl = document.getElementById('principleMetaDates');
  if(principle){
    metaEl.textContent = 'Added ' + utcISOToLocalDisplayDate(principle.dateCreated) +
      (principle.dateLastModified && principle.dateLastModified !== principle.dateCreated ? ' · Last changed ' + utcISOToLocalDisplayDate(principle.dateLastModified) : '');
    metaEl.style.display = '';
  } else {
    metaEl.textContent = '';
    metaEl.style.display = 'none';
  }
  document.getElementById('principleTitleInput').focus();
}

export function renderPrinciplesList(){
  var project = getCurrentProject();
  var listEl = document.getElementById('principlesList');
  listEl.innerHTML = '';
  if(!project) return;

  var allPrinciples = (project.principles || []).slice().sort(function(a, b){
    return a.key.localeCompare(b.key, undefined, {numeric: true});
  });

  if(allPrinciples.length === 0){
    listEl.innerHTML = '<div class="kf-releases-empty">No principles yet. Add one above to start guiding this project.</div>';
    return;
  }

  var term = ui.principlesSearchTerm.trim().toLowerCase();
  var principles = term ? allPrinciples.filter(function(p){
    var hay = [p.key, p.title, p.description].join(' ').toLowerCase();
    return hay.indexOf(term) !== -1;
  }) : allPrinciples;

  if(principles.length === 0){
    listEl.innerHTML = '<div class="kf-releases-empty">No principles match “' + escapeHTML(ui.principlesSearchTerm.trim()) + '”.</div>';
    return;
  }

  principles.forEach(function(p){
    var row = document.createElement('div');
    row.className = 'kf-release-row';
    row.setAttribute('data-principle-id', p.id);

    var metaHTML = '<span>Added ' + escapeHTML(utcISOToLocalDisplayDate(p.dateCreated)) + '</span>';

    var urlLinkHTML = p.documentUrl
      ? '<a class="kf-doc-row-link" href="' + escapeHTML(p.documentUrl) + '" target="_blank" rel="noopener noreferrer" title="Open ' + escapeHTML(p.documentUrl) + ' in a new tab" aria-label="Open document link in a new tab">' + iconSvg('externalLink', 14) + '</a>'
      : '';

    row.innerHTML =
      '<div class="kf-release-row-top">' +
        '<span class="kf-dep-key">' + escapeHTML(p.key) + '</span>' +
        '<span class="kf-release-name">' + escapeHTML(p.title) + '</span>' +
        urlLinkHTML +
      '</div>' +
      '<div class="kf-release-row-meta">' + metaHTML + '</div>';

    var urlLinkEl = row.querySelector('.kf-doc-row-link');
    if(urlLinkEl) urlLinkEl.addEventListener('click', function(e){ e.stopPropagation(); });
    row.addEventListener('click', function(){ showPrinciplesFormView(p.id); });
    listEl.appendChild(row);
  });
}

export async function savePrincipleFromModal(){
  var project = getCurrentProject();
  if(!project) return;
  var title = document.getElementById('principleTitleInput').value.trim();
  if(!title){ toast('Please enter a principle title.'); return; }

  var data = {
    title: title,
    description: document.getElementById('principleDescriptionInput').value,
    documentUrl: document.getElementById('principleDocUrlInput').value
  };

  if(isServerAuthoritative(project)){
    try {
      var editingId = ui.editingPrincipleId;
      if(editingId) await principleApi.update(project.serverProjectId, editingId, data);
      else await principleApi.create(project.serverProjectId, data);
      await refreshProjectFromServer(project.id);
      toast(editingId ? 'Principle updated.' : 'Principle created.');
      showPrinciplesListView();
    } catch(e){
      toast('Could not save principle on the server: ' + (e.message || 'unknown error'));
    }
    return;
  }

  if(ui.editingPrincipleId){
    updatePrinciple(project, ui.editingPrincipleId, data);
    toast('Principle updated.');
  } else {
    addPrinciple(project, data);
    toast('Principle created.');
  }
  showPrinciplesListView();
}

export function deletePrincipleFromModal(){
  var project = getCurrentProject();
  if(!project || !ui.editingPrincipleId) return;
  var principle = getPrincipleById(project, ui.editingPrincipleId);
  if(!principle) return;
  confirmDialog(
    'Delete ' + principle.key + '?',
    'Any objectives, risks, or decisions linking to this principle will have the link removed.',
    async function(){
      if(isServerAuthoritative(project)){
        try {
          await principleApi.remove(project.serverProjectId, principle.id);
          await refreshProjectFromServer(project.id);
          toast('Deleted ' + principle.key + '.');
          showPrinciplesListView();
        } catch(e){
          toast('Could not delete principle on the server: ' + (e.message || 'unknown error'));
        }
        return;
      }
      var unlinked = deletePrinciple(project, principle.id);
      toast('Deleted ' + principle.key + (unlinked > 0 ? ' — removed ' + unlinked + ' link(s) from objectives/risks/decisions.' : '.'));
      showPrinciplesListView();
    }
  );
}
