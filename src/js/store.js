"use strict";

import { state } from './storage.js';
export * from './utils.js';

export function getCurrentProject(){
  return state.db ? (state.db.projects[state.db.currentProjectId] || null) : null;
}
