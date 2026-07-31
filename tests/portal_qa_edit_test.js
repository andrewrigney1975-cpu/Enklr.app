const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }
  var projectId = 'p1';

  var seed = {
    projects: {}, projectOrder: [projectId], currentProjectId: projectId
  };
  seed.projects[projectId] = {
    id: projectId, serverProjectId: projectId, name: 'Server Project', key: 'SRV', taskCounter: 1,
    columns: [], tasks: {}, members: [], releases: [], taskTypes: [], savedQueries: [],
    startDate: null, endDate: null, description: '',
    headerButtonVisibility: {portals: true, forms: true},
    dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
  };

  var portalSummary = {id: 'portal1', name: 'Support Portal', slug: 'support', status: 'published', description: null};
  var portalDetail = Object.assign({}, portalSummary, {iconName: null, projectId: 'actioner1', dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', publishedAt: '2025-01-01T00:00:00.000Z'});
  var topics = [{id: 'topicBilling', title: 'Billing', order: 0}, {id: 'topicAccess', title: 'Access', order: 1}];
  var entries = [{id: 'entry1', portalTopicId: 'topicBilling', question: 'How do I pay?', answer: 'Use the **portal**.', order: 0}];

  var lastUpdateUrl = null;
  var lastUpdateBody = null;
  var lastTopicUpdateUrl = null;
  var lastTopicUpdateBody = null;

  function ok(body){ return {ok: true, status: 200, json: async () => body}; }

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
      w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'true', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: false}])}));
      w.fetch = async function(url, options){
        var method = (options && options.method) || 'GET';
        if(url === '/api/organisations/me/portals' && method === 'GET') return ok([portalSummary]);
        if(url === '/api/organisations/me/portals/portal1' && method === 'GET') return ok(portalDetail);
        if(url === '/api/organisations/me/portals/portal1/topics' && method === 'GET') return ok(topics);
        if(url === '/api/organisations/me/portals/portal1/qa-entries' && method === 'GET') return ok(entries);
        if(url === '/api/organisations/me/portals/portal1/qa-entries/entry1' && method === 'PUT'){
          lastUpdateUrl = url;
          lastUpdateBody = JSON.parse(options.body);
          entries = [Object.assign({}, entries[0], {question: lastUpdateBody.question, answer: lastUpdateBody.answer, portalTopicId: lastUpdateBody.portalTopicId})];
          return ok(entries[0]);
        }
        if(url === '/api/organisations/me/portals/portal1/topics/topicBilling' && method === 'PUT'){
          lastTopicUpdateUrl = url;
          lastTopicUpdateBody = JSON.parse(options.body);
          topics = topics.map(function(t){ return t.id === 'topicBilling' ? Object.assign({}, t, {title: lastTopicUpdateBody.title}) : t; });
          return ok(topics[0]);
        }
        // Catch-all for org users/org teams/published forms/back-office team list — not under test here.
        return ok([]);
      };
    }
  });
  await wait(300);
  const doc = dom.window.document;

  doc.getElementById('navPortalsBtn').click();
  await wait(20);
  log('Portals admin list shows the seeded portal', !!doc.querySelector('[data-edit-portal="portal1"]'));

  doc.querySelector('[data-edit-portal="portal1"]').click();
  await wait(30);
  log('Portal edit overlay opens', !doc.getElementById('portalEditOverlay').classList.contains('hidden'));

  doc.querySelector('.kf-portal-edit-tab-btn[data-portal-tab="qa"]').click();
  await wait(10);
  log('Q&A tab shows the seeded entry', doc.getElementById('portalQaList').textContent.indexOf('How do I pay?') !== -1);

  const editBtn = doc.querySelector('[data-edit-qa-entry="entry1"]');
  log('an Edit button exists on the Q&A entry row', !!editBtn);
  editBtn.click();
  await wait(10);

  log('the add/edit row becomes visible', !doc.getElementById('portalQaAddEntryRow').classList.contains('hidden'));
  log('question input is pre-filled from the existing entry', doc.getElementById('portalQaEntryQuestionInput').value === 'How do I pay?', doc.getElementById('portalQaEntryQuestionInput').value);
  log('topic select is pre-filled to the entry’s current topic (Billing)', doc.getElementById('portalQaEntryTopicSelect').value === 'topicBilling');
  log('Save button reads "Update" while editing', doc.getElementById('portalQaEntrySaveBtn').textContent === 'Update');

  // Change the question, reassign to the OTHER topic, then save.
  doc.getElementById('portalQaEntryQuestionInput').value = 'How do I update my payment method?';
  doc.getElementById('portalQaEntryTopicSelect').value = 'topicAccess';
  doc.getElementById('portalQaEntrySaveBtn').click();
  await wait(30);

  log('saving an edit calls the update endpoint (PUT), not create (POST)', lastUpdateUrl === '/api/organisations/me/portals/portal1/qa-entries/entry1', lastUpdateUrl);
  log('the update request carries the edited question', lastUpdateBody && lastUpdateBody.question === 'How do I update my payment method?', JSON.stringify(lastUpdateBody));
  log('the update request carries the reassigned topic (including the topic, per this feature’s own requirement)', lastUpdateBody && lastUpdateBody.portalTopicId === 'topicAccess', JSON.stringify(lastUpdateBody));
  log('the update request preserves the entry’s existing order rather than resetting it', lastUpdateBody && lastUpdateBody.order === 0, JSON.stringify(lastUpdateBody));

  log('the add/edit row closes after a successful update', doc.getElementById('portalQaAddEntryRow').classList.contains('hidden'));
  log('the list re-renders showing the updated question', doc.getElementById('portalQaList').textContent.indexOf('How do I update my payment method?') !== -1, doc.getElementById('portalQaList').textContent);
  log('the list no longer shows the old question text', doc.getElementById('portalQaList').textContent.indexOf('How do I pay?') === -1);

  // Opening "Add Q&A Entry" fresh afterward must NOT still be in edit mode for the old entry.
  doc.getElementById('portalQaAddEntryBtn').click();
  await wait(10);
  log('starting a fresh Add resets the question field', doc.getElementById('portalQaEntryQuestionInput').value === '');
  log('starting a fresh Add resets the Save button label back to "Save"', doc.getElementById('portalQaEntrySaveBtn').textContent === 'Save');
  log('starting a fresh Add resets the topic select to "No topic"', doc.getElementById('portalQaEntryTopicSelect').value === '');
  doc.getElementById('portalQaEntryCancelBtn').click();
  await wait(10);

  // ---- Topic editing ----
  const topicEditBtn = doc.querySelector('[data-edit-qa-topic="topicBilling"]');
  log('an Edit button exists on the Topic group row', !!topicEditBtn);
  topicEditBtn.click();
  await wait(10);

  log('the topic add/edit row becomes visible', !doc.getElementById('portalQaAddTopicRow').classList.contains('hidden'));
  log('topic title input is pre-filled from the existing topic', doc.getElementById('portalQaTopicTitleInput').value === 'Billing', doc.getElementById('portalQaTopicTitleInput').value);
  log('topic Save button reads "Update" while editing', doc.getElementById('portalQaTopicSaveBtn').textContent === 'Update');

  doc.getElementById('portalQaTopicTitleInput').value = 'Billing & Payments';
  doc.getElementById('portalQaTopicSaveBtn').click();
  await wait(30);

  log('saving a topic edit calls the update endpoint (PUT), not create (POST)', lastTopicUpdateUrl === '/api/organisations/me/portals/portal1/topics/topicBilling', lastTopicUpdateUrl);
  log('the topic update request carries the edited title', lastTopicUpdateBody && lastTopicUpdateBody.title === 'Billing & Payments', JSON.stringify(lastTopicUpdateBody));
  log('the topic update request preserves the topic’s existing order', lastTopicUpdateBody && lastTopicUpdateBody.order === 0, JSON.stringify(lastTopicUpdateBody));
  log('the topic add/edit row closes after a successful update', doc.getElementById('portalQaAddTopicRow').classList.contains('hidden'));
  log('the list re-renders showing the renamed topic', doc.getElementById('portalQaList').textContent.indexOf('Billing & Payments') !== -1, doc.getElementById('portalQaList').textContent);

  // Starting a fresh "Add Topic" afterward must NOT still be in edit mode for the old topic.
  doc.getElementById('portalQaAddTopicBtn').click();
  await wait(10);
  log('starting a fresh Add Topic resets the title field', doc.getElementById('portalQaTopicTitleInput').value === '');
  log('starting a fresh Add Topic resets the Save button label back to "Save"', doc.getElementById('portalQaTopicSaveBtn').textContent === 'Save');

  console.log('\nPortal Q&A edit test complete.');
  process.exit(0);
})();
