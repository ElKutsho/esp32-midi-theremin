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

  // CC mode: send pressure as CC messages (Ableton-compatible for MIDI mapping)
  public ccMode = true;
  public ccNumber = 1; // CC1 = Mod Wheel (most universally recognized)

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

  setOctave(octave: number): void {
    this.octave = octave;
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

  // --- Serial Event Handling ---

  private handleSerialEvent(evt: SerialEvent): void {
    // Notify sensor event listeners (for UI state)
    this.sensorEventListeners.forEach((l) => l(evt));

    switch (evt.type) {
      case 'sensorOn': {
        const prevNotes = this.activeSensorNotes.get(evt.sensorIndex);
        const newNotes = this.getNotesForSensor(evt.sensorIndex);

        if (!prevNotes) {
          // New activation → send noteOn for all chord notes
          this.activeSensorNotes.set(evt.sensorIndex, newNotes);
          for (const note of newNotes) {
            const msg: MidiMessage = {
              type: 'noteOn', channel: 1, note, velocity: 100, pressure: 0,
              timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
          }
        }

        // Always send aftertouch
        for (const note of newNotes) {
          const msg: MidiMessage = {
            type: 'polyAftertouch', channel: 1, note, velocity: 0,
            pressure: evt.pressure, timestamp: Date.now(),
          };
          this.dispatchMidi(msg);
        }
        break;
      }

      case 'sensorOff': {
        const notes = this.activeSensorNotes.get(evt.sensorIndex);
        if (notes) {
          for (const note of notes) {
            const msg: MidiMessage = {
              type: 'noteOff', channel: 1, note, velocity: 0, pressure: 0,
              timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
          }
          this.activeSensorNotes.delete(evt.sensorIndex);
        }
        break;
      }

      case 'octaveChange': {
        // Turn off all active notes before octave change
        for (const [sensorIdx, notes] of this.activeSensorNotes) {
          for (const note of notes) {
            const msg: MidiMessage = {
              type: 'noteOff', channel: 1, note, velocity: 0, pressure: 0,
              timestamp: Date.now(),
            };
            this.dispatchMidi(msg);
          }
        }
        this.activeSensorNotes.clear();
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

  async listSerialPorts(): Promise<SerialPort[]> {
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
      case 'polyAftertouch':
        data.push(0xa0 | channel, msg.note, msg.pressure);
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

  /** Send a test Note + CC sweep for Ableton MIDI mapping */
  async testAftertouch(): Promise<boolean> {
    if (!this.midiConnected) {
      this.notifyError('Kein MIDI Output verbunden');
      return false;
    }
    const ccNum = this.ccNumber;
    console.log(`[MIDI Test] Sending CC${ccNum} sweep to:`, this._midiPortName);

    // Note On
    this.midiPort.send([0x90, 60, 100]);

    // CC sweep: 0 → 127 → 0 over ~800ms
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const value = i <= steps / 2
        ? Math.round((i / (steps / 2)) * 127)
        : Math.round(((steps - i) / (steps / 2)) * 127);
      setTimeout(() => {
        this.midiPort.send([0xb0, ccNum, value]);
        // Also send poly aftertouch
        this.midiPort.send([0xa0, 60, value]);
      }, i * 50);
    }

    // Note Off after sweep
    setTimeout(() => {
      this.midiPort.send([0xb0, ccNum, 0]);
      this.midiPort.send([0x80, 60, 0]);
    }, (steps + 1) * 50);

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
      const loopMidi = outputs.find((o) =>
        o.name.toLowerCase().includes('loopmidi') ||
        o.name.toLowerCase().includes('loop midi') ||
        o.name.toLowerCase().includes('virtual midi')
      );
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
