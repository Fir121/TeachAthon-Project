// The AudioContext resamples the microphone to 24 kHz before this processor.
class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(2400);
    this.used = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush") this.flush();
    };
  }
  flush() {
    if (this.used) {
      const data = this.samples.slice(0, this.used);
      this.port.postMessage(data.buffer, [data.buffer]);
      this.used = 0;
    }
    this.port.postMessage("flushed");
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const sample = Math.max(-1, Math.min(1, channel[i]));
        this.samples[this.used++] =
          sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        if (this.used === 2400) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PCMRecorder);
