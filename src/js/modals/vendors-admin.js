"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../views/board.js';
import { vendorApi, isOrgAdmin } from '../api.js';
import { confirmDialog } from './confirm.js';

/* Org-Admin-only "Manage Vendors" CRUD + per-Vendor API key generate/revoke — mirrors
   modals/announcements-admin.js's shape (a small self-contained modal, list + create/edit form)
   plus modals/api-endpoints.js's generate/revoke/reveal-once key UI, applied per row instead of
   once globally. One active key per Vendor, rotate-only — generating a new key immediately
   invalidates any previous one for that Vendor, same contract as the org-wide key. */

export function openVendorsAdminModal(){
  if(!isOrgAdmin()){ toast('Only an organisation admin can manage vendors.'); return; }
  resetVendorForm();
  renderVendorsAdminList();
  document.getElementById('vendorsAdminOverlay').classList.remove('hidden');
}

export function closeVendorsAdminModal(){
  document.getElementById('vendorsAdminOverlay').classList.add('hidden');
}

function resetVendorForm(){
  document.getElementById('vendorAdminEditingId').value = '';
  document.getElementById('vendorAdminNameInput').value = '';
  document.getElementById('vendorAdminContactInput').value = '';
  document.getElementById('vendorAdminEmailInput').value = '';
  document.getElementById('vendorAdminUrlInput').value = '';
  document.getElementById('vendorAdminTaxNumberInput').value = '';
  document.getElementById('vendorAdminActiveInput').checked = true;
  document.getElementById('vendorAdminActiveField').style.display = 'none';
  document.getElementById('vendorAdminCancelEditBtn').classList.add('hidden');
  document.getElementById('vendorAdminSaveBtn').innerHTML = '<span class="kf-icon" data-icon="plus" data-size="14"></span>Add vendor';
}

function vendorContactSummary(v){
  var parts = [];
  if(v.primaryContactPerson) parts.push(v.primaryContactPerson);
  if(v.contactEmailAddress) parts.push(v.contactEmailAddress);
  if(v.contactUrl) parts.push(v.contactUrl);
  if(v.taxNumber) parts.push('Tax: ' + v.taxNumber);
  return parts.length ? parts.map(escapeHTML).join(' · ') : 'No contact details on file.';
}

function vendorKeyStatusText(v){
  if(!v.hasApiKey) return 'No API key generated yet.';
  return v.apiKeyEnabled
    ? 'An API key is active' + (v.apiKeyLastUsedAt ? ' — last used ' + new Date(v.apiKeyLastUsedAt).toLocaleString() : ' — not used yet') + '.'
    : 'The API key has been revoked.';
}

export function renderVendorsAdminList(){
  var listEl = document.getElementById('vendorsAdminList');
  listEl.innerHTML = '<div class="kf-member-empty">Loading…</div>';
  vendorApi.list().then(function(items){
    if(items.length === 0){
      listEl.innerHTML = '<div class="kf-member-empty">No vendors yet.</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach(function(v){
      var row = document.createElement('div');
      row.className = 'kf-member-row';
      row.style.flexDirection = 'column';
      row.style.alignItems = 'stretch';
      row.style.gap = '8px';
      row.setAttribute('data-vendor-row-id', v.id);
      row.innerHTML =
        '<div class="kf-orguser-row-name">' +
          '<div class="kf-orguser-display-name">' + escapeHTML(v.name) +
            (!v.isActive ? ' <span class="kf-orguser-inactive-badge">Inactive</span>' : '') +
          '</div>' +
          '<div class="kf-orguser-username">' + vendorContactSummary(v) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="kf-btn kf-btn-ghost" data-action="edit">Edit</button>' +
          '<button class="kf-btn kf-btn-ghost kf-orguser-deactivate-btn" data-action="delete">Delete</button>' +
        '</div>' +
        '<p class="kf-sso-hint" data-vendor-key-status>' + escapeHTML(vendorKeyStatusText(v)) + '</p>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="kf-btn kf-btn-secondary kf-btn-sm" data-action="generate-key">Generate new API key</button>' +
          '<button class="kf-btn kf-btn-danger kf-btn-sm" data-action="revoke-key">Revoke</button>' +
        '</div>' +
        '<div class="kf-sso-token-reveal hidden" data-vendor-key-reveal>' +
          '<input type="text" readonly data-vendor-key-output>' +
          '<p class="kf-sso-hint kf-sso-warning">Copy this now — it won\'t be shown again. Generating a new key immediately invalidates this one.</p>' +
        '</div>';

      row.querySelector('[data-action="edit"]').addEventListener('click', function(){ startEditVendor(v); });
      row.querySelector('[data-action="delete"]').addEventListener('click', function(){
        confirmDialog('Delete "' + v.name + '"?', 'This cannot be undone, and revokes its API key immediately.', function(){
          vendorApi.remove(v.id).then(function(){
            toast('Vendor deleted.');
            renderVendorsAdminList();
          }, function(e){
            toast('Could not delete vendor: ' + (e.message || 'unknown error'));
          });
        });
      });
      row.querySelector('[data-action="generate-key"]').addEventListener('click', function(){
        vendorApi.generateApiKey(v.id).then(function(result){
          var reveal = row.querySelector('[data-vendor-key-reveal]');
          row.querySelector('[data-vendor-key-output]').value = result.key;
          reveal.classList.remove('hidden');
          toast('New API key generated. Copy it now — it will not be shown again.');
          vendorApi.get(v.id).then(function(updated){
            row.querySelector('[data-vendor-key-status]').textContent = vendorKeyStatusText(updated);
          });
        }, function(e){
          toast('Could not generate an API key: ' + (e.message || 'unknown error'));
        });
      });
      row.querySelector('[data-action="revoke-key"]').addEventListener('click', function(){
        confirmDialog(
          'Revoke this vendor\'s API key?',
          'This vendor will immediately lose access to your Public Query API. This cannot be undone — a new key would need to be generated and distributed again.',
          function(){
            vendorApi.revokeApiKey(v.id).then(function(updated){
              row.querySelector('[data-vendor-key-reveal]').classList.add('hidden');
              row.querySelector('[data-vendor-key-status]').textContent = vendorKeyStatusText(updated);
              toast('API key revoked.');
            }, function(e){
              toast('Could not revoke the API key: ' + (e.message || 'unknown error'));
            });
          }
        );
      });

      listEl.appendChild(row);
    });
  }, function(e){
    listEl.innerHTML = '<div class="kf-member-empty">Could not load vendors.</div>';
    toast('Could not load vendors: ' + (e.message || 'unknown error'));
  });
}

function startEditVendor(v){
  document.getElementById('vendorAdminEditingId').value = v.id;
  document.getElementById('vendorAdminNameInput').value = v.name;
  document.getElementById('vendorAdminContactInput').value = v.primaryContactPerson || '';
  document.getElementById('vendorAdminEmailInput').value = v.contactEmailAddress || '';
  document.getElementById('vendorAdminUrlInput').value = v.contactUrl || '';
  document.getElementById('vendorAdminTaxNumberInput').value = v.taxNumber || '';
  document.getElementById('vendorAdminActiveInput').checked = v.isActive;
  document.getElementById('vendorAdminActiveField').style.display = '';
  document.getElementById('vendorAdminCancelEditBtn').classList.remove('hidden');
  document.getElementById('vendorAdminSaveBtn').innerHTML = 'Save changes';
}

export function cancelVendorEdit(){
  resetVendorForm();
}

export function saveVendorFromModal(){
  var editingId = document.getElementById('vendorAdminEditingId').value;
  var name = document.getElementById('vendorAdminNameInput').value.trim();
  if(!name){ toast('Please enter a vendor name.'); return; }

  var payload = {
    name: name,
    primaryContactPerson: document.getElementById('vendorAdminContactInput').value.trim() || null,
    contactEmailAddress: document.getElementById('vendorAdminEmailInput').value.trim() || null,
    contactUrl: document.getElementById('vendorAdminUrlInput').value.trim() || null,
    taxNumber: document.getElementById('vendorAdminTaxNumberInput').value.trim() || null
  };
  if(editingId) payload.isActive = document.getElementById('vendorAdminActiveInput').checked;

  var request = editingId ? vendorApi.update(editingId, payload) : vendorApi.create(payload);
  request.then(function(){
    toast(editingId ? 'Vendor updated.' : 'Vendor created.');
    resetVendorForm();
    renderVendorsAdminList();
  }, function(e){
    toast('Could not save vendor: ' + (e.message || 'unknown error'));
  });
}
