/**
 * DIV Games Studio's built-in 6x8 system font (its FONT 0).
 *
 * Verbatim copy of `_06x08[]` from the original runtime
 * (DIV-Games-Studio/src/runtime/06x08.h), base64-encoded: 256 glyphs of
 * 6 bytes each, indexed by character code. Each glyph is 8 rows of 6
 * bits packed continuously MSB-first, so row r occupies bits
 * [r*6, r*6+6) of the 48-bit run.
 */

const FONT_6X8_BASE64 =
  'AAAAAAAAci2i+icAc+q+i+cAU+++ccIAIc+++cIAcc+++IcAIc++II+AAAcccAAA++iii++A+iiiii+A++iqi++AOCKQ4o4AcUcIIcIAeSeQQwwA+i+SS22AIqc2cqIAw48+84wAGOe+eOGAIc+I+cIAUUUUUAUAeqaKKKKAGIcUcIwAAAAA+i+AIc+I+c+AIc+IIIIAIIII+cIAAIM+MIAAAIY+YIAAAAgg+AAAAU2+2UAAAIIcc++A++ccIIAAAAAAAAAAIIIIIAIAUUUAAAAAUU+U+UUAIeocK8IAwyEIQmGAQooSqkaAYIQAAAAAEIQQQIEAQIEEEIQAAIqcqIAAAII+IIAAAAAAYIQAAAA+AAAAAAAAAYYAACEIQgAAcimqyicAIYIIIIcAciCEIQ+A+EIECicAEMUk+EEA+g8CCicAMQg8iicA+CEIQQQAciiciicAciieCEYAAYYAYYAAAYYAYIQAEIQgQIEAAA+A+AAAQIECEIQAciCEIAIAciCaqqcAcii+iiiA8ii8ii8AcigggicA4kiiik4A+gg8gg+A+gg8gggAciguiieAiii+iiiAcIIIIIcAOEEEEkYAikowokiAgggggg+Ai2qiiiiAiyqmiiiAciiiiicA8ii8gggAciiiqkaA8ii8okiAcigcCicA+IIIIIIAiiiiiicAiiiiiUIAiiiiqqUAiiUIUiiAiiiUIIIA+CEIQg+AcQQQQQcAAgQIECAAcEEEEEcAIUiAAAAAAAAAAA+AIIIAAAAAAAcCeieAggsyii8AAAcggicACCamiieAAAci+gcAGIcIIIIAAAeiieCcggsyiiiAIAYIIIcAEAMEEkYAQQSUYUSAYIIIIIcAAA0qqiiAAAsyiiiAAAciiicAAA8ii8ggAAeiieCCAAsygggAAAegcC8AAQ4QQSMAAAiiimaAAAiiiUIAAAiiqqUAAAyMIYmAAAiiieCcAA+EIQ+AGIIwIIGAIIIAIIIAwIIGIIwAasAAAAAAAIUiii+AAAegeEYAiAiiimaAEIci+gcAcicCeieAiAcCeieAQIcCeieAIIcCeieAAcgicEYAcici+gcAiAci+gcAQIci+gcAiAYIIIcAciYIIIcAQIYIIIcAici+iiiAIci+iiiAM+g8gg+A+IIcooeAOYo+oouAciciiicAiAciiicAQIciiicAciAiimaAQIiiimaAiAiSMIwAiIUiiUIAiAiiiicAIIegeIIAMSQ8QQ+AiU+I+IIAwoo0ukmAEKIcIoQAEIcCeieAEIYIIIcAEIciiicAEIiiimaA+AsyiiiA+AyqmiiAMUOA+AAAcUcA+AAAIAIQgicAAAA+ggAAAAA+CCAAikoWiEGAikoSqOCAIAIIIIIAAKUoUKAAAoUKUoAAqAVAqAVAqVqVqVqV/q/V/q/VIIIIIIIIIII4IIIIII4I4IIIUUU0UUUUAAA8UUUUAA4I4IIIUU0E0UUUUUUUUUUUAA8E0UUUUU0E8AAAUUU8AAAAII4I4AAAAAA4IIIIIIIPAAAAIII/AAAAAAA/IIIIIIIPIIIIAAA/AAAAIII/IIIIIIPIPIIIUUUXUUUUUUXQfAAAAAfQXUUUUU3A/AAAAA/A3UUUUUXQXUUUAA/A/AAAUU3A3UUUII/A/AAAUUU/AAAAAA/A/IIIAAA/UUUUUUUfAAAAIIPIPAAAAAPIPIIIAAAfUUUUUUU/UUUUII/I/IIIIII4AAAAAAAPIIII////////AAAA////44444444HHHHHHHH////AAAAAAakkkaAYkokiisA+iiggggAAAA+UUUA+iQIQi+AAAAekkYAiiiysggAAYuIIIIAcIUiUIcAAci+iicAAciiiU2AMQIciicAAAcqqcAACEcqqcwAIIOIIECAciiiiiiAA+A+A+AAIcIAcAAAQIEIQA+AEIQIEA+AEKKIIIIIIIIIooQAYYA8AYYAAakAakAAMSSMAAAAMMAAAAAAAAAIAAAAGEEkUMEAYUUAAAAAMEIMAAAAAcccccAAAAAAAAAA';

export const FONT_6X8_WIDTH = 6;
export const FONT_6X8_HEIGHT = 8;

let decoded = null;

function decodeFont() {
  if (decoded) {
    return decoded;
  }
  const binary = atob(FONT_6X8_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  decoded = bytes;
  return decoded;
}

// True when the pixel at (col,row) of `code` is set.
export function font6x8Pixel(code, col, row) {
  const bytes = decodeFont();
  const base = (code & 0xFF) * 6;
  const bit = row * FONT_6X8_WIDTH + col;
  const byte = bytes[base + (bit >> 3)];
  if (byte === undefined) {
    return false;
  }
  return (byte & (0x80 >> (bit & 7))) !== 0;
}
