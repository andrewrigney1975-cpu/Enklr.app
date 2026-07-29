"use strict";

/* Pure, node-shape-agnostic geometry shared by every orthogonal-connector graph editor in this app
   (views/workflow-editor.js's Board-Column Workflow, views/form-workflow-editor.js's Enterprise
   Forms Action Workflow) — extracted from workflow-editor.js during the Forms & Workflow Phase 4
   build, per the approved plan's own call to factor this out rather than copy-pasting it a second
   time (root CLAUDE.md's "duplication within one tier is bad" principle). Every function here takes
   node width/height/stub distance as explicit parameters rather than module-level constants, since
   the two editors' nodes are differently sized. views/dependency-map.js's own roundedOrthogonalPathD
   (fillet rendering) is still imported directly by each editor, not duplicated here — it doesn't
   depend on node geometry at all, unlike everything in this file. */

/* Which side of a node's rectangle an edge should attach to, given the node's center and the point
   it's heading toward — whichever axis has the larger delta wins, so a mostly-horizontal relationship
   attaches left/right and a mostly-vertical one attaches top/bottom. */
export function pickAttachmentSide(fromCenter, toCenter){
  var dx = toCenter.x - fromCenter.x, dy = toCenter.y - fromCenter.y;
  if(Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

export function sideMidpoint(pos, side, w, h){
  switch(side){
    case 'right':  return {x: pos.x + w, y: pos.y + h / 2};
    case 'left':   return {x: pos.x, y: pos.y + h / 2};
    case 'top':    return {x: pos.x + w / 2, y: pos.y};
    default:       return {x: pos.x + w / 2, y: pos.y + h};
  }
}

export function sideNormal(side){
  return {right: {x: 1, y: 0}, left: {x: -1, y: 0}, top: {x: 0, y: -1}, bottom: {x: 0, y: 1}}[side];
}

/* Orthogonal connector vertex list with rounded (filleted) corners applied later by the caller's own
   roundedOrthogonalPathD — generalized from a fixed left-to-right attachment (dependency-map.js's own
   buildOrthogonalPoints) to any of the 4 sides, since these editors' nodes can attach from any side. */
export function buildOrthogonalPoints(start, dir1, end, dir2, midOverride, stub){
  // Already a straight shot out of both faces — skip the stub/bend entirely rather than drawing
  // needless dog-legs on the most common adjacent-node layout.
  if(dir1.x !== 0 && dir2.x !== 0 && start.y === end.y) return [start, end];
  if(dir1.y !== 0 && dir2.y !== 0 && start.x === end.x) return [start, end];

  var p1 = {x: start.x + dir1.x * stub, y: start.y + dir1.y * stub};
  var p2 = {x: end.x + dir2.x * stub, y: end.y + dir2.y * stub};
  var mid;
  if(dir1.x !== 0 && dir2.x !== 0){
    var midX = midOverride != null ? midOverride : (p1.x + p2.x) / 2;
    mid = [{x: midX, y: p1.y}, {x: midX, y: p2.y}];
  } else if(dir1.y !== 0 && dir2.y !== 0){
    var midY = midOverride != null ? midOverride : (p1.y + p2.y) / 2;
    mid = [{x: p1.x, y: midY}, {x: p2.x, y: midY}];
  } else if(dir1.x !== 0){
    // One side exits horizontally, the other vertically — a single corner.
    mid = [{x: p2.x, y: p1.y}];
  } else {
    mid = [{x: p1.x, y: p2.y}];
  }
  return [start, p1].concat(mid, [p2, end]);
}

/* Full attachment-side + stub-direction geometry for one edge between two node boxes. `offset`
   shifts both endpoints along whichever axis the exit side actually lies on, clamped so it can never
   push the anchor past the node's own rounded corner even with several parallel edges sharing one
   node pair — see computeMultiEdgeOffsets' own doc comment for why an offset is ever needed at all. */
export function edgeGeometry(fromPos, toPos, offset, w, h){
  var fromCenter = {x: fromPos.x + w / 2, y: fromPos.y + h / 2};
  var toCenter = {x: toPos.x + w / 2, y: toPos.y + h / 2};
  var startSide = pickAttachmentSide(fromCenter, toCenter);
  var endSide = pickAttachmentSide(toCenter, fromCenter);
  var start = sideMidpoint(fromPos, startSide, w, h);
  var end = sideMidpoint(toPos, endSide, w, h);

  if(offset){
    var vertical = startSide === 'left' || startSide === 'right';
    var maxOffset = (vertical ? h : w) / 2 - 10;
    var clamped = Math.max(-maxOffset, Math.min(maxOffset, offset));
    if(vertical){ start.y += clamped; end.y += clamped; }
    else { start.x += clamped; end.x += clamped; }
  }

  return {start: start, end: end, dir1: sideNormal(startSide), dir2: sideNormal(endSide)};
}

/* Two or more edges connecting the exact same PAIR of nodes (regardless of direction) would otherwise
   attach at the identical point on both ends and draw as one perfectly overlapping line. Grouped by
   the unordered node-pair key, each edge in a group of 2+ gets an offset centered on zero, keyed by
   each edge's own `.id` (both this app's graph-editor edge shapes already carry a stable id).
   `fromId`/`toId` are accessor functions rather than assuming a fixed property name, since the two
   editors' edges use different key names (fromColumnId/toColumnId vs fromNodeId/toNodeId). */
export function computeMultiEdgeOffsets(edges, positions, fromId, toId, spacing){
  var groups = {};
  edges.forEach(function(e){
    var a = fromId(e), b = toId(e);
    if(!positions[a] || !positions[b]) return;
    var pairKey = [a, b].slice().sort().join('|');
    (groups[pairKey] = groups[pairKey] || []).push(e);
  });
  var offsets = {};
  Object.keys(groups).forEach(function(key){
    var list = groups[key];
    var n = list.length;
    list.forEach(function(e, i){ offsets[e.id] = n < 2 ? 0 : (i - (n - 1) / 2) * spacing; });
  });
  return offsets;
}

/* Two or more edges that happen to share the same stub-out coordinate on whichever axis their bend
   actually happens on would otherwise all bend at the exact same point and draw directly on top of
   each other along their shared span. Grouped by that rounded stub coordinate pair, then spread
   across the 30%-70% band of the gap between the two stubs. Mutates each geometry object in place,
   adding `.midOverride` only where a group actually has 2+ members. */
export function computeEdgeLaneOverrides(geoms, stub){
  var groupsX = {}, groupsY = {};
  geoms.forEach(function(g){
    if(g.dir1.x !== 0 && g.dir2.x !== 0 && g.start.y !== g.end.y){
      g._p1 = g.start.x + g.dir1.x * stub;
      g._p2 = g.end.x + g.dir2.x * stub;
      var keyX = Math.round(g._p1) + '_' + Math.round(g._p2);
      (groupsX[keyX] = groupsX[keyX] || []).push(g);
    } else if(g.dir1.y !== 0 && g.dir2.y !== 0 && g.start.x !== g.end.x){
      g._p1 = g.start.y + g.dir1.y * stub;
      g._p2 = g.end.y + g.dir2.y * stub;
      var keyY = Math.round(g._p1) + '_' + Math.round(g._p2);
      (groupsY[keyY] = groupsY[keyY] || []).push(g);
    }
  });
  [groupsX, groupsY].forEach(function(groups){
    Object.keys(groups).forEach(function(key){
      var group = groups[key];
      var n = group.length;
      if(n < 2) return;
      group.sort(function(a, b){ return (a.start.x + a.start.y) - (b.start.x + b.start.y); });
      group.forEach(function(g, i){
        var frac = 0.3 + 0.4 * i / (n - 1);
        g.midOverride = g._p1 + (g._p2 - g._p1) * frac;
      });
    });
  });
}
