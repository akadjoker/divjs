/**
 * DivLang Runtime
 * Native functions para a VM
 */

// Native functions
export const Runtime = {
  // Collision detection
  collision(type) {
    // TODO: implement collision detection
    // Retorna o ID do processo ou 0 se não colidiu
    return 0;
  },
  
  // Check if key is pressed
  key_pressed(key) {
    // TODO: implement key detection
    return false;
  },
  
  // Check if key is down
  key_down(key) {
    // TODO: implement key detection
    return false;
  },
  
  // Load graphic
  load_graphic(src, sx, sy, sw, sh) {
    // TODO: implement graphic loading
    // Retorna o ID do gráfico
    return 0;
  },
  
  // Draw graphic
  draw(graphicId, x, y, width, height) {
    // TODO: implement drawing
  },
  
  // Draw text
  draw_text(x, y, text) {
    // TODO: implement text drawing
  },
  
  // Draw rectangle
  draw_rect(x, y, width, height, color) {
    // TODO: implement rectangle drawing
  },

  // Print message to runtime output (fallback: console)
  print(...values) {
    console.log('[PRINT]', ...values);
    return 0;
  },

  // Log message to console
  log(...values) {
    console.log('[LOG]', ...values);
    return 0;
  },

  // Get elapsed time in seconds
  get_time() {
    return performance.now() / 1000;
  },

  // Get frame delta in seconds (fallback)
  get_delta() {
    return 1 / 60;
  }
};

// Register runtime functions in VM
export function registerRuntime(vm) {
  vm.registerNative('collision', Runtime.collision);
  vm.registerNative('key_pressed', Runtime.key_pressed);
  vm.registerNative('key_down', Runtime.key_down);
  vm.registerNative('load_graphic', Runtime.load_graphic);
  vm.registerNative('draw', Runtime.draw);
  vm.registerNative('draw_text', Runtime.draw_text);
  vm.registerNative('draw_rect', Runtime.draw_rect);
  vm.registerNative('print', Runtime.print);
  vm.registerNative('log', Runtime.log);
  vm.registerNative('get_time', Runtime.get_time);
  vm.registerNative('get_delta', Runtime.get_delta);
}
