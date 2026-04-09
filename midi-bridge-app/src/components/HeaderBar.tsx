import { StatusIndicator } from './StatusIndicator';
import { OctaveDisplay } from './OctaveDisplay';

interface HeaderBarProps {
  serialConnected: boolean;
  midiConnected: boolean;
  octave: number;
  serialPort: string | null;
  midiPort: string | null;
  synthEnabled: boolean;
  ccMode: boolean;
  atInvert: boolean;
  atFloor: number;
  onToggleSynth: () => void;
  onToggleCcMode: () => void;
  onAtInvertChange: (invert: boolean) => void;
  onAtFloorChange: (floor: number) => void;
  onOctaveChange: (octave: number) => void;
}

export function HeaderBar({ serialConnected, midiConnected, octave, serialPort, midiPort, synthEnabled, ccMode, atInvert, atFloor, onToggleSynth, onToggleCcMode, onAtInvertChange, onAtFloorChange, onOctaveChange }: HeaderBarProps) {
  return (
    <div className="drag-region border-b border-border-subtle bg-bg-secondary/50">
      {/* Row 1: Title — Octave — Status (CSS Grid for true centering) */}
      <div className="grid grid-cols-3 items-center px-6 py-2">
        {/* Left: App Title */}
        <div className="no-drag flex items-center gap-2 min-w-0 justify-self-start">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-semibold text-white leading-tight truncate">ESP32 MIDI Bridge</h1>
            <p className="text-[9px] text-gray-500 leading-tight">Theremin Controller</p>
          </div>
        </div>

        {/* Center: Octave (always perfectly centered) */}
        <div className="no-drag justify-self-center">
          <OctaveDisplay octave={octave} onOctaveChange={onOctaveChange} />
        </div>

        {/* Right: Connection Status */}
        <div className="no-drag flex items-center gap-2 justify-self-end mr-36">
          <StatusIndicator
            connected={serialConnected}
            label={serialConnected ? `S: ${serialPort}` : 'Serial'}
          />
          <StatusIndicator
            connected={midiConnected}
            label={midiConnected ? `M: ${midiPort}` : 'MIDI'}
          />
        </div>
      </div>

      {/* Row 2: Tool Buttons */}
      <div className="no-drag flex items-center gap-1.5 px-6 pb-2">
        <button
          onClick={onToggleCcMode}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium transition-all duration-200 cursor-pointer ${
            ccMode
              ? 'border-green-500/40 bg-green-500/15 text-green-300 hover:bg-green-500/25'
              : 'border-border-subtle bg-bg-secondary/50 text-gray-500 hover:text-gray-400'
          }`}
          title={ccMode ? 'CC-Modus aktiv: Druck wird als CC1 gesendet (Ableton-kompatibel)' : 'CC-Modus: Druck als CC1 senden (fuer Ableton MIDI-Mapping)'}
        >
          CC1
        </button>

        <button
          onClick={onToggleSynth}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium transition-all duration-200 cursor-pointer ${
            synthEnabled
              ? 'border-purple-500/40 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25'
              : 'border-border-subtle bg-bg-secondary/50 text-gray-500 hover:text-gray-400'
          }`}
          title={synthEnabled ? 'Internal Synth ausschalten' : 'Internal Synth einschalten'}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {synthEnabled ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M6 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h2l4-4v14l-4-4z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5.586v12.828a1 1 0 01-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            )}
          </svg>
          Internal Synth
        </button>

        <div className="w-px h-4 bg-border-subtle mx-1" />

        <button
          onClick={() => onAtInvertChange(!atInvert)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium transition-all duration-200 cursor-pointer ${
            atInvert
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
              : 'border-border-subtle bg-bg-secondary/50 text-gray-500 hover:text-gray-400'
          }`}
          title={atInvert ? 'Aftertouch: weit=max, nah=min' : 'Aftertouch: nah=max, weit=min'}
        >
          {atInvert ? 'AT Inv' : 'AT Norm'}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500">Floor</span>
          <input
            type="range"
            min={0}
            max={100}
            value={atFloor}
            onChange={(e) => onAtFloorChange(Number(e.target.value))}
            className="w-16 h-1 accent-amber-500 cursor-pointer"
            title={`Aftertouch Deadzone: ${Math.round(atFloor / 127 * 100)}%`}
          />
          <span className="text-[10px] text-gray-500 w-6 tabular-nums">{atFloor}</span>
        </div>
      </div>
    </div>
  );
}
