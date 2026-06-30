"use strict";
import { getCurrentProject } from '../store.js';
import { escapeHTML } from '../views/board.js';
import { hydrateIcons } from '../icons.js';
import { TEAM_COMMITTEE_TYPES } from '../config.js';
import { PROJECT_SEARCH_MIN_CHARS, buildProjectSearchGroups, buildSearchSnippetHTML } from '../features/project-search.js';
import { openTaskModal } from './task.js';
import { openTeamModal } from './team.js';
import { openPrinciplesOverlay, showPrinciplesFormView } from './principles.js';
import { openObjectivesOverlay, showObjectivesFormView } from './objectives.js';
import { openDocumentsOverlay, showDocumentsFormView } from './documents.js';
import { openRisksOverlay, showRisksFormView } from './risks.js';
import { openDecisionsOverlay, showDecisionsFormView } from './decisions.js';
import { openTeamsCommitteesOverlay, showTeamCommitteeFormView } from './teams-committees.js';

var projectSearchDebounceId = null;

var PROJECT_SEARCH_GROUP_ICONS = {
  tasks: 'board', members: 'team', principles: 'compass', objectives: 'target',
  documents: 'ty_document', risks: 'warning', decisions: 'ty_approve',
  teamsCommittees: 'orgChart'
};

export function openProjectSearchOverlay(){
  var project = getCurrentProject();
  if(!project) return;
  document.getElementById('projectSearchInput').value = '';
  renderProjectSearchResults('');
  document.getElementById('projectSearchOverlay').classList.remove('hidden');
  document.getElementById('projectSearchInput').focus();
}

export function closeProjectSearchOverlay(){
  clearTimeout(projectSearchDebounceId);
  document.getElementById('projectSearchOverlay').classList.add('hidden');
}

export function isProjectSearchOverlayOpen(){
  return !document.getElementById('projectSearchOverlay').classList.contains('hidden');
}

export function getProjectSearchDebounceId(){ return projectSearchDebounceId; }
export function setProjectSearchDebounceId(id){ projectSearchDebounceId = id; }

function renderProjectSearchResults(rawTerm){
  var project = getCurrentProject();
  var resultsEl = document.getElementById('projectSearchResults');
  if(!project){ resultsEl.innerHTML = ''; return; }

  var term = rawTerm.trim();
  if(term.length < PROJECT_SEARCH_MIN_CHARS){
    resultsEl.innerHTML = '<div class="kf-search-empty">Type at least ' + PROJECT_SEARCH_MIN_CHARS + ' characters to search.</div>';
    return;
  }

  var groups = buildProjectSearchGroups(project, term).filter(function(g){ return g.results.length > 0; });
  if(groups.length === 0){
    resultsEl.innerHTML = '<div class="kf-search-empty">No results for "' + escapeHTML(term) + '".</div>';
    return;
  }

  resultsEl.innerHTML = groups.map(function(g){
    var rowsHTML = g.results.map(function(r){
      if(g.type === 'teamsCommittees'){
        var typePill = '<span class="kf-decision-type-pill">' + escapeHTML(TEAM_COMMITTEE_TYPES[r.tcType] || r.tcType) + '</span>';
        var parentLine = r.parentName ? '<div class="kf-search-result-snippet"><span class="kf-search-result-field-label">Parent:</span> ' + escapeHTML(r.parentName) + '</div>' : '';
        var membersLine = r.members.length > 0
          ? '<div class="kf-search-result-snippet"><span class="kf-search-result-field-label">Members:</span> ' + r.members.map(function(m){ return escapeHTML(m.name); }).join(', ') + '</div>'
          : '<div class="kf-search-result-snippet" style="color:var(--kf-text-faint);">No members</div>';
        var descSnippet = (r.match.label && r.match.label !== null)
          ? '<div class="kf-search-result-snippet"><span class="kf-search-result-field-label">' + escapeHTML(r.match.label) + ':</span> ' + buildSearchSnippetHTML(r.match.value, term) + '</div>'
          : '';
        return '<div class="kf-search-result-row" data-result-type="teamsCommittees" data-result-id="' + r.id + '">' +
          '<div class="kf-search-result-top">' +
            '<a class="kf-search-result-link" data-result-type="teamsCommittees" data-result-id="' + r.id + '">' + escapeHTML(r.title) + '</a>' +
            typePill +
          '</div>' +
          parentLine + membersLine + descSnippet +
        '</div>';
      }
      var fieldLabelHTML = r.match.label ? '<span class="kf-search-result-field-label">' + escapeHTML(r.match.label) + ':</span> ' : '';
      var snippetHTML = buildSearchSnippetHTML(r.match.value, term);
      return '<div class="kf-search-result-row" data-result-type="' + g.type + '" data-result-id="' + r.id + '">' +
        '<div class="kf-search-result-top">' +
          '<a class="kf-search-result-link" data-result-type="' + g.type + '" data-result-id="' + r.id + '">' + escapeHTML(r.title) + '</a>' +
          (r.archived ? '<span class="kf-search-archived-badge">Archived</span>' : '') +
        '</div>' +
        '<div class="kf-search-result-snippet">' + fieldLabelHTML + snippetHTML + '</div>' +
      '</div>';
    }).join('');
    var moreNote = g.total > g.results.length ? '<div class="kf-search-more-note">+' + (g.total - g.results.length) + ' more in ' + escapeHTML(g.label) + '</div>' : '';
    return '<div class="kf-search-group">' +
      '<h3 class="kf-search-group-title"><span class="kf-icon" data-icon="' + PROJECT_SEARCH_GROUP_ICONS[g.type] + '" data-size="13"></span>' + escapeHTML(g.label) + ' (' + g.total + ')</h3>' +
      rowsHTML + moreNote +
    '</div>';
  }).join('');
  hydrateIcons(resultsEl);
}

export function handleProjectSearchInput(value){
  clearTimeout(projectSearchDebounceId);
  projectSearchDebounceId = setTimeout(function(){ renderProjectSearchResults(value); }, 200);
}

export function handleProjectSearchResultClick(e){
  var link = e.target.closest('.kf-search-result-link, .kf-search-result-row');
  if(!link) return;
  e.preventDefault();
  var type = link.getAttribute('data-result-type');
  var id = link.getAttribute('data-result-id');
  if(!type || !id) return;

  var project = getCurrentProject();
  if(!project) return;
  closeProjectSearchOverlay();
  if(type === 'tasks'){
    var task = project.tasks[id];
    if(task) openTaskModal(id, task.columnId);
  } else if(type === 'members'){
    openTeamModal();
  } else if(type === 'principles'){
    openPrinciplesOverlay();
    showPrinciplesFormView(id);
  } else if(type === 'objectives'){
    openObjectivesOverlay();
    showObjectivesFormView(id);
  } else if(type === 'documents'){
    openDocumentsOverlay();
    showDocumentsFormView(id);
  } else if(type === 'risks'){
    openRisksOverlay();
    showRisksFormView(id);
  } else if(type === 'decisions'){
    openDecisionsOverlay();
    showDecisionsFormView(id);
  } else if(type === 'teamsCommittees'){
    openTeamsCommitteesOverlay();
    showTeamCommitteeFormView(id);
  }
}
