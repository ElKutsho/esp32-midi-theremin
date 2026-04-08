export type { MidiMessage, MidiMessageType } from '../types/electron';

export type SerialEventType = 'sensorOn' | 'sensorOff' | 'octaveChange';

export interface SerialEvent {
  type: SerialEventType;
  sensorIndex: number;
  pressure: number;
  octave: number;
}

/**
 * Parst Sensor-Nachrichten vom ESP32.
 * Format: S:<index>:<pressure>  X:<index>  O:<octave>
 */
export class MidiParser {
  private buffer = '';
  private decoder = new TextDecoder();
  private listeners: ((evt: SerialEvent) => void)[] = [];

  onMessage(callback: (evt: SerialEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  feed(data: Uint8Array): void {
    this.buffer += this.decoder.decode(data, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) this.parseLine(line);
    }
  }

  private parseLine(line: string): void {
    const parts = line.split(':');
    if (parts.length < 2) return;

    const cmd = parts[0];

    switch (cmd) {
      case 'S': {
        const index = parseInt(parts[1], 10);
        const pressure = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
        if (isNaN(index) || isNaN(pressure) || index < 0 || index > 5) return;
        this.emit({ type: 'sensorOn', sensorIndex: index, pressure: Math.min(127, Math.max(0, pressure)), octave: 0 });
        break;
      }
      case 'X': {
        const index = parseInt(parts[1], 10);
        if (isNaN(index) || index < 0 || index > 5) return;
        this.emit({ type: 'sensorOff', sensorIndex: index, pressure: 0, octave: 0 });
        break;
      }
      case 'O': {
        const octave = parseInt(parts[1], 10);
        if (isNaN(octave)) return;
        this.emit({ type: 'octaveChange', sensorIndex: -1, pressure: 0, octave });
        break;
      }
    }
  }

  private emit(evt: SerialEvent): void {
    this.listeners.forEach((l) => l(evt));
  }

  reset(): void {
    this.buffer = '';
  }
}
