/**
 * DivLang Graphics Manager
 * Gerencia gráficos (sprites, tilesets)
 */

export class GraphicsManager {
  constructor() {
    this.graphics = new Map();
    this.nextId = 1;
  }

  // Load graphic
  load(src, sx, sy, sw, sh) {
    const id = this.nextId++;

    const image = new Image();
    image.src = src;

    const graphic = {
      id,
      image,
      loaded: false
    };

    // Optional: sprite sheet region
    if (sx !== undefined) {
      graphic.sx = sx;
      graphic.sy = sy;
      graphic.sw = sw || image.width;
      graphic.sh = sh || image.height;
    }

    image.onload = () => {
      graphic.loaded = true;
      if (!graphic.sw) graphic.sw = image.width;
      if (!graphic.sh) graphic.sh = image.height;
    };

    this.graphics.set(id, graphic);
    return id;
  }

  // Create a procedural graphic backed by an offscreen canvas
  create(width, height) {
    const id = this.nextId++;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx2d = canvas.getContext('2d');
    // Pre-clear to transparent
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    this.graphics.set(id, {
      id, image: canvas, canvas, ctx2d,
      loaded: true, sw: canvas.width, sh: canvas.height
    });
    return id;
  }

  // Register an existing canvas/image-like object directly as a graphic
  addCanvas(canvas, sx, sy, sw, sh) {
    const id = this.nextId++;
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    const graphic = {
      id,
      image: canvas,
      canvas,
      loaded: true,
      sw: sw || width,
      sh: sh || height
    };
    if (sx !== undefined) {
      graphic.sx = sx;
      graphic.sy = sy || 0;
    }
    this.graphics.set(id, graphic);
    return id;
  }

  // Replace a pre-reserved graphic id with decoded canvas data
  setCanvas(id, canvas, sx, sy, sw, sh) {
    const numericId = Number(id) || 0;
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    const current = this.graphics.get(numericId) || { id: numericId };
    const next = {
      ...current,
      id: numericId,
      image: canvas,
      canvas,
      loaded: true,
      sw: sw || width,
      sh: sh || height
    };
    if (sx !== undefined) {
      next.sx = sx;
      next.sy = sy || 0;
    }
    this.graphics.set(numericId, next);
    return numericId;
  }

  // Get graphic by ID
  get(id) {
    return this.graphics.get(id);
  }

  // Remove graphic
  remove(id) {
    this.graphics.delete(id);
  }

  // Clear all graphics
  clear() {
    this.graphics.clear();
    this.nextId = 1;
  }
}

// Global instance
export const Graphics = new GraphicsManager();
