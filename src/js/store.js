"use strict";

import { state } from './storage.js';
export * from './utils.js';

export function getCurrentProject(){
  return state.db ? (state.db.projects[state.db.currentProjectId] || null) : null;
}

/* A Form submission's projectId (from an SSE payload) is the real SERVER project id, not a local
   one — unlike task keys (globally unique across every local project, see hash-router.js),
   there's no cross-project uniqueness to search by here, just a direct serverProjectId match. */
export function findProjectByServerId(serverProjectId){
  if(!state.db || !serverProjectId) return null;
  for(var i=0; i<state.db.projectOrder.length; i++){
    var project = state.db.projects[state.db.projectOrder[i]];
    if(project && project.serverProjectId === serverProjectId) return project;
  }
  return null;
}
