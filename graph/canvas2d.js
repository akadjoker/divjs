/**
 * DivLang Canvas 2D Renderer
 * Render system para Div
 */

export class CanvasRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    
    // Clear
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }
  
  // Clear screen
  clear(color = '#000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }
  
  // Draw rectangle
  drawRect(x, y, width, height, color = '#fff') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, width, height);
  }
  
  // Draw graphic
  drawGraphic(graphicId, x, y, width = 32, height = 32) {
    const graphic = Graphics.get(graphicId);
    if (!graphic) return;
    
    if (graphic.sx !== undefined) {
      // Sprite sheet region
      this.ctx.drawImage(
        graphic.image,
        graphic.sx, graphic.sy, graphic.sw, graphic.sh,
        x, y, width, height
      );
    } else {
      // Full image
      this.ctx.drawImage(graphic.image, x, y, width, height);
    }
  }
  
  // Draw text
  drawText(x, y, text, color = '#fff', font = '16px monospace') {
    this.ctx.fillStyle = color;
    this.ctx.font = font;
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(text, x, y);
  }
  
  // Get context
  getContext() {
    return this.ctx;
  }
  
  // Set size
  setSize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.width = width;
    this.height = height;
  }
}
