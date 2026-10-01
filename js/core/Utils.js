// Utils.js — shared math, collision, line-of-sight and pathfinding helpers.
window.TFPS = window.TFPS || {};

TFPS.Utils = (function () {

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function randRange(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(randRange(min, max + 1)); }
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function dist2D(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

  // ---- Simple pub/sub used to decouple RoundManager / HUD / Game ----
  class EventBus {
    constructor() { this.listeners = {}; }
    on(name, fn) {
      (this.listeners[name] = this.listeners[name] || []).push(fn);
      return fn;
    }
    off(name, fn) {
      if (!this.listeners[name]) return;
      this.listeners[name] = this.listeners[name].filter(f => f !== fn);
    }
    emit(name, payload) {
      (this.listeners[name] || []).slice().forEach(fn => {
        try { fn(payload); } catch (e) { console.error('[EventBus]', name, e); }
      });
    }
  }

  // ---- Static-geometry collision (walls + crates) ----
  // Builds an axis-aligned Box3 list from wall/crate specs {x,z,w,d,h}.
  function buildColliderBoxes(specs) {
    return specs.map(s => {
      const box = new THREE.Box3(
        new THREE.Vector3(s.x - s.w / 2, 0, s.z - s.d / 2),
        new THREE.Vector3(s.x + s.w / 2, s.h, s.z + s.d / 2)
      );
      return box;
    });
  }

  // Resolves horizontal movement against a list of THREE.Box3 colliders using
  // axis-separated sliding so players/bots glide along walls instead of sticking.
  function moveWithCollision(pos, dx, dz, colliders, radius) {
    const tryAxis = (px, pz) => {
      const b = new THREE.Box3(
        new THREE.Vector3(px - radius, 0.05, pz - radius),
        new THREE.Vector3(px + radius, 1.9, pz + radius)
      );
      for (let i = 0; i < colliders.length; i++) {
        if (b.intersectsBox(colliders[i])) return false;
      }
      return true;
    };
    let nx = pos.x + dx, nz = pos.z;
    if (tryAxis(nx, nz)) pos.x = nx; else nx = pos.x;
    let nz2 = pos.z + dz;
    if (tryAxis(nx, nz2)) pos.z = nz2;
    return pos;
  }

  // Sphere-vs-segment test used to make smoke clouds block line-of-sight.
  function segmentIntersectsSphere(p0, p1, center, radiusSq) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const fx = p0.x - center.x, fy = p0.y - center.y, fz = p0.z - center.z;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (fx * dx + fy * dy + fz * dz);
    const c = (fx * fx + fy * fy + fz * fz) - radiusSq;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
  }

  const _raycaster = new THREE.Raycaster();
  // Clear line-of-sight test between two points against static blocker meshes
  // and any active smoke volumes.
  function hasLineOfSight(fromPos, toPos, blockerMeshes, smokeVolumes) {
    if (smokeVolumes && smokeVolumes.length) {
      for (const s of smokeVolumes) {
        if (segmentIntersectsSphere(fromPos, toPos, s.center, s.radius * s.radius)) return false;
      }
    }
    const dir = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.normalize();
    _raycaster.set(fromPos, dir);
    _raycaster.far = dist - 0.15;
    _raycaster.near = 0.01;
    const hits = _raycaster.intersectObjects(blockerMeshes, false);
    return hits.length === 0;
  }

  // ---- Waypoint graph pathfinding (small graph -> plain Dijkstra each query) ----
  function buildGraph(waypoints, edges) {
    const adj = {};
    for (const id in waypoints) adj[id] = [];
    for (const [a, b] of edges) {
      const d = dist2D(waypoints[a].x, waypoints[a].z, waypoints[b].x, waypoints[b].z);
      adj[a].push({ to: b, d });
      adj[b].push({ to: a, d });
    }
    return adj;
  }

  function nearestNode(waypoints, x, z) {
    let best = null, bestD = Infinity;
    for (const id in waypoints) {
      const d = dist2D(waypoints[id].x, waypoints[id].z, x, z);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function findPath(adj, waypoints, startId, goalId) {
    if (startId === goalId) return [waypoints[goalId]];
    const dists = { [startId]: 0 };
    const prev = {};
    const visited = new Set();
    const queue = new Set(Object.keys(adj));
    while (queue.size) {
      let u = null, best = Infinity;
      for (const id of queue) {
        const d = dists[id] !== undefined ? dists[id] : Infinity;
        if (d < best) { best = d; u = id; }
      }
      if (u === null) break;
      queue.delete(u);
      if (u === goalId) break;
      visited.add(u);
      for (const edge of adj[u]) {
        if (visited.has(edge.to)) continue;
        const alt = best + edge.d;
        if (alt < (dists[edge.to] !== undefined ? dists[edge.to] : Infinity)) {
          dists[edge.to] = alt;
          prev[edge.to] = u;
        }
      }
    }
    if (dists[goalId] === undefined) return [waypoints[goalId]];
    const path = [goalId];
    let cur = goalId;
    while (prev[cur] !== undefined) { cur = prev[cur]; path.unshift(cur); }
    return path.map(id => waypoints[id]);
  }

  return {
    clamp, lerp, randRange, randInt, choice, dist2D, EventBus,
    buildColliderBoxes, moveWithCollision, hasLineOfSight, segmentIntersectsSphere,
    buildGraph, nearestNode, findPath,
  };
})();
