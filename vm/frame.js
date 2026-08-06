/**
 * DivLang Frame System
 * Sistema de yield para render frame-by-frame
 */

export class FrameSystem {
  constructor() {
    this.frameCallbacks = [];
    this.frameCount = 0;
    this.fps = 60;
    this.lastFrameTime = 0;
    this.frameTime = 1000 / this.fps;
  }

  // Register frame callback
  onFrame(callback) {
    this.frameCallbacks.push(callback);
  }

  // Start frame loop
  start() {
    this.lastFrameTime = performance.now();
    this.loop();
  }

  // Frame loop
  loop() {
    requestAnimationFrame(() => this.loop());

    const now = performance.now();
    const delta = now - this.lastFrameTime;

    if (delta >= this.frameTime) {
      this.lastFrameTime = now - (delta % this.frameTime);
      this.frameCount++;

      // Call all frame callbacks
      for (const callback of this.frameCallbacks) {
        callback(delta / 1000); // dt in seconds
      }
    }
  }

  // Set FPS
  setFPS(fps) {
    this.fps = fps;
    this.frameTime = 1000 / fps;
  }

  // Get frame count
  getFrameCount() {
    return this.frameCount;
  }
}

export class Frame {
  constructor() {
    this.entities = [];
  }

  // Add entity to frame
  add(entity) {
    this.entities.push(entity);
  }

  // Remove entity from frame
  remove(entity) {
    const index = this.entities.indexOf(entity);
    if (index !== -1) {
      this.entities.splice(index, 1);
    }
  }

  // Clear frame
  clear() {
    this.entities = [];
  }

  // Render frame
  render(renderer) {
    for (const entity of this.entities) {
      entity.render(renderer);
    }
  }
}
