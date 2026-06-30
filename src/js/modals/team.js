"use strict";
import { ui, toast } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { iconSvg } from '../icons.js';
import { escapeHTML, renderBoard, renderAssigneeFilterChips } from '../views/board.js';
import { memberInitials } from '../date-utils.js';
import { addMember, renameMember, setMemberRole, setMemberReportsTo, removeMember, getTeamsCommitteesForMember } from '../mutations.js';
import { getMemberById } from '../utils.js';
import { confirmDialog } from './confirm.js';

export function openTeamModal(){
  var project = getCurrentProject();
  if(!project){ toast('No project selected.'); return; }
  renderMemberList();
  document.getElementById('newMemberNameInput').value = '';
  document.getElementById('teamOverlay').classList.remove('hidden');
  document.getElementById('newMemberNameInput').focus();
}
export function closeTeamModal(){
  document.getElementById('teamOverlay').classList.add('hidden');
}

export function populateVocabularyDatalist(datalistId, values){
  var list = document.getElementById(datalistId);
  list.innerHTML = '';
  (values || []).slice().sort(function(a, b){ return a.localeCompare(b, undefined, {sensitivity:'base'}); }).forEach(function(name){
    var opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  });
}

export function populateRoleOptions(project){
  populateVocabularyDatalist('memberRoleOptions', project.roles);
}

export function renderMemberList(){
  var project = getCurrentProject();
  var listEl = document.getElementById('memberList');
  listEl.innerHTML = '';
  if(!project || !project.members || project.members.length === 0){
    listEl.innerHTML = '<div class="kf-member-empty">No team members yet. Add one above.</div>';
    return;
  }
  populateRoleOptions(project);
  project.members.forEach(function(m){
    var row = document.createElement('div');
    row.className = 'kf-member-row';
    row.setAttribute('data-member-id', m.id);
    row.innerHTML =
      '<span class="kf-avatar kf-avatar-md" style="background:' + m.color + ';">' + escapeHTML(memberInitials(m.name)) + '</span>' +
      '<input type="text" class="kf-member-name-input" value="' + escapeHTML(m.name) + '" maxlength="60" aria-label="Member name">' +
      '<input type="text" class="kf-member-role-input" value="' + escapeHTML(m.role || '') + '" maxlength="60" list="memberRoleOptions" placeholder="Role" aria-label="Member role">' +
      '<button class="kf-btn kf-btn-ghost" data-action="remove-member" title="Remove from project">' + iconSvg('trash',14) + '</button>';
    var nameInput = row.querySelector('.kf-member-name-input');
    nameInput.addEventListener('change', function(){
      renameMember(project, m.id, nameInput.value);
      renderMemberList();
      renderBoard();
    });
    var roleInput = row.querySelector('.kf-member-role-input');
    roleInput.addEventListener('change', function(){
      setMemberRole(project, m.id, roleInput.value);
      renderMemberList();
    });
    row.querySelector('[data-action="remove-member"]').addEventListener('click', function(){
      confirmDialog(
        'Remove ' + m.name + '?',
        'They will be unassigned from any tickets currently assigned to them.',
        function(){
          var unassigned = removeMember(project, m.id);
          renderMemberList();
          renderBoard();
          renderAssigneeFilterChips();
          toast('Removed ' + m.name + (unassigned > 0 ? ' — unassigned from ' + unassigned + ' task(s).' : '.'));
        }
      );
    });
    listEl.appendChild(row);

    var reportsToRow = document.createElement('div');
    reportsToRow.className = 'kf-member-reportsto-row';
    var otherMembers = project.members.filter(function(other){ return other.id !== m.id; })
      .sort(function(a, b){ return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}); });
    var optionsHTML = '<option value="">No one</option>' + otherMembers.map(function(other){
      return '<option value="' + other.id + '"' + (m.reportsToId === other.id ? ' selected' : '') + '>' + escapeHTML(other.name) + '</option>';
    }).join('');
    reportsToRow.innerHTML =
      '<label for="reportsTo-' + m.id + '">Reports to</label>' +
      '<select id="reportsTo-' + m.id + '" class="kf-member-reportsto-select" aria-label="' + escapeHTML(m.name) + ' reports to">' + optionsHTML + '</select>';
    var reportsToSelect = reportsToRow.querySelector('select');
    reportsToSelect.addEventListener('change', function(){
      setMemberReportsTo(project, m.id, reportsToSelect.value || null);
      renderMemberList();
    });
    listEl.appendChild(reportsToRow);

    var memberTeams = getTeamsCommitteesForMember(project, m.id);
    if(memberTeams.length > 0){
      var teamsLine = document.createElement('div');
      teamsLine.className = 'kf-member-teams-line';
      teamsLine.textContent = 'Member of: ' + memberTeams.map(function(tc){ return tc.name; }).join(', ');
      listEl.appendChild(teamsLine);
    }
  });
}

export function addMemberFromModal(){
  var project = getCurrentProject();
  if(!project) return;
  var input = document.getElementById('newMemberNameInput');
  var name = input.value.trim();
  if(!name){ toast('Please enter a name.'); return; }
  addMember(project, name);
  input.value = '';
  renderMemberList();
  renderAssigneeFilterChips();
  input.focus();
}
