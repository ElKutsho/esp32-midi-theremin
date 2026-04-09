import { useState, useMemo } from 'react';

import { HeaderBar } from './components/HeaderBar';
import { ConnectionPanel } from './components/ConnectionPanel';
import { SensorLanes } from './components/SensorLanes';
import { SetupGuide } from './components/SetupGuide';
import { MidiLog } from './components/MidiLog';
import { TemplateBar } from './components/TemplateBar';
import { CustomChordEditor } from './components/CustomChordEditor';
import { useMidiBridge, CHORD_TYPES } from './hooks/useMidiBridge';
import { useCustomChords } from './hooks/useCustomChords';
import { useTemplates } from './hooks/useTemplates';

export default function App() {
  const {
    state,
    autoConnect,
    connectSerial,
    disconnectSerial,
    selectMidiOutput,
    disconnectMidiOutput,
    refreshMidiOutputs,
    testMidiOutput,
    testAftertouch,
    toggleCcMode,
    setAtInvert,
    setAtFloor,
    updateSensorConfig,
    loadAllConfigs,
    setDefaultOctave,
    toggleSynth,
  } = useMidiBridge();

  const { customChords, addChord, removeChord } = useCustomChords();
  const { templates, saveTemplate, deleteTemplate } = useTemplates();
  const [chordEditorOpen, setChordEditorOpen] = useState(false);
  const [midiLogOpen, setMidiLogOpen] = useState(false);

  const allChordTypes = useMemo(() => [
    ...CHORD_TYPES.map((c) => ({ label: c.label, pattern: [...c.pattern] })),
    ...customChords.map((c) => ({ label: c.label, pattern: c.pattern })),
  ], [customChords]);

  const noMidiPorts = state.midi.availableOutputs.length === 0 && !state.midi.outputConnected;

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <HeaderBar
        serialConnected={state.serial.connected}
        midiConnected={state.midi.outputConnected}
        octave={state.octave}
        serialPort={state.serial.portName}
        midiPort={state.midi.outputPortName}
        synthEnabled={state.synthEnabled}
        ccMode={state.ccMode}
        atInvert={state.atInvert}
        atFloor={state.atFloor}
        onToggleSynth={toggleSynth}
        onToggleCcMode={toggleCcMode}
        onAtInvertChange={setAtInvert}
        onAtFloorChange={setAtFloor}
        onOctaveChange={setDefaultOctave}
      />

      {/* Connection Panel */}
      <ConnectionPanel
        state={state}
        onAutoConnect={autoConnect}
        onConnectSerial={connectSerial}
        onDisconnectSerial={disconnectSerial}
        onSelectMidiOutput={selectMidiOutput}
        onDisconnectMidiOutput={disconnectMidiOutput}
        onRefreshMidi={refreshMidiOutputs}
        onTestMidi={testMidiOutput}
        onTestAftertouch={testAftertouch}
      />

      {/* Setup Guide (only shown when no MIDI ports) */}
      <SetupGuide visible={noMidiPorts} />

      {/* Template Bar */}
      <TemplateBar
        templates={templates}
        currentConfigs={state.sensorConfigs}
        onLoad={loadAllConfigs}
        onSave={saveTemplate}
        onDelete={deleteTemplate}
        onOpenChordEditor={() => setChordEditorOpen(true)}
      />

      {/* Main Visualization Area */}
      <SensorLanes
        sensors={state.sensors}
        configs={state.sensorConfigs}
        octave={state.octave}
        allChordTypes={allChordTypes}
        onConfigChange={updateSensorConfig}
      />

      {/* MIDI Log */}
      <div className="border-t border-border-subtle bg-bg-secondary/30 flex flex-col">
        <button
          onClick={() => setMidiLogOpen(!midiLogOpen)}
          className="px-6 py-1.5 flex items-center justify-between border-b border-border-subtle/50 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
        >
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            MIDI Log {midiLogOpen ? '\u25B2' : '\u25BC'}
          </span>
          <span className="text-[10px] text-gray-600">{state.recentMessages.length} Nachrichten</span>
        </button>
        <div className={`collapsible ${midiLogOpen ? 'is-open' : ''}`}>
          <div className="collapsible-inner">
            <div className="h-32 overflow-hidden">
              <MidiLog messages={state.recentMessages} />
            </div>
          </div>
        </div>
      </div>

      {/* Custom Chord Editor Modal */}
      {chordEditorOpen && (
        <CustomChordEditor
          customChords={customChords}
          onAdd={addChord}
          onRemove={removeChord}
          onClose={() => setChordEditorOpen(false)}
        />
      )}
    </div>
  );
}
