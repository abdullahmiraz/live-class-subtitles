// Runs in a 16 kHz AudioContext: Chrome resamples the tab audio for us.
// Collects mono samples and posts 100 ms Int16 chunks to the main thread.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(1600);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const chans = input.length;
    const len = input[0].length;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let c = 0; c < chans; c++) v += input[c][i];
      v /= chans;
      this.chunk[this.n++] = Math.max(-1, Math.min(1, v)) * 0x7fff;
      if (this.n === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(1600);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);
