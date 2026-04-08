import type { MidiMessage } from '../types/electron';

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  note: number;
  active: boolean;
}

export type WaveShape = 'sine' | 'triangle' | 'sawtooth' | 'square';

export class BuiltInSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private voices: Map<number, Voice> = new Map();
  private _enabled = false;
  private _volume = 0.7;
  private _waveShape: WaveShape = 'sawtooth';
  private _reverbMix = 0.3;
  private _filterCutoff = 2000;
  private _attackTime = 0.05;
  private _releaseTime = 0.3;

  get enabled() { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; if (!v) this.allNotesOff(); }

  get volume() { return this._volume; }
  set volume(v: number) {
    this._volume = v;
    if (this.masterGain) this.masterGain.gain.setValueAtTime(v, this.ctx!.currentTime);
  }

  get waveShape() { return this._waveShape; }
  set waveShape(v: WaveShape) { this._waveShape = v; }

  get reverbMix() { return this._reverbMix; }
  set reverbMix(v: number) {
    this._reverbMix = v;
    if (this.reverbGain && this.dryGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.reverbGain.gain.setValueAtTime(v, t);
      this.dryGain.gain.setValueAtTime(1 - v * 0.5, t);
    }
  }

  get filterCutoff() { return this._filterCutoff; }
  set filterCutoff(v: number) { this._filterCutoff = v; }

  get analyserNode(): AnalyserNode | null { return this.analyser; }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();

      // Master gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._volume;

      // Analyser for visualization
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;

      // Reverb
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = await this.createReverbIR(this.ctx, 2.0, 2.0);

      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = this._reverbMix;

      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 1 - this._reverbMix * 0.5;

      // Routing: voices → masterGain → dry/reverb → analyser → output
      this.masterGain.connect(this.dryGain);
      this.masterGain.connect(this.reverb);
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.analyser);
      this.dryGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return this.ctx;
  }

  private async createReverbIR(ctx: AudioContext, duration: number, decay: number): Promise<AudioBuffer> {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }

    return buffer;
  }

  private midiNoteToFreq(note: number): number {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  async processMidiMessage(msg: MidiMessage): Promise<void> {
    if (!this._enabled) return;

    switch (msg.type) {
      case 'noteOn':
        await this.noteOn(msg.note, msg.velocity);
        break;
      case 'noteOff':
        this.noteOff(msg.note);
        break;
      case 'polyAftertouch':
        this.aftertouch(msg.note, msg.pressure);
        break;
    }
  }

  private async noteOn(note: number, velocity: number): Promise<void> {
    const ctx = await this.ensureContext();

    // Stop existing voice for this note
    this.noteOff(note);

    const freq = this.midiNoteToFreq(note);
    const vel = velocity / 127;

    // Create oscillator
    const osc = ctx.createOscillator();
    osc.type = this._waveShape;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    // Slight detune for richness
    osc.detune.setValueAtTime(Math.random() * 6 - 3, ctx.currentTime);

    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this._filterCutoff * vel, ctx.currentTime);
    filter.Q.setValueAtTime(2, ctx.currentTime);

    // Gain envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vel * 0.4, ctx.currentTime + this._attackTime);

    // Connect: osc → filter → gain → masterGain
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(ctx.currentTime);

    this.voices.set(note, { oscillator: osc, gain, filter, note, active: true });
  }

  private noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;

    const t = this.ctx.currentTime;
    voice.active = false;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
    voice.gain.gain.linearRampToValueAtTime(0, t + this._releaseTime);

    voice.oscillator.stop(t + this._releaseTime + 0.05);
    this.voices.delete(note);
  }

  private aftertouch(note: number, pressure: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;

    const t = this.ctx.currentTime;
    const p = pressure / 127;

    // Aftertouch modulates filter cutoff
    const cutoff = this._filterCutoff * 0.3 + this._filterCutoff * 1.5 * p;
    voice.filter.frequency.linearRampToValueAtTime(cutoff, t + 0.05);

    // Subtle volume modulation
    const vol = 0.2 + p * 0.3;
    voice.gain.gain.linearRampToValueAtTime(vol, t + 0.05);
  }

  allNotesOff(): void {
    for (const [note] of this.voices) {
      this.noteOff(note);
    }
  }

  getFrequencyData(): Uint8Array | null {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  getWaveformData(): Uint8Array | null {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  destroy(): void {
    this.allNotesOff();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
