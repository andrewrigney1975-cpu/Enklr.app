"use strict";
import { saveDB, uid, normalizeHeaderButtonVisibility } from '../storage.js';

/* =========================================================
   WORKFLOW STATE MACHINE
   A project's workflow is a directed graph over its own columns:
   project.workflow = {
     nodes: { [columnId]: {x, y} },
     edges: [{id, fromColumnId, toColumnId, type: 'allowed'|'disallowed', message}]
   }
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

export function evaluateTransition(project, fromColumnId, toColumnId){
  if(fromColumnId === toColumnId) return {allowed: true, message: null};
  if(!isWorkflowEnabled(project)) return {allowed: true, message: null};
  ensureProjectWorkflow(project);
  var edge = findWorkflowEdge(project, fromColumnId, toColumnId);
  if(edge && edge.type === 'allowed') return {allowed: true, message: null};
  if(edge && edge.type === 'disallowed') return {allowed: false, message: edge.message || WORKFLOW_DEFAULT_DENY_MESSAGE};
  return {allowed: false, message: WORKFLOW_DEFAULT_DENY_MESSAGE};
}

/* Columns reachable in a single hop from fromColumnId — always
   includes fromColumnId itself. Returns every column when the
   workflow is disabled, matching today's unrestricted behavior. */
export function getReachableColumnIds(project, fromColumnId){
  var set = new Set([fromColumnId]);
  if(!isWorkflowEnabled(project)){
    project.columns.forEach(function(c){ set.add(c.id); });
    return set;
  }
  ensureProjectWorkflow(project);
  project.columns.forEach(function(c){
    if(c.id === fromColumnId) return;
    if(evaluateTransition(project, fromColumnId, c.id).allowed) set.add(c.id);
  });
  return set;
}
