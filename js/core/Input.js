// Input.js — keyboard, mouse and pointer-lock handling.
window.TFPS = window.TFPS || {};

TFPS.InputManager = class InputManager {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.justPressedKeys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseLeft = false;
    this.mouseRight = false;
    this.mouseLeftJustPressed = false;
    this.mouseRightJustPressed = false;
    this.pointerLocked = false;
    this.wheelDelta = 0;

    window.addEventListener('keydown', e => {
      const code = e.code;
      if (!this.keys.has(code)) this.justPressedKeys.add(code);
      this.keys.add(code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));

    domElement.addEventListener('click', () => {
      if (!this.pointerLocked) domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === domElement;
    });
    document.addEventListener('mousemove', e => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    domElement.addEventListener('mousedown', e => {
      if (e.button === 0) { if (!this.mouseLeft) this.mouseLeftJustPressed = true; this.mouseLeft = true; }
      if (e.button === 2) { if (!this.mouseRight) this.mouseRightJustPressed = true; this.mouseRight = true; }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    domElement.addEventListener('contextmenu', e => e.preventDefault());
    domElement.addEventListener('wheel', e => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
  }

  isDown(code) { return this.keys.has(code); }
  justPressed(code) { return this.justPressedKeys.has(code); }

  consumeMouseDelta() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  // Called once per frame after all systems have read this frame's edge-triggers.
  endFrame() {
    this.justPressedKeys.clear();
    this.mouseLeftJustPressed = false;
    this.mouseRightJustPressed = false;
    this.wheelDelta = 0;
  }
};
