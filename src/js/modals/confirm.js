"use strict";

var pendingConfirmAction = null;

export function confirmDialog(title, message, onConfirm){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  pendingConfirmAction = onConfirm;
  document.getElementById('confirmOverlay').classList.remove('hidden');
}
export function closeConfirmDialog(){
  document.getElementById('confirmOverlay').classList.add('hidden');
  pendingConfirmAction = null;
}
export function getPendingConfirmAction(){
  return pendingConfirmAction;
}
