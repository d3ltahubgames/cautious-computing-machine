window.TFPS = window.TFPS || {};

TFPS.AssetLoader = class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.loader = window.THREE && THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
    this.basePath = 'models';
    this.defaultMapFiles = [
      `${this.basePath}/maps/site_a.glb`,
      `${this.basePath}/maps/site_b.glb`,
      `${this.basePath}/maps/mid.glb`,
      `${this.basePath}/maps/walls.glb`,
    ];
  }

  loadBundle() {
    if (!this.loader) return;

    const bundles = [
      { path: `${this.basePath}/agents/agent.glb`, group: 'agents' },
      { path: `${this.basePath}/weapons/rifle.glb`, group: 'weapons' },
      { path: `${this.basePath}/animations/idle.glb`, group: 'animations' },
    ];

    for (const bundle of bundles) {
      this._tryLoad(bundle.path, bundle.group);
    }
    this.loadMapBundle();
  }

  loadMapBundle() {
    const manifestPath = `${this.basePath}/maps/index.json`;
    fetch(manifestPath, { method: 'GET' })
      .then((res) => {
        if (!res.ok) throw new Error('No map manifest');
        return res.json();
      })
      .then((manifest) => {
        const files = Array.isArray(manifest) ? manifest : (manifest.files || []);
        if (files.length > 0) {
          files.forEach((file) => this._tryLoad(this._normalizePath(file), 'maps'));
          return;
        }
        this._loadDefaultMapFiles();
      })
      .catch(() => this._loadDefaultMapFiles());
  }

  _loadDefaultMapFiles() {
    for (const path of this.defaultMapFiles) {
      this._tryLoad(path, 'maps');
    }
  }

  _normalizePath(value) {
    const clean = String(value).replace(/^\/+/, '');
    return clean.startsWith(this.basePath) ? clean : `${this.basePath}/${clean}`;
  }

  _tryLoad(path, group) {
    const finalPath = this._normalizePath(path);
    fetch(finalPath, { method: 'HEAD' }).then((res) => {
      if (!res.ok) return;
      this.loader.load(finalPath, (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) return;

        root.userData.assetGroup = group;
        root.scale.setScalar(1);
        root.position.set(0, 0, 0);
        this.scene.add(root);
      }, undefined, () => {});
    }).catch(() => {});
  }
};
