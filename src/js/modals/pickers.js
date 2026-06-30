"use strict";
import { escapeHTML } from '../views/board.js';
import { memberInitials } from '../date-utils.js';

export function renderDocumentPickerInto(wrapId, project, selectedDocIds, excludeId){
  var wrap = document.getElementById(wrapId);
  wrap.innerHTML = '';
  var docs = (project.documents || [])
    .filter(function(d){ return d.id !== excludeId; })
    .slice().sort(function(a, b){ return a.key.localeCompare(b.key, undefined, {numeric: true}); });
  if(docs.length === 0){
    wrap.innerHTML = '<div class="kf-risk-doc-picker-empty">No documents in this project yet.</div>';
    return;
  }
  docs.forEach(function(d){
    var row = document.createElement('label');
    row.className = 'kf-risk-doc-picker-row';
    var checked = selectedDocIds.indexOf(d.id) !== -1;
    row.innerHTML =
      '<input type="checkbox" data-doc-id="' + d.id + '" ' + (checked ? 'checked' : '') + '>' +
      '<span class="kf-dep-key">' + escapeHTML(d.key) + '</span>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(d.title) + '</span>';
    wrap.appendChild(row);
  });
}
export function getCheckedDocumentIdsFrom(wrapId){
  return Array.from(document.querySelectorAll('#' + wrapId + ' input[type=checkbox]:checked')).map(function(cb){
    return cb.getAttribute('data-doc-id');
  });
}
export function renderRiskPickerInto(wrapId, project, selectedRiskIds){
  var wrap = document.getElementById(wrapId);
  wrap.innerHTML = '';
  var risks = (project.risks || []).slice().sort(function(a, b){ return a.key.localeCompare(b.key, undefined, {numeric: true}); });
  if(risks.length === 0){
    wrap.innerHTML = '<div class="kf-risk-doc-picker-empty">No risks in this project yet.</div>';
    return;
  }
  risks.forEach(function(r){
    var row = document.createElement('label');
    row.className = 'kf-risk-doc-picker-row';
    var checked = selectedRiskIds.indexOf(r.id) !== -1;
    row.innerHTML =
      '<input type="checkbox" data-risk-id="' + r.id + '" ' + (checked ? 'checked' : '') + '>' +
      '<span class="kf-dep-key">' + escapeHTML(r.key) + '</span>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(r.title) + '</span>';
    wrap.appendChild(row);
  });
}
export function getCheckedRiskIdsFrom(wrapId){
  return Array.from(document.querySelectorAll('#' + wrapId + ' input[type=checkbox]:checked')).map(function(cb){
    return cb.getAttribute('data-risk-id');
  });
}
export function renderItemPickerInto(wrapId, items, selectedIds, emptyMessage){
  var wrap = document.getElementById(wrapId);
  wrap.innerHTML = '';
  var sorted = (items || []).slice().sort(function(a, b){ return a.key.localeCompare(b.key, undefined, {numeric: true}); });
  if(sorted.length === 0){
    wrap.innerHTML = '<div class="kf-risk-doc-picker-empty">' + escapeHTML(emptyMessage || 'Nothing in this project yet.') + '</div>';
    return;
  }
  sorted.forEach(function(item){
    var row = document.createElement('label');
    row.className = 'kf-risk-doc-picker-row';
    var checked = selectedIds.indexOf(item.id) !== -1;
    row.innerHTML =
      '<input type="checkbox" data-item-id="' + item.id + '" ' + (checked ? 'checked' : '') + '>' +
      '<span class="kf-dep-key">' + escapeHTML(item.key) + '</span>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(item.title) + '</span>';
    wrap.appendChild(row);
  });
}
export function getCheckedItemIdsFrom(wrapId){
  return Array.from(document.querySelectorAll('#' + wrapId + ' input[type=checkbox]:checked')).map(function(cb){
    return cb.getAttribute('data-item-id');
  });
}
export function renderMemberPickerInto(wrapId, members, selectedIds){
  var wrap = document.getElementById(wrapId);
  wrap.innerHTML = '';
  var sorted = (members || []).slice().sort(function(a, b){ return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}); });
  if(sorted.length === 0){
    wrap.innerHTML = '<div class="kf-risk-doc-picker-empty">No team members in this project yet.</div>';
    return;
  }
  sorted.forEach(function(m){
    var row = document.createElement('label');
    row.className = 'kf-risk-doc-picker-row';
    var checked = selectedIds.indexOf(m.id) !== -1;
    row.innerHTML =
      '<input type="checkbox" data-item-id="' + m.id + '" ' + (checked ? 'checked' : '') + '>' +
      '<span class="kf-avatar kf-avatar-sm" style="background:' + m.color + ';">' + escapeHTML(memberInitials(m.name)) + '</span>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(m.name) + '</span>';
    wrap.appendChild(row);
  });
}
