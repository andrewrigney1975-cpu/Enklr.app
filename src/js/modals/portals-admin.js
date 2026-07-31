"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../views/board.js';
import { portalsApi, formsApi, chatApi, getOrgTeamsApi, getProjectDetailApi, memberApi } from '../api.js';
import { confirmDialog } from './confirm.js';
import { iconSvg, hydrateIcons } from '../icons.js';
import { ICON_PATHS } from '../config.js';
import { createRichTextEditor } from '../rich-text/editor.js';

/* Organisational Portals — Org-Admin authoring UI. Two overlays, same shape as Manage Forms
   (modals/forms-admin.js): #portalsAdminOverlay is the plain list/create picker, #portalEditOverlay
   (kf-modal-lg) is where a single Portal's Details/Access/Forms/Q&A actually get edited, one tab at
   a time. Every mutation here is a direct server round-trip followed by a full re-render of whatever
   list changed — no separate local-draft state to reconcile, matching this app's general "call API,
   then re-render from the response" style for admin surfaces like this one. */

var _toast = toast;

var adminPortals = [];
var editingPortal = null; // the full PortalDto currently open in #portalEditOverlay, or null
var editingTab = 'details';

// Lazily created on first showPortalQaAddEntryRow() call and reused for the whole app session —
// same pattern as modals/decisions.js's decisionDescEditor.
var portalQaAnswerEditor = null;
function getPortalQaAnswerEditor(){
  if(!portalQaAnswerEditor){
    portalQaAnswerEditor = createRichTextEditor(document.getElementById('portalQaEntryAnswerEditor'), document.getElementById('portalQaEntryAnswerToolbar'), { maxLength: 4000 });
  }
  return portalQaAnswerEditor;
}
var editingOrgUsers = [];
var editingOrgTeams = [];
var editingPublishedForms = []; // org-wide published FormDto list, for the "attach a form" picker
var editingTopics = [];
var editingIconName = null;
var editingTeamCandidates = []; // org-wide active user roster (memberApi.orgCandidates), for the Team tab's picker
var editingTeamMemberUserIds = []; // userIds already on the actioner project, to exclude from the picker

var STATUS_LABELS = {draft: 'Draft', published: 'Published', archived: 'Archived'};

// ---- Picker ----

export function openPortalsAdminOverlay(){
  document.getElementById('portalsAdminOverlay').classList.remove('hidden');
  hidePortalsAdminCreateRow();
  loadAndRenderPortalsAdminList();
}
export function closePortalsAdminOverlay(){
  document.getElementById('portalsAdminOverlay').classList.add('hidden');
}

function loadAndRenderPortalsAdminList(){
  portalsApi.list().then(function(portals){
    adminPortals = portals;
    renderPortalsAdminList();
  }, function(e){
    _toast('Could not load Portals: ' + (e.message || 'unknown error'));
  });
}

function renderPortalsAdminList(){
  var list = document.getElementById('portalsAdminList');
  document.getElementById('portalsAdminEmpty').classList.toggle('hidden', adminPortals.length > 0);
  list.innerHTML = adminPortals.map(function(p){
    return '<div class="kf-form-admin-row" data-portal-id="' + p.id + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(p.name) + '</span>' +
        '<span class="kf-form-status-badge kf-form-status-' + p.status + '">' + (STATUS_LABELS[p.status] || p.status) + '</span>' +
        '<span class="kf-form-admin-row-version">#!/portal/' + escapeHTML(p.slug) + '</span>' +
      '</div>' +
      (p.description ? '<div class="kf-form-admin-row-desc">' + escapeHTML(p.description) + '</div>' : '') +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-edit-portal="' + p.id + '"><span class="kf-icon" data-icon="edit" data-size="13"></span>Edit</button>' +
      '</div>' +
    '</div>';
  }).join('');
  list.querySelectorAll('[data-edit-portal]').forEach(function(btn){
    btn.addEventListener('click', function(){ openPortalEdit(btn.getAttribute('data-edit-portal')); });
  });
  hydrateIcons(list);
}

export function showPortalsAdminCreateRow(){
  document.getElementById('portalsAdminCreateRow').classList.remove('hidden');
  document.getElementById('portalsAdminNameInput').value = '';
  document.getElementById('portalsAdminNameInput').focus();
}
export function hidePortalsAdminCreateRow(){
  document.getElementById('portalsAdminCreateRow').classList.add('hidden');
}
export function createPortalFromAdmin(){
  var name = document.getElementById('portalsAdminNameInput').value.trim();
  if(!name){ _toast('Please enter a name.'); return; }
  portalsApi.create(name, null, null).then(function(portal){
    hidePortalsAdminCreateRow();
    loadAndRenderPortalsAdminList();
    openPortalEdit(portal.id);
  }, function(e){
    _toast('Could not create Portal: ' + (e.message || 'unknown error'));
  });
}

// ---- Editor (Details / Access / Forms / Q&A tabs) ----

export function openPortalEdit(portalId){
  portalsApi.get(portalId).then(function(portal){
    editingPortal = portal;
    editingTab = 'details';
    editingIconName = portal.iconName || null;
    document.getElementById('portalEditIconGrid').classList.add('hidden');
    document.getElementById('portalEditOverlay').classList.remove('hidden');
    renderPortalEditChrome();
    setPortalEditTab('details');
    // Eagerly loads and renders ALL FOUR tabs' content right away, not just the active one — so
    // switching tabs is a pure show/hide of already-populated content, never a blank panel waiting
    // on a request. (Access/Forms need their own picker data — org users/org teams/published forms
    // — loaded first, since renderPortalAccessTab/renderPortalFormsTab read from them synchronously.)
    chatApi.orgUsers().then(function(users){ editingOrgUsers = users || []; renderPortalAccessTab(); }, function(){});
    getOrgTeamsApi().then(function(teams){ editingOrgTeams = teams || []; renderPortalAccessTab(); }, function(){});
    formsApi.list().then(function(forms){
      editingPublishedForms = (forms || []).filter(function(f){ return f.status === 'published'; });
      renderPortalFormsTab();
    }, function(){});
    loadAndRenderPortalQaTab();
    loadAndRenderPortalTeamTab();
  }, function(e){
    _toast('Could not load Portal: ' + (e.message || 'unknown error'));
  });
}
export function closePortalEdit(){
  document.getElementById('portalEditOverlay').classList.add('hidden');
  editingPortal = null;
  loadAndRenderPortalsAdminList();
}

function renderPortalEditChrome(){
  var p = editingPortal;
  document.getElementById('portalEditTitle').textContent = p.name;
  var badge = document.getElementById('portalEditStatusBadge');
  badge.textContent = STATUS_LABELS[p.status] || p.status;
  badge.className = 'kf-form-status-badge kf-form-status-' + p.status;
  document.getElementById('portalEditPublishBtn').classList.toggle('hidden', p.status === 'published');
  document.getElementById('portalEditArchiveBtn').classList.toggle('hidden', p.status === 'archived');

  document.getElementById('portalEditNameInput').value = p.name;
  document.getElementById('portalEditSlugInput').value = p.slug;
  renderPortalIconPreview();
  updatePortalIconGridSelection();
  document.getElementById('portalEditDescInput').value = p.description || '';
}

/* Pure visibility toggle — every tab's own content is already loaded/rendered eagerly by
   openPortalEdit (see its own comment), so switching tabs never triggers a fetch. */
export function setPortalEditTab(tab){
  editingTab = tab;
  document.querySelectorAll('.kf-portal-edit-tab-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-portal-tab') === tab);
  });
  ['details', 'access', 'forms', 'team', 'qa'].forEach(function(t){
    var el = document.getElementById('portalEditTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if(el) el.classList.toggle('hidden', t !== tab);
  });
}

export function savePortalEditDetails(){
  if(!editingPortal) return;
  var name = document.getElementById('portalEditNameInput').value.trim();
  var slug = document.getElementById('portalEditSlugInput').value.trim();
  var description = document.getElementById('portalEditDescInput').value.trim();
  if(!name){ _toast('Please enter a name.'); return; }
  portalsApi.update(editingPortal.id, name, slug, description, editingIconName).then(function(portal){
    editingPortal = portal;
    renderPortalEditChrome();
    _toast('Portal saved.');
  }, function(e){
    _toast('Could not save Portal: ' + (e.message || 'unknown error'));
  });
}

/* Icon picker — a plain grid of every icon in the shared ICON_PATHS library (the same one every
   other icon in the app draws from; Team, Health Dashboard, etc. are already in there, so no
   separate Portal-specific icon set is needed). Built once (the option list never changes within a
   session) and reused across every Portal opened in this editor session. */
export function togglePortalIconGrid(){
  var grid = document.getElementById('portalEditIconGrid');
  var willShow = grid.classList.contains('hidden');
  grid.classList.toggle('hidden', !willShow);
  if(willShow && !grid.hasChildNodes()){
    grid.innerHTML = Object.keys(ICON_PATHS).map(function(name){
      return '<button type="button" data-icon-name="' + escapeHTML(name) + '" title="' + escapeHTML(name) + '">' + iconSvg(name, 18) + '</button>';
    }).join('');
    grid.querySelectorAll('[data-icon-name]').forEach(function(btn){
      btn.addEventListener('click', function(){ selectPortalIcon(btn.getAttribute('data-icon-name')); });
    });
  }
  updatePortalIconGridSelection();
}
function selectPortalIcon(name){
  editingIconName = name;
  renderPortalIconPreview();
  updatePortalIconGridSelection();
  document.getElementById('portalEditIconGrid').classList.add('hidden');
}
function updatePortalIconGridSelection(){
  document.querySelectorAll('#portalEditIconGrid [data-icon-name]').forEach(function(btn){
    btn.classList.toggle('selected', btn.getAttribute('data-icon-name') === editingIconName);
  });
}
function renderPortalIconPreview(){
  document.getElementById('portalEditIconPreview').innerHTML = editingIconName ? iconSvg(editingIconName, 20) : '';
}
export function publishPortalFromEdit(){
  if(!editingPortal) return;
  portalsApi.publish(editingPortal.id).then(function(portal){
    editingPortal = portal;
    renderPortalEditChrome();
    _toast('Portal published.');
  }, function(e){ _toast('Could not publish Portal: ' + (e.message || 'unknown error')); });
}
export function archivePortalFromEdit(){
  if(!editingPortal) return;
  portalsApi.archive(editingPortal.id).then(function(portal){
    editingPortal = portal;
    renderPortalEditChrome();
    _toast('Portal archived.');
  }, function(e){ _toast('Could not archive Portal: ' + (e.message || 'unknown error')); });
}
export function deletePortalFromEdit(){
  if(!editingPortal) return;
  var portal = editingPortal;
  confirmDialog(
    'Delete "' + portal.name + '"?',
    'This removes the Portal front door and its access grants/forms/Q&A. Its actioner project (and any tasks already raised there) is left untouched.',
    function(){
      portalsApi.remove(portal.id).then(function(){
        _toast('Portal deleted.');
        closePortalEdit();
      }, function(e){ _toast('Could not delete Portal: ' + (e.message || 'unknown error')); });
    }
  );
}

// ---- Access tab ----

function renderPortalAccessTab(){
  if(!editingPortal) return;
  var kindSelect = document.getElementById('portalAccessKindSelect');
  updatePortalAccessValueOptions();
  kindSelect.onchange = updatePortalAccessValueOptions;

  portalsApi.listAccessGrants(editingPortal.id).then(function(grants){
    document.getElementById('portalAccessEmpty').classList.toggle('hidden', grants.length > 0);
    var list = document.getElementById('portalAccessGrantsList');
    list.innerHTML = grants.map(function(g){
      return '<div class="kf-form-admin-row" data-grant-id="' + g.id + '">' +
        '<div class="kf-form-admin-row-main">' +
          '<span class="kf-form-admin-row-name">' + escapeHTML(portalAccessGrantLabel(g)) + '</span>' +
        '</div>' +
        '<div class="kf-form-admin-row-actions">' +
          '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-remove-grant="' + g.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Remove</button>' +
        '</div>' +
      '</div>';
    }).join('');
    list.querySelectorAll('[data-remove-grant]').forEach(function(btn){
      btn.addEventListener('click', function(){
        portalsApi.removeAccessGrant(editingPortal.id, btn.getAttribute('data-remove-grant')).then(function(){ renderPortalAccessTab(); }, function(e){ _toast('Could not remove grant: ' + (e.message || 'unknown error')); });
      });
    });
    hydrateIcons(list);
  }, function(e){ _toast('Could not load access grants: ' + (e.message || 'unknown error')); });
}

function portalAccessGrantLabel(g){
  if(g.kind === 'namedUser'){
    var u = editingOrgUsers.filter(function(x){ return x.id === g.value; })[0];
    return 'Person: ' + (u ? u.displayName : g.value);
  }
  if(g.kind === 'orgTeam'){
    var t = editingOrgTeams.filter(function(x){ return x.id === g.value; })[0];
    return 'OrgTeam: ' + (t ? t.name : g.value);
  }
  if(g.kind === 'allOrgMembers') return 'All Organisation Members';
  return 'Team/Committee: ' + g.value;
}

function updatePortalAccessValueOptions(){
  var kind = document.getElementById('portalAccessKindSelect').value;
  var valueSelect = document.getElementById('portalAccessValueSelect');
  if(kind === 'namedUser'){
    valueSelect.innerHTML = editingOrgUsers.map(function(u){ return '<option value="' + escapeHTML(u.id) + '">' + escapeHTML(u.displayName) + '</option>'; }).join('');
    valueSelect.disabled = false;
  } else if(kind === 'orgTeam'){
    valueSelect.innerHTML = editingOrgTeams.map(function(t){ return '<option value="' + escapeHTML(t.id) + '">' + escapeHTML(t.name) + '</option>'; }).join('');
    valueSelect.disabled = false;
  } else if(kind === 'allOrgMembers'){
    // No specific target to pick — the server ignores/overrides whatever value this select holds
    // for this kind (see PortalService.AddAccessGrantAsync's own comment).
    valueSelect.innerHTML = '<option value="">(applies to everyone in the org)</option>';
    valueSelect.disabled = true;
  } else {
    // No cross-project Team/Committee listing endpoint exists (each project owns its own) — a raw
    // id is entered directly here (findable from that project's Org Chart URL), rather than
    // building a whole new org-wide listing endpoint for this one, secondary access-grant kind.
    valueSelect.innerHTML = '<option value="">(enter below)</option>';
    valueSelect.disabled = false;
  }
}

export function addPortalAccessGrantFromEdit(){
  if(!editingPortal) return;
  var kind = document.getElementById('portalAccessKindSelect').value;
  var value = document.getElementById('portalAccessValueSelect').value;
  if(kind === 'teamCommittee' && !value){
    value = window.prompt('Team/Committee id (from that project\'s Org Chart URL):') || '';
  }
  // allOrgMembers has no target to choose — the portal's own id is sent as a placeholder value
  // (a real, valid Guid the client already has) purely to satisfy the request shape; the server
  // ignores it entirely and always stores the caller's OrganisationId instead.
  if(kind === 'allOrgMembers') value = editingPortal.id;
  if(!value){ _toast('Please choose who to grant access to.'); return; }
  portalsApi.addAccessGrant(editingPortal.id, kind, value).then(function(){
    renderPortalAccessTab();
    _toast('Access granted.');
  }, function(e){ _toast('Could not grant access: ' + (e.message || 'unknown error')); });
}

// ---- Forms tab ----

function renderPortalFormsTab(){
  if(!editingPortal) return;
  var attachSelect = document.getElementById('portalFormsAttachSelect');
  var byGroup = {};
  editingPublishedForms.forEach(function(f){ byGroup[f.formGroupId] = f; });
  attachSelect.innerHTML = Object.keys(byGroup).map(function(groupId){
    return '<option value="' + escapeHTML(groupId) + '">' + escapeHTML(byGroup[groupId].name) + '</option>';
  }).join('');

  portalsApi.listForms(editingPortal.id).then(function(forms){
    document.getElementById('portalFormsEmpty').classList.toggle('hidden', forms.length > 0);
    var list = document.getElementById('portalFormsList');
    list.innerHTML = forms.map(function(f){
      return '<div class="kf-form-admin-row" data-portal-form-id="' + f.id + '">' +
        '<div class="kf-form-admin-row-main">' +
          '<span class="kf-form-admin-row-name">' + escapeHTML(f.formName || 'Form') + '</span>' +
        '</div>' +
        '<div class="kf-form-admin-row-actions">' +
          '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-detach-form="' + f.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Remove</button>' +
        '</div>' +
      '</div>';
    }).join('');
    list.querySelectorAll('[data-detach-form]').forEach(function(btn){
      btn.addEventListener('click', function(){
        portalsApi.detachForm(editingPortal.id, btn.getAttribute('data-detach-form')).then(function(){ renderPortalFormsTab(); }, function(e){ _toast('Could not remove form: ' + (e.message || 'unknown error')); });
      });
    });
    hydrateIcons(list);
  }, function(e){ _toast('Could not load attached forms: ' + (e.message || 'unknown error')); });
}

export function attachPortalFormFromEdit(){
  if(!editingPortal) return;
  var formGroupId = document.getElementById('portalFormsAttachSelect').value;
  if(!formGroupId){ _toast('Please choose a form.'); return; }
  portalsApi.attachForm(editingPortal.id, formGroupId, 0).then(function(){
    renderPortalFormsTab();
    _toast('Form attached.');
  }, function(e){ _toast('Could not attach form: ' + (e.message || 'unknown error')); });
}

// ---- Team tab ----

/* The Portal's actioner Project is an ordinary Project underneath — every current Org Admin is
   auto-added as a Project Admin member of it at creation time (PortalService.CreateAsync), so this
   is just the same member-management surface every other Project already has (memberApi +
   getProjectDetailApi), scoped to the Portal's own ProjectId and surfaced right inside the Portal
   editor so an admin doesn't have to separately go find/open that project on the board. The "add"
   side is a picker over the whole org roster (memberApi.orgCandidates) rather than a name/email
   form — every candidate is already a real User, so there's nothing to fill in beyond who. */
function loadAndRenderPortalTeamTab(){
  if(!editingPortal) return;
  memberApi.orgCandidates(editingPortal.projectId).then(function(candidates){
    editingTeamCandidates = candidates || [];
    getProjectDetailApi(editingPortal.projectId).then(function(project){
      renderPortalTeamList(project.members || []);
    }, function(e){ _toast('Could not load the back-office team: ' + (e.message || 'unknown error')); });
  }, function(){ editingTeamCandidates = []; });
}

function renderPortalTeamList(members){
  editingTeamMemberUserIds = members.map(function(m){ return m.userId; });
  document.getElementById('portalTeamEmpty').classList.toggle('hidden', members.length > 0);

  var picker = document.getElementById('portalTeamUserSelect');
  var pickable = editingTeamCandidates.filter(function(c){ return editingTeamMemberUserIds.indexOf(c.id) === -1; });
  picker.innerHTML = pickable.map(function(c){
    return '<option value="' + escapeHTML(c.id) + '">' + escapeHTML(c.displayName) + '</option>';
  }).join('');

  var list = document.getElementById('portalTeamList');
  list.innerHTML = members.map(function(m){
    return '<div class="kf-form-admin-row" data-member-id="' + m.id + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(m.displayName) + (m.isProjectAdmin ? ' (Admin)' : '') + '</span>' +
        (m.email ? '<span class="kf-form-admin-row-version">' + escapeHTML(m.email) + '</span>' : '') +
      '</div>' +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-remove-team-member="' + m.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
  list.querySelectorAll('[data-remove-team-member]').forEach(function(btn){
    btn.addEventListener('click', function(){
      memberApi.remove(editingPortal.projectId, btn.getAttribute('data-remove-team-member')).then(loadAndRenderPortalTeamTab, function(e){ _toast('Could not remove team member: ' + (e.message || 'unknown error')); });
    });
  });
  hydrateIcons(list);
}

/* Adds an existing org user by name only (no email) — MemberService.CreateAsync only requires an
   email on the "no matching existing user" branch (real account creation); a candidate picked from
   orgCandidates is by definition an existing User in this org, so sending just their DisplayName
   resolves through the existing-user-match path, same as modals/team.js's own combobox-driven "Add a
   team member" flow. */
export function addPortalTeamMemberFromEdit(){
  if(!editingPortal) return;
  var picker = document.getElementById('portalTeamUserSelect');
  var userId = picker.value;
  if(!userId){ _toast('Please choose a person to add.'); return; }
  var candidate = editingTeamCandidates.filter(function(c){ return c.id === userId; })[0];
  if(!candidate) return;
  memberApi.create(editingPortal.projectId, {name: candidate.displayName}).then(function(){
    loadAndRenderPortalTeamTab();
    _toast('Team member added.');
  }, function(e){ _toast('Could not add team member: ' + (e.message || 'unknown error')); });
}

// ---- Q&A tab ----

export function showPortalQaAddTopicRow(){
  document.getElementById('portalQaAddTopicRow').classList.remove('hidden');
  document.getElementById('portalQaTopicTitleInput').value = '';
  document.getElementById('portalQaTopicTitleInput').focus();
}
export function hidePortalQaAddTopicRow(){
  document.getElementById('portalQaAddTopicRow').classList.add('hidden');
}
export function savePortalQaTopicFromEdit(){
  if(!editingPortal) return;
  var title = document.getElementById('portalQaTopicTitleInput').value.trim();
  if(!title){ _toast('Please enter a topic title.'); return; }
  portalsApi.createTopic(editingPortal.id, title, editingTopics.length).then(function(){
    hidePortalQaAddTopicRow();
    loadAndRenderPortalQaTab();
  }, function(e){ _toast('Could not add topic: ' + (e.message || 'unknown error')); });
}

export function showPortalQaAddEntryRow(){
  document.getElementById('portalQaAddEntryRow').classList.remove('hidden');
  document.getElementById('portalQaEntryQuestionInput').value = '';
  getPortalQaAnswerEditor().setMarkdown('');
  var topicSelect = document.getElementById('portalQaEntryTopicSelect');
  topicSelect.innerHTML = '<option value="">No topic</option>' + editingTopics.map(function(t){
    return '<option value="' + escapeHTML(t.id) + '">' + escapeHTML(t.title) + '</option>';
  }).join('');
  document.getElementById('portalQaEntryQuestionInput').focus();
}
export function hidePortalQaAddEntryRow(){
  document.getElementById('portalQaAddEntryRow').classList.add('hidden');
}
export function savePortalQaEntryFromEdit(){
  if(!editingPortal) return;
  var question = document.getElementById('portalQaEntryQuestionInput').value.trim();
  var answer = getPortalQaAnswerEditor().getMarkdown().trim();
  var topicId = document.getElementById('portalQaEntryTopicSelect').value || null;
  if(!question){ _toast('Please enter a question.'); return; }
  portalsApi.createQaEntry(editingPortal.id, question, answer, topicId, 0).then(function(){
    hidePortalQaAddEntryRow();
    loadAndRenderPortalQaTab();
  }, function(e){ _toast('Could not add Q&A entry: ' + (e.message || 'unknown error')); });
}

function loadAndRenderPortalQaTab(){
  if(!editingPortal) return;
  portalsApi.listTopics(editingPortal.id).then(function(topics){
    editingTopics = topics || [];
    portalsApi.listQaEntries(editingPortal.id).then(function(entries){
      renderPortalQaList(topics, entries || []);
    }, function(e){ _toast('Could not load Q&A entries: ' + (e.message || 'unknown error')); });
  }, function(e){ _toast('Could not load topics: ' + (e.message || 'unknown error')); });
}

function renderPortalQaList(topics, entries){
  document.getElementById('portalQaEmpty').classList.toggle('hidden', entries.length > 0 || topics.length > 0);
  var topicTitleById = {};
  topics.forEach(function(t){ topicTitleById[t.id] = t.title; });

  var groups = topics.map(function(t){ return {topic: t, entries: entries.filter(function(e){ return e.portalTopicId === t.id; })}; });
  var ungrouped = entries.filter(function(e){ return !e.portalTopicId; });

  var html = groups.map(renderPortalQaGroupHTML).join('') + (ungrouped.length ? renderPortalQaEntriesHTML(ungrouped) : '');
  var list = document.getElementById('portalQaList');
  list.innerHTML = html;

  list.querySelectorAll('[data-delete-qa-entry]').forEach(function(btn){
    btn.addEventListener('click', function(){
      portalsApi.deleteQaEntry(editingPortal.id, btn.getAttribute('data-delete-qa-entry')).then(loadAndRenderPortalQaTab, function(e){ _toast('Could not delete entry: ' + (e.message || 'unknown error')); });
    });
  });
  list.querySelectorAll('[data-delete-qa-topic]').forEach(function(btn){
    btn.addEventListener('click', function(){
      portalsApi.deleteTopic(editingPortal.id, btn.getAttribute('data-delete-qa-topic')).then(loadAndRenderPortalQaTab, function(e){ _toast('Could not delete topic: ' + (e.message || 'unknown error')); });
    });
  });
  hydrateIcons(list);
}

function renderPortalQaGroupHTML(group){
  return '<div class="kf-form-admin-row" style="background:var(--kf-surface-alt);">' +
    '<div class="kf-form-admin-row-main">' +
      '<span class="kf-form-admin-row-name">' + escapeHTML(group.topic.title) + '</span>' +
    '</div>' +
    '<div class="kf-form-admin-row-actions">' +
      '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-delete-qa-topic="' + group.topic.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span></button>' +
    '</div>' +
  '</div>' + renderPortalQaEntriesHTML(group.entries);
}
function renderPortalQaEntriesHTML(entries){
  return entries.map(function(e){
    return '<div class="kf-form-admin-row" style="margin-left:14px;">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(e.question) + '</span>' +
      '</div>' +
      (e.answer ? '<div class="kf-form-admin-row-desc">' + escapeHTML(e.answer) + '</div>' : '') +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-delete-qa-entry="' + e.id + '"><span class="kf-icon" data-icon="trash" data-size="13"></span>Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
