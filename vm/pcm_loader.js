/**
 * PCM Audio Loader for DIV/BennuGD raw PCM files
 * DIV PCM files are typically raw 8-bit unsigned mono audio.
 */

/**
 * Loads a raw PCM file and converts it to an AudioBuffer.
 * @param {string} url - URL to the PCM file
 * @param {AudioContext} audioContext - Web Audio API context
 * @returns {Promise<AudioBuffer>} - Decoded audio buffer
 */
export async function loadPcmFile(url, audioContext) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load PCM file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const rawData = new Uint8Array(arrayBuffer);

    // DIV PCM is typically 8-bit unsigned mono at 11025Hz or 22050Hz.
    // We assume 11025Hz as the default for DIV 2 era assets.
    // If needed, this could be made configurable or auto-detected.
    const sampleRate = 11025;

    const audioBuffer = audioContext.createBuffer(1, rawData.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    // Convert 8-bit unsigned (0-255) to float (-1.0 to 1.0)
    // 128 is silence (0.0), 0 is -1.0, 255 is 1.0
    for (let i = 0; i < rawData.length; i++) {
      channelData[i] = (rawData[i] - 128) / 128.0;
    }

    return audioBuffer;
  } catch (error) {
    console.error(`Error loading PCM file from ${url}:`, error);
    throw error;
  }
}