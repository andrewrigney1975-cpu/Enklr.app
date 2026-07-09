"use strict";
import { ui, toast } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { escapeHTML, renderBoard } from '../views/board.js';
import { memberInitials, utcISOToLocalDateValue, localDateValueToUTCISO, utcISOToLocalDisplayDate } from '../date-utils.js';
import { getMemberById, getTasksArray, getReleaseById } from '../utils.js';
import { addRelease, updateRelease, deleteRelease, normalizeReleaseStatus, getReleaseStatusMeta } from '../mutations.js';
import { confirmDialog } from './confirm.js';
import { releaseApi } from '../api.js';
import { isServerAuthoritative, refreshProjectFromServer } from '../features/migration.js';

function isoToDateOnly(iso){ return iso ? iso.slice(0, 10) : null; }

export function openReleasesOverlay(){
  var project = getCurrentProject();
  if(!project){ toast('No project selected.'); return; }
  showReleasesListView();
  document.getElementById('releasesOverlay').classList.remove('hidden');
}
export function closeReleasesOverlay(){
  document.getElementById('releasesOverlay').classList.add('hidden');
}
export function isReleasesOverlayOpen(){
  return !document.getElementById('releasesOverlay').classList.contains('hidden');
}

export function showReleasesListView(){
  ui.editingReleaseId = null;
  document.getElementById('releasesModalTitle').textContent = 'Releases';
  document.getElementById('releasesListView').classList.remove('hidden');
  document.getElementById('releasesFormView').classList.add('hidden');
  document.getElementById('releasesListFooter').classList.remove('hidden');
  document.getElementById('releasesFormFooter').classList.add('hidden');
  renderReleasesList();
}

export function showReleasesFormView(releaseId){
  var project = getCurrentProject();
  if(!project) return;
  ui.editingReleaseId = releaseId || null;
  var release = releaseId ? getReleaseById(project, releaseId) : null;

  document.getElementById('releasesModalTitle').textContent = release ? 'Edit Release' : 'New Release';
  document.getElementById('releasesListView').classList.add('hidden');
  document.getElementById('releasesFormView').classList.remove('hidden');
  document.getElementById('releasesListFooter').classList.add('hidden');
  document.getElementById('releasesFormFooter').classList.remove('hidden');
  document.getElementById('deleteReleaseBtn').classList.toggle('hidden', !release);

  document.getElementById('releaseNameInput').value = release ? release.name : '';
  document.getElementById('releaseStatusSelect').value = release ? normalizeReleaseStatus(release.status) : 'pending';
  populateReleaseOwnerSelect(project, release ? release.ownerId : null);
  document.getElementById('releaseStartDateInput').value = release ? utcISOToLocalDateValue(release.startDate) : '';
  document.getElementById('releaseEndDateInput').value = release ? utcISOToLocalDateValue(release.endDate) : '';
  document.getElementById('releaseNameInput').focus();
}

function populateReleaseOwnerSelect(project, currentOwnerId){
  var sel = document.getElementById('releaseOwnerSelect');
  sel.innerHTML = '<option value="">Unassigned</option>';
  (project.members || []).forEach(function(m){
    var opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
  sel.value = currentOwnerId || '';
}

function renderReleasesList(){
  var project = getCurrentProject();
  var listEl = document.getElementById('releasesList');
  listEl.innerHTML = '';
  if(!project) return;

  var releases = (project.releases || []).slice().sort(function(a, b){
    return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
  });

  if(releases.length === 0){
    listEl.innerHTML = '<div class="kf-releases-empty">No releases yet. Create one above to start grouping tasks by release.</div>';
    return;
  }

  releases.forEach(function(r){
    var owner = getMemberById(project, r.ownerId);
    var statusMeta = getReleaseStatusMeta(r.status);
    var taskCount = getTasksArray(project).filter(function(t){ return t.releaseId === r.id; }).length;

    var row = document.createElement('div');
    row.className = 'kf-release-row';
    row.setAttribute('data-release-id', r.id);

    var dateRangeText = '';
    if(r.startDate || r.endDate){
      dateRangeText = (r.startDate ? utcISOToLocalDisplayDate(r.startDate) : '—') + ' – ' + (r.endDate ? utcISOToLocalDisplayDate(r.endDate) : '—');
    }

    var metaHTML = '';
    if(owner){
      metaHTML += '<span class="kf-avatar kf-avatar-sm" style="background:' + owner.color + ';">' + escapeHTML(memberInitials(owner.name)) + '</span><span>' + escapeHTML(owner.name) + '</span>';
    } else {
      metaHTML += '<span>Unassigned</span>';
    }
    if(dateRangeText) metaHTML += '<span>' + escapeHTML(dateRangeText) + '</span>';
    metaHTML += '<span class="kf-release-task-count">' + taskCount + ' task' + (taskCount === 1 ? '' : 's') + '</span>';

    row.innerHTML =
      '<div class="kf-release-row-top">' +
        '<span class="kf-release-name">' + escapeHTML(r.name) + '</span>' +
        '<span class="kf-release-status-pill ' + normalizeReleaseStatus(r.status) + '">' + escapeHTML(statusMeta.label) + '</span>' +
      '</div>' +
      '<div class="kf-release-row-meta">' + metaHTML + '</div>';

    row.addEventListener('click', function(){ showReleasesFormView(r.id); });
    listEl.appendChild(row);
  });
}

export async function saveReleaseFromModal(){
  var project = getCurrentProject();
  if(!project) return;
  var name = document.getElementById('releaseNameInput').value.trim();
  if(!name){ toast('Please enter a release name.'); return; }

  var startISO = localDateValueToUTCISO(document.getElementById('releaseStartDateInput').value);
  var endISO = localDateValueToUTCISO(document.getElementById('releaseEndDateInput').value);
  if(startISO && endISO && new Date(endISO).getTime() < new Date(startISO).getTime()){
    toast('End date cannot be before the start date.');
    return;
  }

  var data = {
    name: name,
    status: document.getElementById('releaseStatusSelect').value,
    ownerId: document.getElementById('releaseOwnerSelect').value || null,
    startDate: startISO,
    endDate: endISO
  };

  if(isServerAuthoritative(project)){
    try {
      var editingId = ui.editingReleaseId;
      var body = {name: data.name, status: data.status, ownerId: data.ownerId, startDate: isoToDateOnly(data.startDate), endDate: isoToDateOnly(data.endDate)};
      if(editingId) await releaseApi.update(project.serverProjectId, editingId, body);
      else await releaseApi.create(project.serverProjectId, body);
      await refreshProjectFromServer(project.id);
      renderBoard();
      toast(editingId ? 'Release updated.' : 'Release created.');
      showReleasesListView();
    } catch(e){
      toast('Could not save release on the server: ' + (e.message || 'unknown error'));
    }
    return;
  }

  if(ui.editingReleaseId){
    updateRelease(project, ui.editingReleaseId, data);
    toast('Release updated.');
  } else {
    addRelease(project, data);
    toast('Release created.');
  }
  renderBoard();
  showReleasesListView();
}

export function deleteReleaseFromModal(){
  var project = getCurrentProject();
  if(!project || !ui.editingReleaseId) return;
  var release = getReleaseById(project, ui.editingReleaseId);
  if(!release) return;
  confirmDialog(
    'Delete ' + release.name + '?',
    'Any tasks currently assigned to this release will be unassigned.',
    async function(){
      if(isServerAuthoritative(project)){
        try {
          await releaseApi.remove(project.serverProjectId, release.id);
          await refreshProjectFromServer(project.id);
          renderBoard();
          toast('Deleted ' + release.name + '.');
          showReleasesListView();
        } catch(e){
          toast('Could not delete release on the server: ' + (e.message || 'unknown error'));
        }
        return;
      }
      var unassigned = deleteRelease(project, release.id);
      renderBoard();
      toast('Deleted ' + release.name + (unassigned > 0 ? ' — unassigned from ' + unassigned + ' task(s).' : '.'));
      showReleasesListView();
    }
  );
}
