/* Pure unit coverage for features/form-workflow-engine.js — no DOM/JSDOM needed, since the module
   itself never touches the document (see its own doc comment). Run directly with
   `node form_workflow_engine_test.js` from tests/. */
const path = require('path');

function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

(async () => {
  const mod = await import(path.join('..', 'src', 'js', 'features', 'form-workflow-engine.js').replace(/\\/g, '/'));
  const {
    parseFormWorkflow, userSatisfiesGate, userSatisfiesAnyGate, isNodeApprovalComplete,
    evaluateFormAction, buildApprovalTrailEntry, computeNextNodeId
  } = mod;

  // ---- parseFormWorkflow: defensive parsing --------------------------------
  log('parseFormWorkflow: null json -> empty graph', JSON.stringify(parseFormWorkflow(null)) === '{"nodes":[],"edges":[]}');
  log('parseFormWorkflow: malformed json -> empty graph, no throw', JSON.stringify(parseFormWorkflow('{not json')) === '{"nodes":[],"edges":[]}');
  log('parseFormWorkflow: non-array nodes/edges coerced to []', JSON.stringify(parseFormWorkflow('{"nodes":"x","edges":null}')) === '{"nodes":[],"edges":[]}');

  // ---- userSatisfiesGate: tier fall-through ---------------------------------
  var orgAdmin = {id: 'u1', isOrgAdmin: true, isProjectAdmin: false, isProjectMember: true};
  var projectAdmin = {id: 'u2', isOrgAdmin: false, isProjectAdmin: true, isProjectMember: true};
  var teamMember = {id: 'u3', isOrgAdmin: false, isProjectAdmin: false, isProjectMember: true};
  var stranger = {id: 'u4', isOrgAdmin: false, isProjectAdmin: false, isProjectMember: false};

  log('userSatisfiesGate: orgAdmin gate satisfied by an Org Admin', userSatisfiesGate({kind:'userType', value:'orgAdmin'}, orgAdmin) === true);
  log('userSatisfiesGate: orgAdmin gate NOT satisfied by a plain Project Admin', userSatisfiesGate({kind:'userType', value:'orgAdmin'}, projectAdmin) === false);
  log('userSatisfiesGate: projectAdmin gate satisfied by an Org Admin (higher tier falls through)', userSatisfiesGate({kind:'userType', value:'projectAdmin'}, orgAdmin) === true);
  log('userSatisfiesGate: projectAdmin gate satisfied by a Project Admin', userSatisfiesGate({kind:'userType', value:'projectAdmin'}, projectAdmin) === true);
  log('userSatisfiesGate: projectAdmin gate NOT satisfied by a plain Team Member', userSatisfiesGate({kind:'userType', value:'projectAdmin'}, teamMember) === false);
  log('userSatisfiesGate: teamMember gate satisfied by every tier including a stranger with isProjectMember=false is NOT satisfied', userSatisfiesGate({kind:'userType', value:'teamMember'}, stranger) === false);
  log('userSatisfiesGate: teamMember gate satisfied by a plain Team Member', userSatisfiesGate({kind:'userType', value:'teamMember'}, teamMember) === true);
  log('userSatisfiesGate: namedUser gate matches only the exact id', userSatisfiesGate({kind:'namedUser', value:'u3'}, teamMember) === true);
  log('userSatisfiesGate: namedUser gate rejects a different id', userSatisfiesGate({kind:'namedUser', value:'u3'}, orgAdmin) === false);
  log('userSatisfiesGate: unrecognized gate kind denies (deny-by-default)', userSatisfiesGate({kind:'bogus', value:'x'}, orgAdmin) === false);
  log('userSatisfiesGate: null actingUser denies', userSatisfiesGate({kind:'userType', value:'teamMember'}, null) === false);

  log('userSatisfiesAnyGate: empty gates array denies everyone (deny-by-default)', userSatisfiesAnyGate([], orgAdmin) === false);
  log('userSatisfiesAnyGate: OR semantics — satisfies if ANY gate matches', userSatisfiesAnyGate([{kind:'namedUser', value:'nobody'}, {kind:'userType', value:'teamMember'}], teamMember) === true);

  // ---- A small linear workflow used across the evaluateFormAction cases below ----
  function linearWorkflow(authorGates, approverGates, approvalMode){
    return JSON.stringify({
      nodes: [
        {id: 'n_start', type: 'start', label: 'Start'},
        {id: 'n_author', type: 'author', label: 'Submit', authorGates: authorGates},
        {id: 'n_approve', type: 'approval', label: 'Approve', approverGates: approverGates, approvalMode: approvalMode},
        {id: 'n_end', type: 'end', label: 'Done'}
      ],
      edges: [
        {id: 'e1', fromNodeId: 'n_start', toNodeId: 'n_author'},
        {id: 'e2', fromNodeId: 'n_author', toNodeId: 'n_approve'},
        {id: 'e3', fromNodeId: 'n_approve', toNodeId: 'n_end'}
      ]
    });
  }

  // ---- evaluateFormAction: author gate pass/fail ----------------------------
  {
    var fv = {workflowJson: linearWorkflow([{kind:'userType', value:'teamMember'}], [{kind:'userType', value:'projectAdmin'}], 'any')};
    var sub = {currentNodeId: 'n_author'};
    var passResult = evaluateFormAction(fv, sub, teamMember, 'author');
    var failResult = evaluateFormAction(fv, sub, stranger, 'author');
    log('evaluateFormAction: author gate PASS for a satisfying user', passResult.allowed === true, JSON.stringify(passResult));
    log('evaluateFormAction: author gate FAIL for a non-satisfying user', failResult.allowed === false, JSON.stringify(failResult));

    var wrongNode = evaluateFormAction(fv, {currentNodeId: 'n_approve'}, teamMember, 'author');
    log('evaluateFormAction: "author" action rejected when current node is not an author node', wrongNode.allowed === false);

    var missingWorkflow = evaluateFormAction({workflowJson: null}, sub, teamMember, 'author');
    log('evaluateFormAction: no workflow at all -> denied with a clear message', missingWorkflow.allowed === false && /no workflow/i.test(missingWorkflow.message));
  }

  // ---- evaluateFormAction + isNodeApprovalComplete: single-approver ANY mode ----
  {
    var fvAny = {workflowJson: linearWorkflow([], [{kind:'namedUser', value:'u2'}], 'any')};
    var subApprove = {currentNodeId: 'n_approve'};
    var approvePass = evaluateFormAction(fvAny, subApprove, projectAdmin, 'approve');
    var approveFail = evaluateFormAction(fvAny, subApprove, teamMember, 'approve');
    log('evaluateFormAction: ANY-mode single approver PASS for the named approver', approvePass.allowed === true);
    log('evaluateFormAction: ANY-mode single approver FAIL for anyone else', approveFail.allowed === false);

    var node = approvePass.node;
    var trailAfterOneApproval = [buildApprovalTrailEntry(node, projectAdmin, 'approved', null)];
    log('isNodeApprovalComplete: ANY mode complete after exactly one approval', isNodeApprovalComplete(node, trailAfterOneApproval) === true);
    log('isNodeApprovalComplete: ANY mode NOT complete with an empty trail', isNodeApprovalComplete(node, []) === false);

    var nextNodeId = computeNextNodeId(fvAny, node, 'approved', trailAfterOneApproval);
    log('computeNextNodeId: ANY mode advances to the node\'s outgoing edge once satisfied', nextNodeId === 'n_end', nextNodeId);

    var nextNodeIdUnsatisfied = computeNextNodeId(fvAny, node, 'approved', []);
    log('computeNextNodeId: does not advance when the trail (checked independently) shows no approval yet', nextNodeIdUnsatisfied === 'n_approve');

    var rejectNode = computeNextNodeId(fvAny, node, 'reject', trailAfterOneApproval);
    log('computeNextNodeId: "reject" never advances regardless of trail', rejectNode === 'n_approve');
  }

  // ---- isNodeApprovalComplete: ALL-mode partial vs complete quorum ----------
  {
    var allModeNode = {
      id: 'n_all', type: 'approval', approvalMode: 'all',
      approverGates: [{kind:'namedUser', value:'u2'}, {kind:'userType', value:'orgAdmin'}]
    };
    var noEntries = [];
    log('isNodeApprovalComplete: ALL mode not complete with zero approvals', isNodeApprovalComplete(allModeNode, noEntries) === false);

    var oneOfTwo = [buildApprovalTrailEntry(allModeNode, projectAdmin, 'approved', null)];
    log('isNodeApprovalComplete: ALL mode not complete after only ONE of two required gates approves', isNodeApprovalComplete(allModeNode, oneOfTwo) === false);

    var bothGates = oneOfTwo.concat([buildApprovalTrailEntry(allModeNode, orgAdmin, 'approved', null)]);
    log('isNodeApprovalComplete: ALL mode complete once every required gate has approved', isNodeApprovalComplete(allModeNode, bothGates) === true);

    // The SAME person satisfying two different gates on the same action still only fills the gate(s)
    // they actually matched — an Org Admin approving once satisfies both the namedUser gate (if it's
    // their own id) and the orgAdmin gate in one entry, but does NOT fill a namedUser gate for a
    // DIFFERENT id just because they're an admin.
    var wrongPersonNamedGate = {id: 'n_all2', type: 'approval', approvalMode: 'all', approverGates: [{kind:'namedUser', value:'someone-else'}, {kind:'userType', value:'orgAdmin'}]};
    var onlyOrgAdminApproved = [buildApprovalTrailEntry(wrongPersonNamedGate, orgAdmin, 'approved', null)];
    log('isNodeApprovalComplete: ALL mode still incomplete when the named-user gate belongs to someone who never approved', isNodeApprovalComplete(wrongPersonNamedGate, onlyOrgAdminApproved) === false);

    log('isNodeApprovalComplete: ALL mode with an empty approverGates list can never complete (deny-by-default)', isNodeApprovalComplete({id:'n_empty', type:'approval', approvalMode:'all', approverGates: []}, []) === false);
  }

  console.log('\nForm Workflow engine test complete.');
})();
