"use strict";

/* =========================================================
   FORM WORKFLOW RUNTIME ENGINE (Enterprise Forms & Workflow, Phase 4)

   A form VERSION's own workflow graph lives in its WorkflowJson column (opaque, server-unvalidated —
   see Domain/Entities/Form.cs's own doc comment), shaped:
     {nodes: [{id, x, y, type: 'start'|'author'|'approval'|'end', label,
               authorGates: [...], approverGates: [...], approvalMode: 'any'|'all'}],
      edges: [{id, fromNodeId, toNodeId}]}
   Unlike the Board-Column Workflow (features/workflow-engine.js), a Form Workflow's nodes ARE the
   primary entities — self-contained, with no external id space to remap on clone (see
   FormService.CloneAsync's own doc comment) — and there is exactly one edge TYPE (a plain
   transition), no Allowed/Disallowed/Conditional distinction, since gating happens at the NODE
   (who may author/approve), not the edge.

   Gates: {kind: 'userType', value: 'teamMember'|'projectAdmin'|'orgAdmin'} or
          {kind: 'namedUser', value: userId}
   authorGates/approverGates are OR'd together (any one satisfied gate is enough to act) — quorum
   (requiring ALL of them) only applies to approverGates on a node with approvalMode:'all', via
   isNodeApprovalComplete below, not to whether a given user may act in the first place.

   This module is pure and has no DOM/API access, deliberately — same "engine has no side effects,
   caller decides what to persist" split as features/workflow-engine.js. Unlike that module, this one
   cannot check a live DB (no ProjectMembers query) — the caller (Phase 5's fill-out UI) supplies the
   acting user's already-resolved role flags, the same isOrgAdmin()/isProjectAdmin() decisions
   src/js/api.js's own JWT-decode helpers already make for UI-gating elsewhere in this app.
   ========================================================= */

export function parseFormWorkflow(workflowJson){
  if(!workflowJson) return {nodes: [], edges: []};
  try {
    var parsed = JSON.parse(workflowJson);
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch(e){
    return {nodes: [], edges: []};
  }
}

export function findWorkflowNode(workflow, nodeId){
  return (workflow.nodes || []).filter(function(n){ return n.id === nodeId; })[0] || null;
}
export function findStartNode(workflow){
  return (workflow.nodes || []).filter(function(n){ return n.type === 'start'; })[0] || null;
}
export function outgoingEdge(workflow, nodeId){
  return (workflow.edges || []).filter(function(e){ return e.fromNodeId === nodeId; })[0] || null;
}

export function gateKey(gate){ return gate.kind + ':' + gate.value; }

/* Deny-by-default: an unrecognized gate kind/value, a null actingUser, or an empty gates array never
   satisfies anything — same convention as evaluateTransition's own default-deny in
   features/workflow-engine.js. 'projectAdmin'/'teamMember' both fall through from a higher tier the
   same way this app's other permission checks already do (an Org Admin satisfies every lower-tier
   gate too) — see root CLAUDE.md's own note on isOrgAdmin()/isProjectAdmin() being independently
   re-derived, never assumed additive, at every real enforcement point; this mirrors that shape for
   consistency even though this module itself has no DB access to enforce anything server-side yet. */
export function userSatisfiesGate(gate, actingUser){
  if(!gate || !actingUser) return false;
  if(gate.kind === 'namedUser') return !!actingUser.id && actingUser.id === gate.value;
  if(gate.kind === 'userType'){
    if(gate.value === 'orgAdmin') return !!actingUser.isOrgAdmin;
    if(gate.value === 'projectAdmin') return !!actingUser.isProjectAdmin || !!actingUser.isOrgAdmin;
    if(gate.value === 'teamMember') return !!actingUser.isProjectMember || !!actingUser.isProjectAdmin || !!actingUser.isOrgAdmin;
  }
  return false;
}

export function matchingGateKeys(gates, actingUser){
  return (gates || []).filter(function(g){ return userSatisfiesGate(g, actingUser); }).map(gateKey);
}

export function userSatisfiesAnyGate(gates, actingUser){
  return matchingGateKeys(gates, actingUser).length > 0;
}

/* Whether a Approval node's quorum is fully met given its own approvalMode and the submission's trail
   so far. ANY mode: at least one 'approved' entry at this node. ALL mode: every gate configured on
   the node (each treated as one required "slot", per this Phase's own approved plan) has at least
   one trail entry whose satisfiedGateKeys covers it — an empty approverGates list can never complete
   (deny-by-default), matching every other gate check in this module. */
export function isNodeApprovalComplete(node, trail){
  if(!node || node.type !== 'approval') return true;
  var entries = (trail || []).filter(function(t){ return t.nodeId === node.id && t.action === 'approved'; });
  if(node.approvalMode === 'all'){
    var required = (node.approverGates || []).map(gateKey);
    if(required.length === 0) return false;
    var satisfied = {};
    entries.forEach(function(e){ (e.satisfiedGateKeys || []).forEach(function(k){ satisfied[k] = true; }); });
    return required.every(function(k){ return satisfied[k]; });
  }
  return entries.length > 0;
}

/* The single entry point deciding whether actingUser may perform `action` ('author'|'approve'|
   'reject') on a submission RIGHT NOW, given the form version's workflow and the submission's own
   CurrentNodeId. Deny-by-default throughout, same {allowed, message} shape as
   features/workflow-engine.js's evaluateTransition — a caller (Phase 5) uses this to decide whether
   to even show the action, and again as the authoritative check immediately before recording it. */
export function evaluateFormAction(formVersion, submission, actingUser, action){
  var workflow = parseFormWorkflow(formVersion ? formVersion.workflowJson : null);
  if(workflow.nodes.length === 0) return {allowed: false, message: 'This form has no workflow configured.'};
  var node = (submission && submission.currentNodeId ? findWorkflowNode(workflow, submission.currentNodeId) : null) || findStartNode(workflow);
  if(!node) return {allowed: false, message: 'This form’s workflow has no starting point.'};

  if(action === 'author'){
    if(node.type !== 'author') return {allowed: false, message: 'This submission is not currently awaiting authoring.'};
    if(!userSatisfiesAnyGate(node.authorGates, actingUser)) return {allowed: false, message: 'You are not permitted to submit this form.'};
    return {allowed: true, message: null, node: node};
  }
  if(action === 'approve' || action === 'reject'){
    if(node.type !== 'approval') return {allowed: false, message: 'This submission is not currently awaiting approval.'};
    if(!userSatisfiesAnyGate(node.approverGates, actingUser)) return {allowed: false, message: 'You are not permitted to act on this submission.'};
    return {allowed: true, message: null, node: node};
  }
  return {allowed: false, message: 'Unknown action.'};
}

/* Builds the ApprovalTrailJson entry to append AFTER evaluateFormAction has already confirmed
   actingUser may act — kept as a separate step (not folded into evaluateFormAction) so a caller can
   evaluate speculatively (e.g. to decide whether to even render an Approve button) without committing
   anything. satisfiedGateKeys records exactly which of the node's own gates this actor matched at
   the moment of acting — the only way isNodeApprovalComplete's ALL-mode quorum check can later tell
   which "slot" a past approval filled, since the trail itself never stores role flags. */
export function buildApprovalTrailEntry(node, actingUser, action, comment){
  var gates = action === 'author' ? node.authorGates : node.approverGates;
  return {
    nodeId: node.id,
    actorUserId: actingUser.id,
    action: action,
    satisfiedGateKeys: matchingGateKeys(gates, actingUser),
    comment: comment || null,
    timestamp: new Date().toISOString()
  };
}

/* What the submission's CurrentNodeId should become after appending a trail entry for `action` at
   `node`. A 'reject' never advances (the caller is expected to set the submission's own Status to
   'rejected' itself — this function only knows about node transitions, not submission-level status).
   An 'author' node always advances immediately (a single satisfied gate is enough, no quorum
   concept for authoring). An 'approval' node only advances once isNodeApprovalComplete says so —
   an ALL-mode node still waiting on other approvers stays put. A node with no outgoing edge (a
   dead-end drawn by mistake, or deliberately the graph's own terminal 'end' node) also stays put. */
export function computeNextNodeId(formVersion, node, action, trail){
  if(action === 'reject') return node.id;
  var workflow = parseFormWorkflow(formVersion ? formVersion.workflowJson : null);
  if(node.type === 'author'){
    var edge = outgoingEdge(workflow, node.id);
    return edge ? edge.toNodeId : node.id;
  }
  if(node.type === 'approval'){
    if(!isNodeApprovalComplete(node, trail)) return node.id;
    var edge2 = outgoingEdge(workflow, node.id);
    return edge2 ? edge2.toNodeId : node.id;
  }
  return node.id;
}
