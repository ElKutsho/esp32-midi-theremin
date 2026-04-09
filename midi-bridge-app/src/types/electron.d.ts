export type MidiMessageType = 'noteOn' | 'noteOff' | 'channelAftertouch';

export interface MidiMessage {
  type: MidiMessageType;
  channel: number;
  note: number;
  velocity: number;
  pressure: number;
  timestamp: number;
}

export interface SensorNoteConfig {
  rootSemitone: number;       // 0-11 (C=0, C#=1, ... B=11)
  chordPattern: number[];     // offsets from root, e.g. [0] single, [0,4,7] major
  label: string;              // display label, e.g. "C" or "Cmaj"
  octave: number;             // per-sensor octave (0-8)
}

export interface SensorState {
  index: number;
  noteName: string;
  active: boolean;
  midiNote: number;
  pressure: number;
  lastActivity: number;
}

export interface CustomChord {
  id: string;
  label: string;
  pattern: number[];
}

export interface Template {
  id: string;
  name: string;
  configs: SensorNoteConfig[];
  builtIn?: boolean;
}

export interface AppState {
  serial: {
    connected: boolean;
    portName: string;
  };
  midi: {
    outputConnected: boolean;
    outputPortName: string;
    availableOutputs: { id: string; name: string }[];
  };
  sensors: SensorState[];
  sensorConfigs: SensorNoteConfig[];
  synthEnabled: boolean;
  ccMode: boolean;
  atInvert: boolean;
  atFloor: number;
  octave: number;
  recentMessages: MidiMessage[];
  error: string | null;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      midi: {
        listOutputs: () => Promise<string[]>;
        openOutput: (portName: string) => Promise<boolean>;
        closeOutput: () => Promise<void>;
        send: (data: number[]) => void;
        testDirect: () => Promise<string>;
      };
    };
  }
}
