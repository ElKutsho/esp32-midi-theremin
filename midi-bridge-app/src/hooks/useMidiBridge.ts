import { useState, useEffect, useRef, useCallback } from 'react';
import { SerialMidiBridge } from '../lib/SerialMidiBridge';
import type { MidiMessage, SensorState, SensorNoteConfig, AppState } from '../types/electron';

const MAX_MESSAGES = 50;
const STORAGE_KEY = 'midi-bridge-sensor-configs';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const CHORD_TYPES = [
  { label: 'Single', pattern: [0] },
  { label: 'Maj', pattern: [0, 4, 7] },
  { label: 'Min', pattern: [0, 3, 7] },
  { label: 'Power', pattern: [0, 7] },
  { label: '7', pattern: [0, 4, 7, 10] },
  { label: 'm7', pattern: [0, 3, 7, 10] },
  { label: 'Dim', pattern: [0, 3, 6] },
  { label: 'Aug', pattern: [0, 4, 8] },
  { label: 'Sus2', pattern: [0, 2, 7] },
  { label: 'Sus4', pattern: [0, 5, 7] },
] as const;

export function getConfigLabel(config: SensorNoteConfig, allChordTypes?: { label: string; pattern: number[] }[]): string {
  const rootName = NOTE_NAMES[config.rootSemitone % 12];
  const types = allChordTypes || CHORD_TYPES;
  const chord = types.find((c) =>
    c.pattern.length === config.chordPattern.length &&
    c.pattern.every((v, i) => v === config.chordPattern[i])
  );
  if (chord && chord.label === 'Single') return rootName;
  return `${rootName}${chord?.label || ''}`;
}

const DEFAULT_CONFIGS: SensorNoteConfig[] = [
  { rootSemitone: 0, chordPattern: [0], label: 'C', octave: 4 },
  { rootSemitone: 4, chordPattern: [0], label: 'E', octave: 4 },
  { rootSemitone: 7, chordPattern: [0], label: 'G', octave: 4 },
  { rootSemitone: 9, chordPattern: [0], label: 'A', octave: 4 },
  { rootSemitone: 0, chordPattern: [0], label: 'C', octave: 5 },
  { rootSemitone: 2, chordPattern: [0], label: 'D', octave: 4 },
];

function loadConfigs(): SensorNoteConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === 6) {
        return parsed.map((c: any, i: number) => ({
          ...c,
          octave: c.octave ?? DEFAULT_CONFIGS[i]?.octave ?? 4,
        }));
      }
    }
  } catch {}
  // Ungültige/fehlende Daten → reset & saubere Defaults speichern
  const defaults = DEFAULT_CONFIGS.map((c) => ({ ...c }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  return defaults;
}

function saveConfigs(configs: SensorNoteConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

function createDefaultSensors(configs: SensorNoteConfig[]): SensorState[] {
  return configs.map((config, i) => ({
    index: i,
    noteName: config.label,
    active: false,
    midiNote: config.octave * 12 + config.rootSemitone,
    pressure: 0,
    lastActivity: 0,
  }));
}

export function useMidiBridge() {
  const bridgeRef = useRef<SerialMidiBridge | null>(null);
  const [state, setState] = useState<AppState>(() => {
    const configs = loadConfigs();
    return {
      serial: { connected: false, portName: '' },
      midi: { outputConnected: false, outputPortName: '', availableOutputs: [] },
      sensors: createDefaultSensors(configs),
      sensorConfigs: configs,
      synthEnabled: false,
      ccMode: true,
      octave: 4,
      recentMessages: [],
      error: null,
    };
  });

  const sensorsRef = useRef(state.sensors);
  const octaveRef = useRef(state.octave);
  const messagesRef = useRef<MidiMessage[]>([]);
  const configsRef = useRef(state.sensorConfigs);

  useEffect(() => {
    const bridge = new SerialMidiBridge();
    bridgeRef.current = bridge;

    // Set initial config
    bridge.setSensorConfigs(configsRef.current);

    bridge.onStateChange((bridgeState) => {
      setState((prev) => ({
        ...prev,
        serial: {
          connected: bridgeState.serialConnected,
          portName: bridgeState.serialPortName,
        },
        midi: {
          ...prev.midi,
          outputConnected: bridgeState.midiConnected,
          outputPortName: bridgeState.midiPortName,
        },
        error: bridgeState.error,
      }));
    });

    // Handle sensor events (for UI state)
    bridge.onSensorEvent((evt) => {
      const sensors = [...sensorsRef.current];

      switch (evt.type) {
        case 'sensorOn': {
          const config = configsRef.current[evt.sensorIndex];
          if (!config) break;
          sensors[evt.sensorIndex] = {
            ...sensors[evt.sensorIndex],
            active: true,
            midiNote: config.octave * 12 + config.rootSemitone,
            pressure: evt.pressure,
            lastActivity: Date.now(),
          };
          break;
        }
        case 'sensorOff': {
          sensors[evt.sensorIndex] = {
            ...sensors[evt.sensorIndex],
            active: false,
            pressure: 0,
            lastActivity: Date.now(),
          };
          break;
        }
        case 'octaveChange': {
          octaveRef.current = evt.octave;
          // Update all sensor configs to new base octave
          const newConfigs = configsRef.current.map((c) => ({ ...c, octave: evt.octave }));
          configsRef.current = newConfigs;
          saveConfigs(newConfigs);
          bridgeRef.current?.setSensorConfigs(newConfigs);
          // Reset all sensors on octave change
          for (let i = 0; i < sensors.length; i++) {
            sensors[i] = {
              ...sensors[i],
              active: false,
              pressure: 0,
              midiNote: evt.octave * 12 + (newConfigs[i]?.rootSemitone ?? 0),
            };
          }
          setState((prev) => ({ ...prev, sensors, sensorConfigs: newConfigs, octave: evt.octave }));
          sensorsRef.current = sensors;
          return;
        }
      }

      sensorsRef.current = sensors;
      setState((prev) => ({ ...prev, sensors }));
    });

    // Handle MIDI messages (for log)
    bridge.onMidiMessage((msg) => {
      const messages = [msg, ...messagesRef.current].slice(0, MAX_MESSAGES);
      messagesRef.current = messages;
      setState((prev) => ({ ...prev, recentMessages: messages }));
    });

    // Init MIDI outputs
    bridge.listMidiOutputs().then((outputs) => {
      setState((prev) => ({
        ...prev,
        midi: {
          ...prev.midi,
          availableOutputs: outputs,
        },
      }));
    });

    // Auto-refresh MIDI outputs every 3s (detects hot-plugged devices like loopMIDI)
    const refreshInterval = setInterval(async () => {
      try {
        const outputs = await bridge.listMidiOutputs();
        setState((prev) => {
          const prevNames = prev.midi.availableOutputs.map((o) => o.name).join(',');
          const newNames = outputs.map((o) => o.name).join(',');
          if (prevNames === newNames) return prev;
          return { ...prev, midi: { ...prev.midi, availableOutputs: outputs } };
        });
      } catch {}
    }, 3000);

    return () => {
      clearInterval(refreshInterval);
      bridge.destroy();
    };
  }, []);

  const updateSensorConfig = useCallback((sensorIndex: number, config: SensorNoteConfig) => {
    setState((prev) => {
      const newConfigs = [...prev.sensorConfigs];
      newConfigs[sensorIndex] = config;
      saveConfigs(newConfigs);
      configsRef.current = newConfigs;

      // Update bridge config
      bridgeRef.current?.setSensorConfigs(newConfigs);

      // Update sensor display
      const newSensors = [...prev.sensors];
      newSensors[sensorIndex] = {
        ...newSensors[sensorIndex],
        noteName: config.label,
        midiNote: config.octave * 12 + config.rootSemitone,
      };
      sensorsRef.current = newSensors;

      return { ...prev, sensorConfigs: newConfigs, sensors: newSensors };
    });
  }, []);

  const autoConnect = useCallback(async () => {
    if (!bridgeRef.current) return;
    try {
      await bridgeRef.current.autoConnect();
    } catch (err: any) {
      if (err.name !== 'NotFoundError') {
        setState((prev) => ({ ...prev, error: err.message }));
      }
    }
  }, []);

  const connectSerial = useCallback(async () => {
    if (!bridgeRef.current) return;
    try {
      await bridgeRef.current.connectSerial();
    } catch (err: any) {
      if (err.name !== 'NotFoundError') {
        setState((prev) => ({ ...prev, error: err.message }));
      }
    }
  }, []);

  const disconnectSerial = useCallback(async () => {
    if (!bridgeRef.current) return;
    await bridgeRef.current.disconnectSerial();
    const configs = configsRef.current;
    sensorsRef.current = createDefaultSensors(configs);
    setState((prev) => ({ ...prev, sensors: createDefaultSensors(configs) }));
  }, []);

  const selectMidiOutput = useCallback(async (portName: string) => {
    if (!bridgeRef.current) return;
    await bridgeRef.current.selectMidiOutput(portName);
  }, []);

  const disconnectMidiOutput = useCallback(() => {
    bridgeRef.current?.disconnectMidiOutput();
  }, []);

  const testMidiOutput = useCallback(async () => {
    if (!bridgeRef.current) return;
    await bridgeRef.current.testMidiOutput();
  }, []);

  const toggleCcMode = useCallback(() => {
    if (!bridgeRef.current) return;
    const next = !bridgeRef.current.ccMode;
    bridgeRef.current.ccMode = next;
    setState((prev) => ({ ...prev, ccMode: next }));
  }, []);

  const toggleSynth = useCallback(() => {
    if (!bridgeRef.current) return;
    const next = !bridgeRef.current.synth.enabled;
    bridgeRef.current.synth.enabled = next;
    setState((prev) => ({ ...prev, synthEnabled: next }));
  }, []);

  const setDefaultOctave = useCallback((newOctave: number) => {
    if (newOctave < 0 || newOctave > 8) return;
    octaveRef.current = newOctave;
    setState((prev) => {
      const newConfigs = prev.sensorConfigs.map((c) => ({ ...c, octave: newOctave }));
      saveConfigs(newConfigs);
      configsRef.current = newConfigs;
      bridgeRef.current?.setSensorConfigs(newConfigs);

      const newSensors = prev.sensors.map((s, i) => ({
        ...s,
        active: false,
        pressure: 0,
        midiNote: newOctave * 12 + (newConfigs[i]?.rootSemitone ?? 0),
      }));
      sensorsRef.current = newSensors;

      return { ...prev, octave: newOctave, sensorConfigs: newConfigs, sensors: newSensors };
    });
  }, []);

  const loadAllConfigs = useCallback((configs: SensorNoteConfig[]) => {
    saveConfigs(configs);
    configsRef.current = configs;
    bridgeRef.current?.setSensorConfigs(configs);
    const newSensors = createDefaultSensors(configs);
    sensorsRef.current = newSensors;
    setState((prev) => ({ ...prev, sensorConfigs: configs, sensors: newSensors }));
  }, []);

  const refreshMidiOutputs = useCallback(async () => {
    if (!bridgeRef.current) return;
    const outputs = await bridgeRef.current.listMidiOutputs();
    setState((prev) => ({
      ...prev,
      midi: {
        ...prev.midi,
        availableOutputs: outputs,
      },
    }));
  }, []);

  return {
    state,
    autoConnect,
    connectSerial,
    disconnectSerial,
    selectMidiOutput,
    disconnectMidiOutput,
    refreshMidiOutputs,
    testMidiOutput,
    toggleCcMode,
    updateSensorConfig,
    loadAllConfigs,
    setDefaultOctave,
    toggleSynth,
  };
}
