/**
 * DivLang Input System
 * Keyboard and mouse input
 */

export class InputManager {
  constructor() {
    this.keys = new Map();
    this.keysPressed = new Map();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    
    // Bind events
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', e => {
        this.keys.set(e.code, true);
        this.keysPressed.set(e.code, true);
      });
      
      window.addEventListener('keyup', e => {
        this.keys.set(e.code, false);
      });
      
      window.addEventListener('mousedown', () => {
        this.mouseDown = true;
      });
      
      window.addEventListener('mouseup', () => {
        this.mouseDown = false;
      });
      
      window.addEventListener('mousemove', e => {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
      });
    }
  }
  
  // Check if key is down
  keyDown(key) {
    // Handle string keys ("right", "left", "space", etc.)
    const keyMap = {
      'right': 'ArrowRight',
      'left': 'ArrowLeft',
      'up': 'ArrowUp',
      'down': 'ArrowDown',
      'space': 'Space',
      'esc': 'Escape',
      'enter': 'Enter',
      'tab': 'Tab',
      'shift': 'ShiftLeft',
      'ctrl': 'ControlLeft',
      'alt': 'AltLeft'
    };
    
    const code = keyMap[key.toLowerCase()] || key.toUpperCase();
    return this.keys.get(code) || false;
  }
  
  // Check if key was pressed (this frame)
  keyPressed(key) {
    const keyMap = {
      'right': 'ArrowRight',
      'left': 'ArrowLeft',
      'up': 'ArrowUp',
      'down': 'ArrowDown',
      'space': 'Space',
      'esc': 'Escape',
      'enter': 'Enter',
      'tab': 'Tab',
      'shift': 'ShiftLeft',
      'ctrl': 'ControlLeft',
      'alt': 'AltLeft'
    };
    
    const code = keyMap[key.toLowerCase()] || key.toUpperCase();
    return this.keysPressed.get(code) || false;
  }
  
  // Update (called each frame)
  update() {
    // Clear pressed keys
    this.keysPressed.clear();
  }
  
  // Get mouse position
  getMouseX() {
    return this.mouseX;
  }
  
  getMouseY() {
    return this.mouseY;
  }
  
  // Check if mouse is down
  isMouseDown() {
    return this.mouseDown;
  }
}

// Global instance
export const Input = new InputManager();

// Native function bindings
export function keyDown(key) {
  return Input.keyDown(key);
}

export function keyPressed(key) {
  return Input.keyPressed(key);
}
