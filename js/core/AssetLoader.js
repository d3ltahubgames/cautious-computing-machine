window.TFPS = window.TFPS || {};

TFPS.AssetLoader = class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.loader = window.THREE && window.THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
    this.basePath = 'models';
  }

  loadBundle() {
    if (!this.loader) return;

    const bundles = [
      { path: `${this.basePath}/agents/agent.glb`, group: 'agents' },
      { path: `${this.basePath}/maps/site_a.glb`, group: 'maps' },
      { path: `${this.basePath}/weapons/rifle.glb`, group: 'weapons' },
      { path: `${this.basePath}/animations/idle.glb`, group: 'animations' },
    ];

    for (const bundle of bundles) {
      this._tryLoad(bundle.path, bundle.group);
    }
  }

  _tryLoad(path, group) {
    fetch(path, { method: 'HEAD' }).then((res) => {
      if (!res.ok) return;
      this.loader.load(path, (gltf) => {
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
