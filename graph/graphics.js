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

// Native function bindings
export function loadGraphic(src, sx, sy, sw, sh) {
  return Graphics.load(src, sx, sy, sw, sh);
}

export function drawGraphic(graphicId, x, y, width, height) {
  // Will be called by renderer
  return { graphicId, x, y, width, height };
}
