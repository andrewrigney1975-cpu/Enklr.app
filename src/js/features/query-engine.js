"use strict";
import alasql from 'alasql';
import { getTasksArray } from '../utils.js';

/* =========================================================
   QUERY ENGINE
   Read-only SQL query service for the Advanced Query tab of the Project Search modal
   (modals/project-search.js). Runs entirely client-side, against ONE project's in-memory data —
   never the server, never localStorage directly (state.db.projects[id] IS what gets persisted to
   localStorage, so reading the in-memory project object already satisfies both).

   Engine: AlaSQL (bundled via build.js's existing esbuild step into the single dist/index.html, same
   as every other dependency — still fully offline/self-contained, no CDN). This is the first runtime
   `dependency` (not `devDependency`) this frontend has ever needed — a deliberate, explicit trade of
   this repo's usual "hand-roll everything" convention for full SQL completeness (JOINs, GROUP BY,
   aggregates) on this one feature, decided with the user rather than assumed.
   ========================================================= */

export function QueryError(message){
  this.name = 'QueryError';
  this.message = message;
  this.stack = (new Error()).stack;
}
QueryError.prototype = Object.create(Error.prototype);
QueryError.prototype.constructor = QueryError;

/* Retrospectives are deliberately excluded from v1 — items[]/actionItems[] are nested arrays that
   don't flatten into one row shape the way every other entity here already does; a documented,
   easy-to-extend-later limit, not an oversight. */
var TABLE_RESOLVERS = {
  tasks: getTasksArray,
  columns: function(p){ return p.columns || []; },
  members: function(p){ return p.members || []; },
  risks: function(p){ return p.risks || []; },
  decisions: function(p){ return p.decisions || []; },
  principles: function(p){ return p.principles || []; },
  objectives: function(p){ return p.objectives || []; },
  documents: function(p){ return p.documents || []; },
  releases: function(p){ return p.releases || []; },
  taskTypes: function(p){ return p.taskTypes || []; },
  teamsCommittees: function(p){ return p.teamsCommittees || []; }
};

/* Table -> column list, purely for the "Tables & Columns" reference panel the modal renders (there's
   no other way for a user to discover queryable field names) — not used for validation, AlaSQL
   itself is the source of truth for what a query can actually reference. */
export var TABLE_SCHEMAS = {
  tasks: ['id', 'key', 'title', 'description', 'priority', 'columnId', 'dependencies', 'assigneeId',
    'releaseId', 'typeId', 'documentationUrl', 'startDate', 'endDate', 'businessValue', 'taskCost',
    'progress', 'estimatedEffort', 'actualEffort', 'archived', 'isPrivate', 'dateCreated',
    'dateLastModified', 'dateDone', 'parentTaskId'],
  columns: ['id', 'name', 'done', 'order', 'color', 'cap'],
  members: ['id', 'name', 'email', 'color', 'role', 'allocatedFraction', 'reportsToId', 'isProjectAdmin'],
  risks: ['id', 'key', 'title', 'description', 'likelihood', 'impact', 'mitigations', 'ownerId',
    'taskId', 'documentIds', 'principleIds', 'objectiveIds', 'status', 'dateToClose', 'dateClosed',
    'dateCreated', 'dateLastModified'],
  decisions: ['id', 'key', 'title', 'description', 'type', 'status', 'outcome', 'ownerId', 'approver',
    'taskId', 'documentIds', 'riskIds', 'principleIds', 'objectiveIds', 'dateCreated', 'dateLastModified'],
  principles: ['id', 'key', 'title', 'description', 'documentUrl', 'dateCreated', 'dateLastModified'],
  objectives: ['id', 'key', 'title', 'description', 'principleIds', 'dateCreated', 'dateLastModified'],
  documents: ['id', 'key', 'title', 'url', 'description', 'ownerId', 'taskId', 'relatedDocumentIds',
    'dateCreated', 'dateLastModified'],
  releases: ['id', 'name', 'status', 'ownerId', 'startDate', 'endDate', 'dateCreated', 'dateLastModified'],
  taskTypes: ['id', 'name', 'iconName'],
  teamsCommittees: ['id', 'key', 'name', 'description', 'type', 'parentId', 'memberIds', 'dateCreated', 'dateLastModified']
};

/* Belt-and-suspenders safety backstop, independent of AlaSQL's own behavior — AlaSQL does NOT reject
   DROP/DELETE/etc. on its own (confirmed: `DROP TABLE tasks` executes silently against the in-memory
   table registry otherwise), so this is the actual guarantee, not a redundant check. Runs on the raw
   query text before AlaSQL ever sees it. */
var FORBIDDEN_PATTERN = /\b(CREATE|DELETE|DROP|INSERT|UPDATE|ALTER|TRUNCATE|ATTACH|DETACH|GRANT|REVOKE)\b/i;

export function executeQuery(project, sql){
  if(!project) throw new QueryError('No project selected.');
  if(!sql || !sql.trim()) throw new QueryError('Enter a query.');
  if(FORBIDDEN_PATTERN.test(sql)){
    throw new QueryError('CREATE, DELETE, DROP, and other write/schema operations are not permitted — this is a read-only query tool.');
  }

  // Fresh table set every call — never let one query's data linger into the next. Never touches
  // AlaSQL's table registry via a literal CREATE TABLE statement (irrelevant here since we assign
  // .data directly on the database object) — that's how "no CREATE" is satisfied structurally, not
  // just by the regex above.
  var db = alasql.databases[alasql.useid];
  db.tables = {};
  Object.keys(TABLE_RESOLVERS).forEach(function(name){
    db.tables[name] = { data: TABLE_RESOLVERS[name](project) };
  });

  var rows;
  try {
    rows = alasql(sql);
  } catch(e){
    throw new QueryError(e && e.message ? e.message : 'Invalid query.');
  }
  if(!Array.isArray(rows)){
    throw new QueryError('Only SELECT queries are supported.');
  }

  var columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns: columns, rows: rows };
}
