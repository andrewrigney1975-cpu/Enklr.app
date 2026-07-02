"use strict";
import { saveDB, uid, normalizeHeaderButtonVisibility } from '../storage.js';
import { PRIORITY_ORDER, PRIORITY_META } from '../config.js';

/* =========================================================
   WORKFLOW STATE MACHINE
   A project's workflow is a directed graph over its own columns:
   project.workflow = {
     nodes: { [columnId]: {x, y} },
     edges: [{id, fromColumnId, toColumnId, type: 'allowed'|'disallowed'|'conditional', message, condition}]
   }
   `condition` is only meaningful (non-null) on 'conditional' edges — see
   WORKFLOW_CONDITION_FIELDS/evaluateCondition below.
   Enforcement is opt-in per project via headerButtonVisibility.workflow
   (defaults false, unlike every other flag there, since turning it on
   newly restricts behavior that was previously unconstrained).
   ========================================================= */

export var WORKFLOW_DEFAULT_DENY_MESSAGE = 'This transition is not allowed in the current workflow.';

export var WORKFLOW_NODE_W = 200;
export var WORKFLOW_NODE_H = 70;
export var WORKFLOW_GAP_X = 120;
export var WORKFLOW_MARGIN = 40;

export function isWorkflowEnabled(project){
  if(!project) return false;
  return normalizeHeaderButtonVisibility(project.headerButtonVisibility).workflow === true;
}

/* Idempotent lazy initializer. On true first-materialization (no
   project.workflow yet) it lays out every column left-to-right and
   seeds forward-only "Allowed" edges between adjacent columns, so a
   project that never opens the editor still behaves like a normal
   linear kanban flow once enforcement is turned on. On later calls it
   only backfills nodes for columns added since — deliberately with no
   edges, so a newly added column stays isolated until the user wires
   it in by hand. Skips saveDB() when there's nothing to do, so it's
   safe to call from hot paths like dragover. */
export function ensureProjectWorkflow(project){
  var isFirst = !project.workflow;
  if(!project.workflow || typeof project.workflow !== 'object'){
    project.workflow = {nodes: {}, edges: []};
  }
  if(!project.workflow.nodes || typeof project.workflow.nodes !== 'object') project.workflow.nodes = {};
  if(!Array.isArray(project.workflow.edges)) project.workflow.edges = [];

  var missing = [];
  project.columns.forEach(function(col, idx){
    if(!project.workflow.nodes[col.id]) missing.push({col: col, idx: idx});
  });
  if(missing.length === 0 && !isFirst) return false;

  missing.forEach(function(entry){
    project.workflow.nodes[entry.col.id] = {
      x: WORKFLOW_MARGIN + entry.idx * (WORKFLOW_NODE_W + WORKFLOW_GAP_X),
      y: WORKFLOW_MARGIN
    };
  });

  if(isFirst && project.columns.length > 1){
    for(var i = 0; i < project.columns.length - 1; i++){
      project.workflow.edges.push({
        id: uid('wfedge'),
        fromColumnId: project.columns[i].id,
        toColumnId: project.columns[i + 1].id,
        type: 'allowed',
        message: null
      });
    }
  }

  saveDB();
  return true;
}

export function findWorkflowEdge(project, fromColumnId, toColumnId){
  if(!project.workflow || !Array.isArray(project.workflow.edges)) return null;
  return project.workflow.edges.filter(function(e){
    return e.fromColumnId === fromColumnId && e.toColumnId === toColumnId;
  })[0] || null;
}

/* =========================================================
   CONDITIONAL ALLOW — condition vocabulary
   A condition is a single {field, operator, value} comparison against
   the dragged task's own properties (no free-text/eval — the field and
   operator lists below are the only things a condition can ever be, so
   nothing invalid or unsafe can be constructed). Shared by the
   mutation-layer normalizer, the popover UI, and evaluateCondition.
   ========================================================= */
export var WORKFLOW_CONDITION_FIELDS = [
  {key: 'assigneeId',       label: 'Assignee',           valueKind: 'presence'},
  {key: 'releaseId',        label: 'Release',            valueKind: 'presence'},
  {key: 'typeId',           label: 'Task Type',          valueKind: 'presence'},
  {key: 'documentationUrl', label: 'Documentation URL',  valueKind: 'presence'},
  {key: 'dependencies',     label: 'Dependencies',       valueKind: 'presence-array'},
  {key: 'priority',         label: 'Priority',           valueKind: 'enum', options: PRIORITY_ORDER.map(function(p){ return {value: p, label: PRIORITY_META[p].label}; })},
  {key: 'businessValue',    label: 'Business Value',     valueKind: 'number'},
  {key: 'taskCost',         label: 'Task Cost',          valueKind: 'number'},
  {key: 'archived',         label: 'Archived',           valueKind: 'boolean'}
];

export var WORKFLOW_CONDITION_OPERATORS = {
  'presence': [
    {key: 'is_set', label: 'is set', needsValue: false},
    {key: 'is_empty', label: 'is empty', needsValue: false}
  ],
  'presence-array': [
    {key: 'is_set', label: 'has any', needsValue: false},
    {key: 'is_empty', label: 'has none', needsValue: false}
  ],
  'enum': [
    {key: 'equals', label: 'is', needsValue: true},
    {key: 'not_equals', label: 'is not', needsValue: true}
  ],
  'number': [
    {key: 'equals', label: '=', needsValue: true},
    {key: 'not_equals', label: '≠', needsValue: true},
    {key: 'greater_than', label: '>', needsValue: true},
    {key: 'less_than', label: '<', needsValue: true},
    {key: 'greater_or_equal', label: '≥', needsValue: true},
    {key: 'less_or_equal', label: '≤', needsValue: true}
  ],
  'boolean': [
    {key: 'is_true', label: 'is true', needsValue: false},
    {key: 'is_false', label: 'is false', needsValue: false}
  ]
};

export function getWorkflowConditionField(key){
  return WORKFLOW_CONDITION_FIELDS.filter(function(f){ return f.key === key; })[0] || null;
}

export var WORKFLOW_DEFAULT_CONDITION = {field: 'assigneeId', operator: 'is_set', value: null};

export function evaluateCondition(task, condition){
  if(!condition || !condition.field || !condition.operator) return true;
  var raw = task ? task[condition.field] : undefined;
  var isArrayField = Array.isArray(raw);
  switch(condition.operator){
    case 'is_set':   return isArrayField ? raw.length > 0 : (raw !== null && raw !== undefined && raw !== '');
    case 'is_empty': return isArrayField ? raw.length === 0 : (raw === null || raw === undefined || raw === '');
    case 'is_true':  return raw === true;
    case 'is_false': return raw === false;
    case 'equals':      return String(raw) === String(condition.value);
    case 'not_equals':  return String(raw) !== String(condition.value);
    case 'greater_than':     return Number(raw) > Number(condition.value);
    case 'less_than':        return Number(raw) < Number(condition.value);
    case 'greater_or_equal': return Number(raw) >= Number(condition.value);
    case 'less_or_equal':    return Number(raw) <= Number(condition.value);
    default: return true;
  }
}

/* `task` must have a `columnId` — the "from" state is always the
   task's own current column, so there's no separate fromColumnId
   parameter. A Conditional edge needs the actual task to evaluate its
   condition, which is why this takes a task rather than a column id. */
export function evaluateTransition(project, task, toColumnId){
  var fromColumnId = task.columnId;
  if(fromColumnId === toColumnId) return {allowed: true, message: null};
  if(!isWorkflowEnabled(project)) return {allowed: true, message: null};
  ensureProjectWorkflow(project);
  var edge = findWorkflowEdge(project, fromColumnId, toColumnId);
  if(!edge) return {allowed: false, message: WORKFLOW_DEFAULT_DENY_MESSAGE};
  if(edge.type === 'allowed') return {allowed: true, message: null};
  if(edge.type === 'conditional'){
    if(evaluateCondition(task, edge.condition)) return {allowed: true, message: null};
    return {allowed: false, message: edge.message || WORKFLOW_DEFAULT_DENY_MESSAGE};
  }
  return {allowed: false, message: edge.message || WORKFLOW_DEFAULT_DENY_MESSAGE};
}

/* Columns reachable in a single hop from task's current column —
   always includes that column itself. Returns every column when the
   workflow is disabled, matching today's unrestricted behavior. */
export function getReachableColumnIds(project, task){
  var fromColumnId = task.columnId;
  var set = new Set([fromColumnId]);
  if(!isWorkflowEnabled(project)){
    project.columns.forEach(function(c){ set.add(c.id); });
    return set;
  }
  ensureProjectWorkflow(project);
  project.columns.forEach(function(c){
    if(c.id === fromColumnId) return;
    if(evaluateTransition(project, task, c.id).allowed) set.add(c.id);
  });
  return set;
}
