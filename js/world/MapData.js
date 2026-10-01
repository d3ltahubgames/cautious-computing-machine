// MapData.js — declarative layout for "Bastion Quarter", a two-site tactical map.
// All geometry is expressed as data (wall boxes, crates, sites, waypoints) so the
// renderer (MapBuilder), the collision system, and the bot pathfinder all agree
// on the exact same layout with zero duplication.
window.TFPS = window.TFPS || {};

TFPS.MapData = (function () {
  const WALL_H = 6;
  const WALL_T = 1;

  const PLASTER = 0xC9AD86;
  const PLASTER_DARK = 0xB08F66;
  const TEAL = 0x2fb8ac;
  const CORAL = 0xe0615f;
  const BOUNDARY = 0x8f7657;

  const walls = [];
  const crates = [];

  function segments(min, max, gaps) {
    const g = (gaps || []).slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    let cursor = min;
    for (const [gMin, gMax] of g) {
      if (gMin > cursor) out.push([cursor, gMin]);
      cursor = Math.max(cursor, gMax);
    }
    if (cursor < max) out.push([cursor, max]);
    return out;
  }

  // A corridor running along Z, centered at cx, with optional gaps (choke points)
  // cut into its west/east walls.
  function corridorZ(cx, zMin, zMax, width, color, gapsWest, gapsEast) {
    const hw = width / 2;
    for (const [a, b] of segments(zMin, zMax, gapsWest)) {
      walls.push({ x: cx - hw - WALL_T / 2, z: (a + b) / 2, w: WALL_T, d: b - a, h: WALL_H, color });
    }
    for (const [a, b] of segments(zMin, zMax, gapsEast)) {
      walls.push({ x: cx + hw + WALL_T / 2, z: (a + b) / 2, w: WALL_T, d: b - a, h: WALL_H, color });
    }
  }

  // A corridor running along X, centered at cz, with optional gaps in its
  // south/north walls.
  function corridorX(cz, xMin, xMax, width, color, gapsSouth, gapsNorth) {
    const hw = width / 2;
    for (const [a, b] of segments(xMin, xMax, gapsSouth)) {
      walls.push({ x: (a + b) / 2, z: cz - hw - WALL_T / 2, w: b - a, d: WALL_T, h: WALL_H, color });
    }
    for (const [a, b] of segments(xMin, xMax, gapsNorth)) {
      walls.push({ x: (a + b) / 2, z: cz + hw + WALL_T / 2, w: b - a, d: WALL_T, h: WALL_H, color });
    }
  }

  // A fully-enclosed room with optional door gaps per side (absolute world coords).
  function roomPerimeter(cx, cz, w, d, color, gaps) {
    gaps = gaps || {};
    const xMin = cx - w / 2, xMax = cx + w / 2;
    const zMin = cz - d / 2, zMax = cz + d / 2;
    for (const [a, b] of segments(xMin, xMax, gaps.south)) {
      walls.push({ x: (a + b) / 2, z: zMin - WALL_T / 2, w: b - a, d: WALL_T, h: WALL_H, color });
    }
    for (const [a, b] of segments(xMin, xMax, gaps.north)) {
      walls.push({ x: (a + b) / 2, z: zMax + WALL_T / 2, w: b - a, d: WALL_T, h: WALL_H, color });
    }
    for (const [a, b] of segments(zMin, zMax, gaps.west)) {
      walls.push({ x: xMin - WALL_T / 2, z: (a + b) / 2, w: WALL_T, d: b - a, h: WALL_H, color });
    }
    for (const [a, b] of segments(zMin, zMax, gaps.east)) {
      walls.push({ x: xMax + WALL_T / 2, z: (a + b) / 2, w: WALL_T, d: b - a, h: WALL_H, color });
    }
  }

  // ---- Lanes ----
  corridorZ(0, -33, 26, 10, PLASTER, [[14, 24]], [[14, 24]]);   // Mid, chokes into both sites
  corridorZ(-26, -33, 9, 10, PLASTER, [], []);                   // A-Link
  corridorZ(26, -33, 9, 10, PLASTER, [], []);                    // B-Link
  corridorX(19, -14, -5, 10, PLASTER, [], []);                   // Mid -> A connector
  corridorX(19, 5, 14, 10, PLASTER, [], []);                     // Mid -> B connector
  corridorX(36, -31, 31, 10, PLASTER_DARK, [], []);              // Defender back-rotate

  // ---- Sites ----
  roomPerimeter(-26, 20, 24, 22, TEAL, {
    south: [[-31, -21]], east: [[14, 24]], north: [[-31, -21]],
  });
  roomPerimeter(26, 20, 24, 22, CORAL, {
    south: [[21, 31]], west: [[14, 24]], north: [[21, 31]],
  });

  // ---- Outer boundary (keeps everyone on the map) ----
  const B_XMIN = -45, B_XMAX = 45, B_ZMIN = -52, B_ZMAX = 48, B_H = 10;
  walls.push({ x: 0, z: B_ZMIN, w: B_XMAX - B_XMIN + 2, d: WALL_T, h: B_H, color: BOUNDARY });
  walls.push({ x: 0, z: B_ZMAX, w: B_XMAX - B_XMIN + 2, d: WALL_T, h: B_H, color: BOUNDARY });
  walls.push({ x: B_XMIN, z: 0, w: WALL_T, d: B_ZMAX - B_ZMIN + 2, h: B_H, color: BOUNDARY });
  walls.push({ x: B_XMAX, z: 0, w: WALL_T, d: B_ZMAX - B_ZMIN + 2, h: B_H, color: BOUNDARY });

  // ---- Crates (cover) ----
  const crateColor = 0x8a5a34;
  const crateSpecs = [
    [-2, -14, 2, 2, 1.6], [2, -2, 2, 2, 1.6], [-2, 10, 2, 2, 1.6],
    [-24, -18, 2, 2, 1.6], [-28, -6, 2, 2, 2.0],
    [28, -18, 2, 2, 1.6], [24, -6, 2, 2, 2.0],
    [-32, 24, 2.2, 2.2, 1.8], [-20, 15, 2.2, 2.2, 1.8], [-24, 28, 2, 2, 2.2],
    [32, 24, 2.2, 2.2, 1.8], [20, 15, 2.2, 2.2, 1.8], [24, 28, 2, 2, 2.2],
    [-9, 19, 2, 2, 1.6], [9, 19, 2, 2, 1.6],
    [-14, 36, 2, 2, 1.6], [14, 36, 2, 2, 1.6],
  ];
  for (const [x, z, w, d, h] of crateSpecs) crates.push({ x, z, w, d, h, color: crateColor });

  const SITES = {
    A: { name: 'A', cx: -26, cz: 20, radius: 9, color: TEAL },
    B: { name: 'B', cx: 26, cz: 20, radius: 9, color: CORAL },
  };

  const SPAWNS = {
    attacker: [-20, -10, 0, 10, 20].map(x => ({ x, z: -40 })),
    defender: [-18, -9, 0, 9, 18].map(x => ({ x, z: 46 })),
  };

  // ---- Bot navigation graph ----
  const WAYPOINTS = {
    spawnA_atk: { x: -20, z: -40 }, spawnMid_atk: { x: 0, z: -40 }, spawnB_atk: { x: 20, z: -40 },
    aLink1: { x: -26, z: -25 }, aLink2: { x: -26, z: -10 }, aLinkEntry: { x: -26, z: 5 },
    bLink1: { x: 26, z: -25 }, bLink2: { x: 26, z: -10 }, bLinkEntry: { x: 26, z: 5 },
    midEntry: { x: 0, z: -25 }, midMid: { x: 0, z: -10 }, midNorth: { x: 0, z: 10 }, midJunction: { x: 0, z: 19 },
    midToA: { x: -9, z: 19 }, midToB: { x: 9, z: 19 },
    aSiteEntry: { x: -26, z: 12, choke: true }, aSiteCenter: { x: -26, z: 20 }, aSiteBack: { x: -26, z: 28 },
    bSiteEntry: { x: 26, z: 12, choke: true }, bSiteCenter: { x: 26, z: 20 }, bSiteBack: { x: 26, z: 28 },
    backA: { x: -20, z: 36 }, backMid: { x: 0, z: 36 }, backB: { x: 20, z: 36 },
    spawnA_def: { x: -15, z: 46 }, spawnB_def: { x: 15, z: 46 },
  };
  for (const k in WAYPOINTS) WAYPOINTS[k].id = k;

  const EDGES = [
    ['spawnA_atk', 'aLink1'], ['aLink1', 'aLink2'], ['aLink2', 'aLinkEntry'], ['aLinkEntry', 'aSiteEntry'],
    ['aSiteEntry', 'aSiteCenter'], ['aSiteCenter', 'aSiteBack'], ['aSiteBack', 'backA'],
    ['backA', 'backMid'], ['backMid', 'backB'], ['backB', 'bSiteBack'],
    ['bSiteBack', 'bSiteCenter'], ['bSiteCenter', 'bSiteEntry'], ['bSiteEntry', 'bLinkEntry'],
    ['bLinkEntry', 'bLink2'], ['bLink2', 'bLink1'], ['bLink1', 'spawnB_atk'],
    ['spawnMid_atk', 'midEntry'], ['midEntry', 'midMid'], ['midMid', 'midNorth'], ['midNorth', 'midJunction'],
    ['midJunction', 'midToA'], ['midToA', 'aSiteEntry'],
    ['midJunction', 'midToB'], ['midToB', 'bSiteEntry'],
    ['backA', 'spawnA_def'], ['backB', 'spawnB_def'],
    ['midJunction', 'midToA'], ['midJunction', 'midToB'],
  ];

  return {
    WALL_H, WALL_T, WALLS: walls, CRATES: crates, SITES, SPAWNS, WAYPOINTS, EDGES,
    COLORS: { PLASTER, PLASTER_DARK, TEAL, CORAL, BOUNDARY, CRATE: crateColor },
  };
})();
