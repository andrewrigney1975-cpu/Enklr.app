"use strict";
import { getTasksArray, getMemberById, getTeamCommitteeById } from '../utils.js';
import { normalizeHeaderButtonVisibility } from '../storage.js';

var _escapeHTML = function(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

/* =========================================================
   PROJECT SEARCH
   Searches every listed field across each entity type, case-
   insensitively. For an item matching in multiple fields, the
   FIRST matching field in priority order (title first, then key,
   then the rest) supplies the snippet — one row per matching item,
   not one row per matching field. Principles/Objectives/Documents/
   Risks/Decisions are only searched at all when that module is
   enabled in App Settings; Tasks and Team Members are always searched.
   ========================================================= */
export var PROJECT_SEARCH_MIN_CHARS = 2;
export var PROJECT_SEARCH_SNIPPET_CONTEXT = 50;
export var PROJECT_SEARCH_GROUP_CAP = 8;

export function findFirstSearchFieldMatch(term, fields){
  var lowerTerm = term.toLowerCase();
  for(var i = 0; i < fields.length; i++){
    var f = fields[i];
    if(f.value !== null && f.value !== undefined && String(f.value).toLowerCase().indexOf(lowerTerm) !== -1){
      return f;
    }
  }
  return null;
}

/* Builds the highlighted, context-windowed snippet HTML for a single
   matched field's text. Short fields render in full (no ellipsis);
   long fields are windowed to ~PROJECT_SEARCH_SNIPPET_CONTEXT
   characters on each side of the match. All non-match text is HTML-
   escaped, and the matched substring itself (escaped too) is wrapped
   in a <mark> — so a title containing literal "<" or ">" can never
   inject markup into the results list. */
export function buildSearchSnippetHTML(text, term){
  text = String(text);
  var lowerText = text.toLowerCase(), lowerTerm = term.toLowerCase();
  var idx = lowerText.indexOf(lowerTerm);
  if(idx === -1) return _escapeHTML(text);
  var ctx = PROJECT_SEARCH_SNIPPET_CONTEXT;
  var start = Math.max(0, idx - ctx);
  var end = Math.min(text.length, idx + term.length + ctx);
  var prefix = (start > 0 ? '…' : '') + text.slice(start, idx);
  var match = text.slice(idx, idx + term.length);
  var suffix = text.slice(idx + term.length, end) + (end < text.length ? '…' : '');
  return _escapeHTML(prefix) + '<mark class="kf-search-highlight">' + _escapeHTML(match) + '</mark>' + _escapeHTML(suffix);
}

export function buildProjectSearchGroups(project, term){
  var visibility = normalizeHeaderButtonVisibility(project.headerButtonVisibility);
  var groups = [];

  function pushGroup(type, label, items, fieldsFn, sortKeyFn){
    var results = [];
    items.forEach(function(item){
      var match = findFirstSearchFieldMatch(term, fieldsFn(item));
      if(match) results.push({id: item.id, title: match.titleOverride || item.title || item.name, archived: !!item.archived, match: match, sortKey: sortKeyFn(item)});
    });
    results.sort(function(a, b){ return String(a.sortKey).localeCompare(String(b.sortKey), undefined, {numeric: true}); });
    groups.push({type: type, label: label, total: results.length, results: results.slice(0, PROJECT_SEARCH_GROUP_CAP)});
  }

  pushGroup('tasks', 'Tasks', getTasksArray(project), function(t){
    return [
      {label: null, value: t.title},
      {label: 'Key', value: t.key},
      {label: 'Description', value: t.description}
    ];
  }, function(t){ return t.key; });

  pushGroup('members', 'Team Members', project.members || [], function(m){
    return [
      {label: null, value: m.name},
      {label: 'Role', value: m.role}
    ];
  }, function(m){ return m.name; });

  if(visibility.principles){
    pushGroup('principles', 'Principles', project.principles || [], function(p){
      return [
        {label: null, value: p.title},
        {label: 'Key', value: p.key},
        {label: 'Description', value: p.description},
        {label: 'Document link', value: p.documentUrl}
      ];
    }, function(p){ return p.key; });
  }

  if(visibility.objectives){
    pushGroup('objectives', 'Objectives', project.objectives || [], function(o){
      return [
        {label: null, value: o.title},
        {label: 'Key', value: o.key},
        {label: 'Description', value: o.description}
      ];
    }, function(o){ return o.key; });
  }

  if(visibility.documents){
    pushGroup('documents', 'Documents', project.documents || [], function(d){
      return [
        {label: null, value: d.title},
        {label: 'Key', value: d.key},
        {label: 'Description', value: d.description},
        {label: 'URL', value: d.url}
      ];
    }, function(d){ return d.key; });
  }

  if(visibility.risks){
    pushGroup('risks', 'Risks', project.risks || [], function(r){
      return [
        {label: null, value: r.title},
        {label: 'Key', value: r.key},
        {label: 'Description', value: r.description},
        {label: 'Mitigations', value: r.mitigations}
      ];
    }, function(r){ return r.key; });
  }

  if(visibility.decisions){
    pushGroup('decisions', 'Decisions', project.decisions || [], function(dec){
      return [
        {label: null, value: dec.title},
        {label: 'Key', value: dec.key},
        {label: 'Description', value: dec.description},
        {label: 'Outcome', value: dec.outcome},
        {label: 'Approver', value: dec.approver}
      ];
    }, function(dec){ return dec.key; });
  }

  if(visibility.teamsCommittees){
    var tcResults = [];
    (project.teamsCommittees || []).forEach(function(tc){
      var match = findFirstSearchFieldMatch(term, [
        {label: null, value: tc.name},
        {label: 'Key', value: tc.key},
        {label: 'Description', value: tc.description}
      ]);
      if(!match) return;
      var parent = tc.parentId ? getTeamCommitteeById(project, tc.parentId) : null;
      var members = (tc.memberIds || [])
        .map(function(mid){ return getMemberById(project, mid); })
        .filter(Boolean)
        .sort(function(a, b){ return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}); });
      tcResults.push({id: tc.id, title: tc.name, archived: false, match: match, sortKey: tc.key,
        tcType: tc.type, parentName: parent ? parent.name : null, members: members});
    });
    tcResults.sort(function(a, b){ return String(a.sortKey).localeCompare(String(b.sortKey), undefined, {numeric: true}); });
    groups.push({type: 'teamsCommittees', label: 'Teams & Committees', total: tcResults.length, results: tcResults.slice(0, PROJECT_SEARCH_GROUP_CAP)});
  }

  return groups;
}
