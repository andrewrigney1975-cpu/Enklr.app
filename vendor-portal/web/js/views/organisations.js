"use strict";

import { api } from '../api.js';
import { hydrateIcons } from '../icons.js';
import { formatDate, escapeHtml } from '../format.js';

export async function renderOrganisations(root){
  root.innerHTML = '<div class="kf-view"><p style="color:var(--kf-text-faint);">Loading…</p></div>';
  var orgs = await api.get('/organisations');

  function draw(){
    var rows = orgs.map(function(o){
      return '<tr>' +
        '<td>' + escapeHtml(o.name) + '</td>' +
        '<td>' + o.active_user_count + ' active / ' + o.total_user_count + ' total</td>' +
        '<td>' + escapeHtml(o.org_admins || '') + '</td>' +
        '<td>' + o.active_contract_count + '</td>' +
        '<td>' + formatDate(o.created_at) + '</td>' +
        '<td>' +
          '<button type="button" class="kf-pill kf-entitlement-toggle-btn kf-pill-' + (o.ai_assistant_enabled ? 'active' : 'draft') + '" data-org-id="' + o.id + '" data-enabled="' + (o.ai_assistant_enabled ? '1' : '0') + '">' +
            (o.ai_assistant_enabled ? 'Enabled' : 'Disabled') +
          '</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    root.innerHTML =
      '<div class="kf-view">' +
        '<div class="kf-view-header"><h1 class="kf-view-title">Organisations</h1></div>' +
        '<div class="kf-panel">' +
          (rows
            ? '<table class="kf-table"><thead><tr><th>Name</th><th>Users</th><th>Organisation Admins</th><th>Active contracts</th><th>Created</th><th>AI Assistant</th></tr></thead><tbody>' + rows + '</tbody></table>'
            : '<div class="kf-table-empty">No organisations found.</div>') +
        '</div>' +
      '</div>';

    hydrateIcons(root);

    root.querySelectorAll('.kf-entitlement-toggle-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var orgId = btn.getAttribute('data-org-id');
        var nextEnabled = btn.getAttribute('data-enabled') !== '1';
        btn.disabled = true;
        api.put('/organisations/' + orgId + '/entitlements/ai_assistant', { enabled: nextEnabled })
          .then(function(){
            var org = orgs.find(function(o){ return o.id === orgId; });
            if(org) org.ai_assistant_enabled = nextEnabled;
            draw();
          })
          .catch(function(){
            btn.disabled = false;
          });
      });
    });
  }

  draw();
}
