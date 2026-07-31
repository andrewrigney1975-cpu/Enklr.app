"use strict";
import { escapeHTML } from '../utils.js';

/* =========================================================
   IMPORT CENTRE — shared entity schema definitions
   Hand-authored to mirror each entity's real DB/DTO shape (same "duplicate deliberately, keep in
   sync by hand" convention as every cross-tier duplication in this app — there is no single source
   of truth generated from the backend, this file just has to be kept honest by whoever changes the
   underlying entity). Used by BOTH the Schemas tab's on-screen table and the CSV/JSON download
   buttons, so those two views of the same schema can never drift apart from each other (even though
   they can still drift from the real backend if it changes without this file being updated too).

   `required` is `true`/`false`/`'conditional'` — the third value exists because at least one field
   (Organisation Users' `email`) is nullable at the DB column level but effectively mandatory in
   practice (the service enforces it for any non-SSO account) — a flat boolean would misrepresent
   that nuance.
   ========================================================= */

export var IMPORT_ENTITY_ORDER = ['organisationUsers', 'teamMembers', 'teamsCommittees', 'portalQa'];

export var IMPORT_ENTITY_LABELS = {
  organisationUsers: 'Organisation Users',
  teamMembers: 'Team Members',
  teamsCommittees: 'Teams & Committees',
  portalQa: 'Portal Q&A'
};

export var IMPORT_SCHEMAS = {
  organisationUsers: [
    {field: 'username', type: 'string', required: true, notes: 'Must be unique within the organisation.'},
    {field: 'displayName', type: 'string', required: true, notes: ''},
    {field: 'password', type: 'string', required: true, notes: 'Minimum 8 characters. The new account must change it on first login.'},
    {field: 'email', type: 'string', required: 'conditional', notes: 'Required unless this account will only ever sign in via SSO.'}
  ],
  teamMembers: [
    {field: 'projectKey', type: 'string', required: true, notes: 'Must match an existing project in your organisation.'},
    {field: 'name', type: 'string', required: true, notes: 'Matched against an existing Organisation User by name/email where possible; a new account is created otherwise.'},
    {field: 'email', type: 'string', required: false, notes: 'Used to find-or-create the underlying Organisation User account.'},
    {field: 'role', type: 'string', required: false, notes: 'Free-text role label shown on the member.'},
    {field: 'allocatedFraction', type: 'number (0-100)', required: false, notes: 'Percentage of time allocated to this project.'},
    {field: 'reportsTo', type: 'string (username)', required: false, notes: 'Must reference another Team Member already on the same project.'},
    {field: 'isProjectAdmin', type: 'boolean', required: false, notes: 'Defaults to false.'}
  ],
  teamsCommittees: [
    {field: 'projectKey', type: 'string', required: true, notes: 'Must match an existing project in your organisation.'},
    {field: 'name', type: 'string', required: true, notes: ''},
    {field: 'type', type: '"team" or "committee"', required: true, notes: ''},
    {field: 'description', type: 'string', required: false, notes: ''},
    {field: 'parent', type: 'string (name)', required: false, notes: 'Must reference another Team/Committee already on the same project.'},
    {field: 'members', type: 'string (semicolon-separated usernames)', required: false, notes: 'Each must already be a Team Member on the same project.'}
  ],
  portalQa: [
    {field: 'portal', type: 'string (slug or name)', required: true, notes: 'Must match an existing Portal in your organisation.'},
    {field: 'question', type: 'string', required: true, notes: ''},
    {field: 'topic', type: 'string (name)', required: false, notes: 'Must reference an existing Topic on the same Portal, if given.'},
    {field: 'answer', type: 'string (markdown)', required: false, notes: ''},
    {field: 'order', type: 'number', required: false, notes: 'Defaults to appending at the end.'}
  ]
};

function requiredLabel(required){
  if(required === true) return 'Required';
  if(required === 'conditional') return 'Conditional';
  return 'Optional';
}

function requiredClass(required){
  if(required === true) return 'kf-import-required-yes';
  if(required === 'conditional') return 'kf-import-required-conditional';
  return 'kf-import-required-no';
}

export function buildSchemaTableHtml(entityKey){
  var rows = IMPORT_SCHEMAS[entityKey] || [];
  return '<table class="kf-import-schema-table">' +
    '<thead><tr><th>Column</th><th>Type</th><th>Required?</th><th>Notes</th></tr></thead>' +
    '<tbody>' + rows.map(function(r){
      return '<tr>' +
        '<td><code>' + escapeHTML(r.field) + '</code></td>' +
        '<td>' + escapeHTML(r.type) + '</td>' +
        '<td><span class="' + requiredClass(r.required) + '">' + requiredLabel(r.required) + '</span></td>' +
        '<td>' + escapeHTML(r.notes) + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table>';
}

/* CSV template: header row only, matching whatever a real import file's first line must look like —
   deliberately no example data row, so a downloaded template can't be mistaken for one already
   containing a real (if fake-looking) record someone forgets to delete before uploading it back. */
export function buildCsvTemplate(entityKey){
  var rows = IMPORT_SCHEMAS[entityKey] || [];
  return rows.map(function(r){ return r.field; }).join(',') + '\r\n';
}

export function buildJsonSchema(entityKey){
  var rows = IMPORT_SCHEMAS[entityKey] || [];
  var schema = rows.map(function(r){
    return {field: r.field, type: r.type, required: r.required === true ? true : (r.required === 'conditional' ? 'conditional' : false), notes: r.notes || undefined};
  });
  return JSON.stringify(schema, null, 2);
}
