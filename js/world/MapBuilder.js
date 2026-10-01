// MapBuilder.js — turns MapData's declarative layout into an actual Three.js
// scene: floor, walls, crates, site pads, and boundary skybox lighting.
window.TFPS = window.TFPS || {};

TFPS.MapBuilder = {
  build(scene) {
    const MD = TFPS.MapData;
    const staticMeshes = [];   // raycast blockers (walls + crates)
    const colliderBoxes = [];  // Box3 list for movement collision

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(140, 150);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xdCC7A0 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -2);
    floor.receiveShadow = true;
    scene.add(floor);

    // Site floor accents
    for (const key in MD.SITES) {
      const s = MD.SITES[key];
      const padGeo = new THREE.CircleGeometry(s.radius + 4, 24);
      const padMat = new THREE.MeshLambertMaterial({ color: s.color, transparent: true, opacity: 0.18 });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(s.cx, 0.02, s.cz);
      scene.add(pad);
    }

    // --- Walls ---
    const wallGeoCache = {};
    for (const w of MD.WALLS) {
      const key = `${w.w.toFixed(2)}_${w.d.toFixed(2)}_${w.h.toFixed(2)}`;
      if (!wallGeoCache[key]) wallGeoCache[key] = new THREE.BoxGeometry(w.w, w.h, w.d);
      const mat = new THREE.MeshLambertMaterial({ color: w.color });
      const mesh = new THREE.Mesh(wallGeoCache[key], mat);
      mesh.position.set(w.x, w.h / 2, w.z);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.blocker = true;
      scene.add(mesh);
      staticMeshes.push(mesh);
      colliderBoxes.push(new THREE.Box3(
        new THREE.Vector3(w.x - w.w / 2, 0, w.z - w.d / 2),
        new THREE.Vector3(w.x + w.w / 2, w.h, w.z + w.d / 2)
      ));

      // Thin colored trim along the top of accent walls for visual polish.
      if (w.color === MD.COLORS.TEAL || w.color === MD.COLORS.CORAL) {
        const trimGeo = new THREE.BoxGeometry(w.w + 0.05, 0.4, w.d + 0.05);
        const trimMat = new THREE.MeshLambertMaterial({ color: 0xf4ead9 });
        const trim = new THREE.Mesh(trimGeo, trimMat);
        trim.position.set(w.x, w.h + 0.2, w.z);
        scene.add(trim);
      }
    }

    // --- Crates ---
    const crateGeoCache = {};
    for (const c of MD.CRATES) {
      const key = `${c.w}_${c.d}_${c.h}`;
      if (!crateGeoCache[key]) crateGeoCache[key] = new THREE.BoxGeometry(c.w, c.h, c.d);
      const mat = new THREE.MeshLambertMaterial({ color: c.color });
      const mesh = new THREE.Mesh(crateGeoCache[key], mat);
      mesh.position.set(c.x, c.h / 2, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.blocker = true;
      scene.add(mesh);
      staticMeshes.push(mesh);
      // Banding detail so crates read as crates rather than plain boxes.
      const bandGeo = new THREE.BoxGeometry(c.w + 0.04, 0.12, c.d + 0.04);
      const bandMat = new THREE.MeshLambertMaterial({ color: 0x5c3b21 });
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.set(c.x, c.h * 0.72, c.z);
      scene.add(band);
      colliderBoxes.push(new THREE.Box3(
        new THREE.Vector3(c.x - c.w / 2, 0, c.z - c.d / 2),
        new THREE.Vector3(c.x + c.w / 2, c.h, c.z + c.d / 2)
      ));
    }

    // --- Plant pads (glowing, pulsating) ---
    const pads = {};
    for (const key in MD.SITES) {
      const s = MD.SITES[key];
      const geo = new THREE.CylinderGeometry(2.2, 2.2, 0.08, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: s.color, emissive: s.color, emissiveIntensity: 0.5, transparent: true, opacity: 0.85,
      });
      const pad = new THREE.Mesh(geo, mat);
      pad.position.set(s.cx, 0.04, s.cz);
      scene.add(pad);
      pads[key] = pad;
      const label = TFPS.MapBuilder._makeSiteLabel(key, s.color);
      label.position.set(s.cx, 5.4, s.cz);
      scene.add(label);
    }

    // --- Lighting ---
    const ambient = new THREE.AmbientLight(0xfff2d8, 0.65);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff6e0, 0.9);
    sun.position.set(30, 45, -20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
    sun.shadow.camera.far = 120;
    scene.add(sun);
    const fill = new THREE.HemisphereLight(0xbfe0ff, 0x6b4a2f, 0.35);
    scene.add(fill);

    scene.background = new THREE.Color(0x9fc7e0);
    scene.fog = new THREE.Fog(0x9fc7e0, 60, 140);

    return {
      staticMeshes, colliderBoxes,
      update(time) {
        for (const key in pads) {
          pads[key].material.emissiveIntensity = 0.4 + Math.sin(time * 2.2) * 0.25;
        }
      },
    };
  },

  _makeSiteLabel(letter, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 128, 128);
    ctx.font = 'bold 92px Arial Narrow, Arial, sans-serif';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4, 4, 1);
    return sprite;
  },
};
