import { useState, useEffect } from 'react';
import type { AppState } from '../types/electron';

interface ConnectionPanelProps {
  state: AppState;
  onAutoConnect: () => Promise<void>;
  onConnectSerial: () => Promise<void>;
  onDisconnectSerial: () => Promise<void>;
  onSelectMidiOutput: (id: string) => Promise<void>;
  onDisconnectMidiOutput: () => void;
  onRefreshMidi: () => Promise<void>;
  onTestMidi: () => Promise<void>;
  onTestAftertouch: () => Promise<void>;
}

export function ConnectionPanel({
  state,
  onAutoConnect,
  onConnectSerial,
  onDisconnectSerial,
  onSelectMidiOutput,
  onDisconnectMidiOutput,
  onRefreshMidi,
  onTestMidi,
  onTestAftertouch,
}: ConnectionPanelProps) {
  const [connecting, setConnecting] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const isConnected = state.serial.connected && state.midi.outputConnected;

  useEffect(() => {
    if (isConnected) {
      const timer = setTimeout(() => setExpanded(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  const handleAutoConnect = async () => {
    setConnecting(true);
    try { await onAutoConnect(); } finally { setConnecting(false); }
  };

  const handleConnectSerial = async () => {
    setConnecting(true);
    try { await onConnectSerial(); } finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    await onDisconnectSerial();
    onDisconnectMidiOutput();
  };

  return (
    <div className="px-6 py-3">
      {/* Collapsed bar — always rendered, fades in/out */}
      <div
        className={`transition-all duration-300 ease-out ${
          expanded ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-20'
        }`}
      >
        <button
          onClick={() => setExpanded(true)}
          tabIndex={expanded ? -1 : 0}
          className="w-full glass rounded-xl px-4 py-2 flex items-center justify-between hover:bg-bg-hover transition-smooth cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-amber-400'}`} />
            <span className="text-sm text-gray-300">
              {isConnected ? 'Verbunden' : 'Verbindung konfigurieren'}
            </span>
          </div>
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Expanded panel — always rendered, smooth height transition */}
      <div className={`collapsible ${expanded ? 'is-open' : ''}`}>
        <div className="collapsible-inner">
          <div className="glass rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">Verbindung</h2>
              <button onClick={() => setExpanded(false)} className="text-gray-500 hover:text-gray-300 transition-smooth cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Serial */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase tracking-wider">Serial Port (ESP32)</label>
                <div className="flex items-center gap-2">
                  <div className={`flex-1 bg-bg-primary border rounded-lg px-3 py-2 text-sm ${
                    state.serial.connected ? 'border-green-500/30 text-green-300' : 'border-border-subtle text-gray-500'
                  }`}>
                    {state.serial.connected ? state.serial.portName : 'Nicht verbunden'}
                  </div>
                  {!state.serial.connected ? (
                    <button
                      onClick={handleConnectSerial}
                      disabled={connecting}
                      className="px-3 py-2 rounded-lg border border-border-bright text-gray-300 hover:bg-bg-hover transition-smooth text-sm disabled:opacity-30 cursor-pointer"
                    >
                      Wahlen
                    </button>
                  ) : (
                    <button
                      onClick={onDisconnectSerial}
                      className="px-3 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-smooth text-sm cursor-pointer"
                    >
                      Trennen
                    </button>
                  )}
                </div>
              </div>

              {/* MIDI Output */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase tracking-wider">MIDI Output</label>
                <div className="flex gap-2">
                  <select
                    value={state.midi.outputConnected ? state.midi.outputPortName : ''}
                    onChange={(e) => {
                      if (e.target.value) onSelectMidiOutput(e.target.value);
                      else onDisconnectMidiOutput();
                    }}
                    className="flex-1 bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-blue transition-smooth cursor-pointer"
                  >
                    <option value="">-- Auswahlen --</option>
                    {state.midi.availableOutputs.map((port) => (
                      <option key={port.name} value={port.name}>{port.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={onRefreshMidi}
                    className="px-2 py-2 rounded-lg border border-border-subtle hover:bg-bg-hover transition-smooth text-gray-400 hover:text-white cursor-pointer"
                    title="MIDI Ports aktualisieren"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  {state.midi.outputConnected && (
                    <>
                      <button
                        onClick={onTestMidi}
                        className="px-2 py-2 rounded-lg border border-green-500/30 hover:bg-green-500/10 transition-smooth text-green-400 hover:text-green-300 text-xs font-medium cursor-pointer"
                        title="Test-Note an MIDI Output senden"
                      >
                        Test
                      </button>
                      <button
                        onClick={onTestAftertouch}
                        className="px-2 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 transition-smooth text-amber-400 hover:text-amber-300 text-xs font-medium cursor-pointer"
                        title="Aftertouch-Sweep auf allen 6 Channels senden"
                      >
                        AT Test
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Main action button */}
            <div className="flex gap-3 pt-1">
              {!isConnected ? (
                <button
                  onClick={handleAutoConnect}
                  disabled={connecting}
                  className={`
                    flex-1 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200
                    ${connecting
                      ? 'bg-accent-blue/30 text-blue-300 cursor-wait'
                      : 'bg-gradient-to-r from-accent-blue to-accent-purple text-white hover:shadow-glow hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                    }
                  `}
                >
                  {connecting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Verbinde...
                    </span>
                  ) : (
                    'Auto-Connect'
                  )}
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-smooth cursor-pointer"
                >
                  Alles trennen
                </button>
              )}
            </div>

            {/* Error */}
            {state.error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {state.error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
