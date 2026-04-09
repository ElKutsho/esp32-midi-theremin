import { MidiParser, type SerialEvent } from './MidiParser';
import { BuiltInSynth } from './BuiltInSynth';
import type { MidiMessage, SensorNoteConfig } from '../types/electron';

const SERIAL_BAUD_RATE = 115200;

// --- MIDI Output Port abstraction ---

interface MidiOutputPort {
  list(): Promise<{ id: string; name: string }[]>;
  open(portName: string): Promise<boolean>;
  close(): Promise<void>;
  send(data: number[]): void;
}

function createElectronMidiPort(): MidiOutputPort {
  const api = window.electronAPI!.midi;
  return {
    async list() {
      try {
        const names = await api.listOutputs();
        console.log('[MIDI/Electron] Available outputs:', names);
        return names.map((name) => ({ id: name, name }));
      } catch (err) {
        console.error('[MIDI/Electron] Failed to list:', err);
        return [];
      }
    },
    async open(portName) {
      try {
        const ok = await api.openOutput(portName);
        if (ok) console.log('[MIDI/Electron] Opened:', portName);
        return ok;
      } catch (err) {
        console.error('[MIDI/Electron] Open failed:', err);
        return false;
      }
    },
    async close() {
      try { await api.closeOutput(); } catch {}
    },
    send(data) {
      api.send(data);
    },
  };
}

function createWebMidiPort(): MidiOutputPort {
  let midiAccess: MIDIAccess | null = null;
  let midiOutput: MIDIOutput | null = null;

  async function ensureAccess(): Promise<MIDIAccess | null> {
    if (midiAccess) return midiAccess;
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      console.log('[MIDI/Web] Access granted');
      return midiAccess;
    } catch (err) {
      console.error('[MIDI/Web] Access denied:', err);
      return null;
    }
  }

  return {
    async list() {
      const access = await ensureAccess();
      if (!access) return [];
      const outputs = Array.from(access.outputs.values());
      console.log('[MIDI/Web] Available outputs:', outputs.map((o) => o.name));
      return outputs.map((o) => ({ id: o.id, name: o.name || 'Unknown' }));
    },
    async open(portName) {
      const access = await ensureAccess();
      if (!access) return false;
      const output = Array.from(access.outputs.values()).find(
        (o) => o.name === portName || o.id === portName
      );
      if (!output) return false;
      try {
        await output.open();
        midiOutput = output;
        console.log('[MIDI/Web] Opened:', output.name);
        return true;
      } catch (err) {
        console.error('[MIDI/Web] Open failed:', err);
        return false;
      }
    },
    async close() {
      if (midiOutput) {
        try { midiOutput.close(); } catch {}
        midiOutput = null;
      }
    },
    send(data) {
      if (midiOutput) {
        try { midiOutput.send(new Uint8Array(data)); } catch {}
      }
    },
  };
}

export interface BridgeState {
  serialConnected: boolean;
  serialPortName: string;
  midiConnected: boolean;
  midiPortName: string;
  synthEnabled: boolean;
  error: string | null;
}

export class SerialMidiBridge {
  private serialPort: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private midiConnected = false;
  private parser = new MidiParser();
  private reading = false;
  private _serialPortName = '';
  private _midiPortName = '';

  // MIDI output — single abstraction for Electron (JZZ) or Browser (Web MIDI)
  private midiPort: MidiOutputPort;

  // Note config & state
  private sensorConfigs: SensorNoteConfig[] = [];
  private octave = 4;
  private activeSensorNotes: Map<number, number[]> = new Map(); // sensor index → active MIDI notes
  private activeSensorChannels: Map<number, number[]> = new Map(); // sensor index → allocated channels per note

  // MPE channel allocator: channels 2-16 (15 member channels)
  private mpeChannelPool = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  // CC mode: send pressure as CC messages (Ableton-compatible for MIDI mapping)
  // Default OFF — only enable when user explicitly wants CC mapping
  public ccMode = false;
  public ccNumber = 1; // CC1 = Mod Wheel (most universally recognized)

  // Aftertouch calibration
  public atInvert = false;     // false = nah=max, true = weit=max
  public atFloor = 64;         // values below floor → 0 (deadzone, default 50%)

  // Aftertouch smoothing (EMA per sensor)
  private smoothedPressure: Map<number, number> = new Map();
  private readonly smoothingAlpha = 0.25; // 0 = very smooth, 1 = no smoothing
  private readonly minPressureChange = 2;  // ignore changes smaller than this

  public readonly synth = new BuiltInSynth();

  private stateListeners: ((state: BridgeState) => void)[] = [];
  private messageListeners: ((msg: MidiMessage) => void)[] = [];
  private sensorEventListeners: ((evt: SerialEvent) => void)[] = [];

  constructor() {
    this.midiPort = window.electronAPI?.midi
      ? createElectronMidiPort()
      : createWebMidiPort();
    this.parser.onMessage((evt) => this.handleSerialEvent(evt));
  }

  // --- Config ---

  setSensorConfigs(configs: SensorNoteConfig[]): void {
    this.sensorConfigs = configs;
  }

  private getNotesForSensor(sensorIndex: number): number[] {
    const config = this.sensorConfigs[sensorIndex];
    if (!config) return [];
    const octave = config.octave ?? this.octave;
    return config.chordPattern.map((offset) => {
      const semitone = config.rootSemitone + offset;
      return Math.min(127, Math.max(0, octave * 12 + semitone));
    });
  }

  private allocateChannel(): number {
    // Grab first available MPE member channel
    for (const ch of this.mpeChannelPool) {
      this.mpeChannelPool.delete(ch);
      return ch;
    }
    // Fallback: reuse channel 2 if all 15 are in use (shouldn't happen with 6 sensors)
    return 2;
  }

  private releaseChannel(ch: number): void {
    this.mpeChannelPool.add(ch);
  }

  /** Apply aftertouch calibration: invert + deadzone + rescale */
  private calibratePressure(raw: number): number {
    let v = this.atInvert ? 127 - raw : raw;
    if (v <= this.atFloor) return 0;
    // Rescale floor..127 → 0..127
    return Math.round(((v - this.atFloor) / (127 - this.atFloor)) * 127);
  }

  // --- Serial Event Handling ---

  private handleSerialEvent(evt: SerialEvent): void {
    // Notify sensor event listeners (for UI state)
    this.sensorEventListeners.forEach((l) => l(evt));

    switch (evt.type) {
      case 'sensorOn': {
        const prevNotes = this.activeSensorNotes.get(evt.sensorIndex);
        const newNotes = this.getNotesForSensor(evt.sensorIndex);

        const calibrated = this.calibratePressure(evt.pressure);

        if (!prevNotes) {
          // New activation → allocate one MPE channel per note & send noteOn
          this.smoothedPressure.set(evt.sensorIndex, calibrated);
          this.activeSensorNotes.set(evt.sensorIndex, newNotes);
          const channels: number[] = [];
          for (const note of newNotes) {
            const ch = this.allocateChannel();
            channels.push(ch);
            const msg: MidiMessage = {
              type: 'noteOn', channel: ch, note, velocity: 100, pressure: 0,
              timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
          }
          this.activeSensorChannels.set(evt.sensorIndex, channels);
        }

        // Smooth aftertouch with EMA
        const prev = this.smoothedPressure.get(evt.sensorIndex) ?? calibrated;
        const smoothed = Math.round(prev + this.smoothingAlpha * (calibrated - prev));
        const clamped = Math.min(127, Math.max(0, smoothed));

        // Only send if change is significant enough
        if (Math.abs(clamped - prev) >= this.minPressureChange || !prevNotes) {
          this.smoothedPressure.set(evt.sensorIndex, clamped);
          // Send Channel Aftertouch on each allocated channel
          const channels = this.activeSensorChannels.get(evt.sensorIndex) ?? [];
          for (const ch of channels) {
            const msg: MidiMessage = {
              type: 'channelAftertouch', channel: ch, note: 0, velocity: 0,
              pressure: clamped, timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
          }
        }
        break;
      }

      case 'sensorOff': {
        const notes = this.activeSensorNotes.get(evt.sensorIndex);
        const channels = this.activeSensorChannels.get(evt.sensorIndex);
        if (notes && channels) {
          for (let i = 0; i < notes.length; i++) {
            const ch = channels[i];
            const msg: MidiMessage = {
              type: 'noteOff', channel: ch, note: notes[i], velocity: 0, pressure: 0,
              timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
            this.releaseChannel(ch);
          }
          this.activeSensorNotes.delete(evt.sensorIndex);
          this.activeSensorChannels.delete(evt.sensorIndex);
          this.smoothedPressure.delete(evt.sensorIndex);
        }
        break;
      }

      case 'octaveChange': {
        // Turn off all active notes before octave change
        for (const [sensorIdx, notes] of this.activeSensorNotes) {
          const channels = this.activeSensorChannels.get(sensorIdx) ?? [];
          for (let i = 0; i < notes.length; i++) {
            const ch = channels[i];
            const msg: MidiMessage = {
              type: 'noteOff', channel: ch, note: notes[i], velocity: 0, pressure: 0,
              timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
            if (ch) this.releaseChannel(ch);
          }
        }
        this.activeSensorNotes.clear();
        this.activeSensorChannels.clear();
        this.octave = evt.octave;
        break;
      }
    }
  }

  private dispatchMidi(msg: MidiMessage): void {
    this.synth.processMidiMessage(msg);
    this.sendToMidiOutput(msg);
    this.messageListeners.forEach((l) => l(msg));
  }

  // --- State ---

  get state(): BridgeState {
    return {
      serialConnected: this.serialPort !== null && this.reading,
      serialPortName: this._serialPortName,
      midiConnected: this.midiConnected,
      midiPortName: this._midiPortName,
      synthEnabled: this.synth.enabled,
      error: null,
    };
  }

  onStateChange(callback: (state: BridgeState) => void): () => void {
    this.stateListeners.push(callback);
    return () => { this.stateListeners = this.stateListeners.filter((l) => l !== callback); };
  }

  onMidiMessage(callback: (msg: MidiMessage) => void): () => void {
    this.messageListeners.push(callback);
    return () => { this.messageListeners = this.messageListeners.filter((l) => l !== callback); };
  }

  onSensorEvent(callback: (evt: SerialEvent) => void): () => void {
    this.sensorEventListeners.push(callback);
    return () => { this.sensorEventListeners = this.sensorEventListeners.filter((l) => l !== callback); };
  }

  private notifyState(): void {
    const s = this.state;
    this.stateListeners.forEach((l) => l(s));
  }

  private notifyError(error: string): void {
    const s = { ...this.state, error };
    this.stateListeners.forEach((l) => l(s));
  }

  // --- Serial (Web Serial API) ---

  private async listSerialPorts(): Promise<SerialPort[]> {
    if (!('serial' in navigator)) return [];
    return navigator.serial.getPorts();
  }

  async connectSerial(port?: SerialPort): Promise<void> {
    try {
      if (!port) {
        port = await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x10c4, usbProductId: 0xea60 },
            { usbVendorId: 0x1a86, usbProductId: 0x7523 },
            { usbVendorId: 0x0403, usbProductId: 0x6001 },
            { usbVendorId: 0x303a, usbProductId: 0x1001 },
            { usbVendorId: 0x303a, usbProductId: 0x0002 },
          ],
        });
      }

      await port.open({ baudRate: SERIAL_BAUD_RATE });
      this.serialPort = port;

      const info = port.getInfo();
      this._serialPortName = `USB ${info.usbVendorId?.toString(16).toUpperCase() || '???'}:${info.usbProductId?.toString(16).toUpperCase() || '???'}`;

      this.notifyState();
      this.startReading();
    } catch (err: any) {
      if (err.name !== 'NotFoundError') {
        this.notifyError(`Serial: ${err.message}`);
      }
      throw err;
    }
  }

  private async startReading(): Promise<void> {
    if (!this.serialPort?.readable) return;
    this.reading = true;
    this.notifyState();

    try {
      while (this.serialPort.readable && this.reading) {
        this.reader = this.serialPort.readable.getReader();
        try {
          while (true) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) this.parser.feed(value);
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (err: any) {
      console.error('[Serial] Read error:', err);
      if (this.reading) {
        this.notifyError(`Serial getrennt: ${err.message}`);
      }
    } finally {
      this.reading = false;
      this.notifyState();
    }
  }

  async disconnectSerial(): Promise<void> {
    this.reading = false;
    if (this.reader) {
      try { await this.reader.cancel(); } catch {}
    }
    if (this.serialPort) {
      try { await this.serialPort.close(); } catch {}
      this.serialPort = null;
    }
    this._serialPortName = '';
    this.parser.reset();
    this.activeSensorNotes.clear();
    this.activeSensorChannels.clear();
    this.mpeChannelPool = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    this.synth.allNotesOff();
    this.notifyState();
  }

  // --- MIDI Output ---

  async listMidiOutputs(): Promise<{ id: string; name: string }[]> {
    return this.midiPort.list();
  }

  async selectMidiOutput(portName: string): Promise<void> {
    const ok = await this.midiPort.open(portName);
    if (ok) {
      this.midiConnected = true;
      this._midiPortName = portName;
      // Send MPE Configuration Message (MCM) on Ch 1
      // RPN 0x0006 = MPE Configuration, Data Entry = zone size
      this.midiPort.send([0xb0, 0x65, 0x00]); // CC101 RPN MSB = 0
      this.midiPort.send([0xb0, 0x64, 0x06]); // CC100 RPN LSB = 6 (MCM)
      this.midiPort.send([0xb0, 0x06, 0x0f]); // CC6   Data Entry = 15 member channels (ch 2-16)
      this.midiPort.send([0xb0, 0x65, 0x7f]); // CC101 RPN reset
      this.midiPort.send([0xb0, 0x64, 0x7f]); // CC100 RPN reset
      console.log('[MIDI] Sent MPE Configuration: Lower Zone, 15 member channels (ch 2-16)');
    } else {
      this.notifyError(`MIDI "${portName}" konnte nicht geoeffnet werden`);
    }
    this.notifyState();
  }

  async disconnectMidiOutput(): Promise<void> {
    await this.midiPort.close();
    this.midiConnected = false;
    this._midiPortName = '';
    this.notifyState();
  }

  private sendToMidiOutput(msg: MidiMessage): void {
    if (!this.midiConnected) return;

    const channel = (msg.channel - 1) & 0x0f;
    const data: number[] = [];
    switch (msg.type) {
      case 'noteOn':
        data.push(0x90 | channel, msg.note, msg.velocity);
        break;
      case 'noteOff':
        data.push(0x80 | channel, msg.note, 0);
        // Reset CC to 0 on note off if CC mode is active
        if (this.ccMode) {
          this.midiPort.send([0xb0 | channel, this.ccNumber, 0]);
        }
        break;
      case 'channelAftertouch':
        data.push(0xd0 | channel, msg.pressure);
        // Also send as CC message when CC mode is enabled (for Ableton MIDI mapping)
        if (this.ccMode) {
          this.midiPort.send([0xb0 | channel, this.ccNumber, msg.pressure]);
        }
        break;
    }
    if (data.length === 0) return;
    this.midiPort.send(data);
  }

  async testMidiOutput(): Promise<boolean> {
    if (!this.midiConnected) {
      this.notifyError('Kein MIDI Output verbunden');
      return false;
    }
    console.log('[MIDI Test] Sending C4 to:', this._midiPortName);
    this.midiPort.send([0x90, 60, 100]);
    setTimeout(() => this.midiPort.send([0x80, 60, 0]), 500);
    return true;
  }

  /** Send test aftertouch sweep on all 6 channels (one per sensor) */
  async testAftertouch(): Promise<boolean> {
    if (!this.midiConnected) {
      this.notifyError('Kein MIDI Output verbunden');
      return false;
    }
    console.log('[MIDI Test] MPE Aftertouch sweep on ch2-7 to:', this._midiPortName);

    const steps = 16;
    const channelDelay = (steps + 2) * 50 + 100; // time per channel

    for (let sensor = 0; sensor < 6; sensor++) {
      const ch = sensor + 1; // MIDI channel byte (0-indexed: ch 1=0x01 → member ch 2-7)
      const baseDelay = sensor * channelDelay;

      // Note On on this member channel
      setTimeout(() => {
        this.midiPort.send([0x90 | ch, 60, 100]);
      }, baseDelay);

      // Channel Aftertouch sweep: 0 → 127 → 0
      for (let i = 0; i <= steps; i++) {
        const value = i <= steps / 2
          ? Math.round((i / (steps / 2)) * 127)
          : Math.round(((steps - i) / (steps / 2)) * 127);
        setTimeout(() => {
          this.midiPort.send([0xd0 | ch, value]);
        }, baseDelay + (i + 1) * 50);
      }

      // Note Off after sweep
      setTimeout(() => {
        this.midiPort.send([0xd0 | ch, 0]);
        this.midiPort.send([0x80 | ch, 60, 0]);
      }, baseDelay + (steps + 1) * 50);
    }

    return true;
  }

  // --- Auto-Connect ---

  async autoConnect(): Promise<void> {
    const ports = await this.listSerialPorts();
    if (ports.length > 0) {
      await this.connectSerial(ports[0]);
    } else {
      await this.connectSerial();
    }

    const outputs = await this.listMidiOutputs();
    if (outputs.length > 0) {
      const loopMidi = outputs.find((o) => {
        const name = o.name.toLowerCase();
        return name.includes('loopmidi') ||
          name.includes('loop midi') ||
          name.includes('loopbe') ||
          name.includes('virtual midi');
      });
      await this.selectMidiOutput((loopMidi || outputs[0]).name);
    }
  }

  // --- Cleanup ---

  async destroy(): Promise<void> {
    await this.disconnectSerial();
    await this.disconnectMidiOutput();
    this.synth.destroy();
    this.stateListeners = [];
    this.messageListeners = [];
    this.sensorEventListeners = [];
  }
}
