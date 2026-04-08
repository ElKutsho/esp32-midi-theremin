import { PressureBar } from './PressureBar';
import { NoteSelector } from './NoteSelector';
import type { SensorState, SensorNoteConfig } from '../types/electron';
import { getConfigLabel } from '../hooks/useMidiBridge';

interface SensorLaneProps {
  sensor: SensorState;
  config: SensorNoteConfig;
  color: string;
  octave: number;
  allChordTypes: { label: string; pattern: number[] }[];
  onConfigChange: (config: SensorNoteConfig) => void;
}

const GLOW_CLASS: Record<string, string> = {
  blue: 'glow-blue border-blue-500/60',
  green: 'glow-green border-green-500/60',
  purple: 'glow-purple border-purple-500/60',
  amber: 'glow-amber border-amber-500/60',
  cyan: 'glow-cyan border-cyan-500/60',
  rose: 'glow-rose border-rose-500/60',
};

const INACTIVE_BORDER: Record<string, string> = {
  blue: 'border-blue-500/10',
  green: 'border-green-500/10',
  purple: 'border-purple-500/10',
  amber: 'border-amber-500/10',
  cyan: 'border-cyan-500/10',
  rose: 'border-rose-500/10',
};

const TEXT_COLOR: Record<string, string> = {
  blue: 'text-blue-400',
  green: 'text-green-400',
  purple: 'text-purple-400',
  amber: 'text-amber-400',
  cyan: 'text-cyan-400',
  rose: 'text-rose-400',
};

const BG_ACTIVE: Record<string, string> = {
  blue: 'bg-blue-500/20',
  green: 'bg-green-500/20',
  purple: 'bg-purple-500/20',
  amber: 'bg-amber-500/20',
  cyan: 'bg-cyan-500/20',
  rose: 'bg-rose-500/20',
};

export function SensorLane({ sensor, config, color, octave, allChordTypes, onConfigChange }: SensorLaneProps) {
  const { active, pressure } = sensor;
  const label = getConfigLabel(config, allChordTypes);
  const noteLabel = `${label}${config.octave}`;

  return (
    <div
      className={`
        flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200
        ${active
          ? `${GLOW_CLASS[color]} ${BG_ACTIVE[color]}`
          : `${INACTIVE_BORDER[color]} bg-bg-card/30`
        }
      `}
    >
      {/* Note indicator circle */}
      <div
        className={`
          w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all duration-150
          ${active
            ? `${GLOW_CLASS[color]} ${BG_ACTIVE[color]} scale-110`
            : `${INACTIVE_BORDER[color]} bg-bg-secondary/50 scale-100`
          }
        `}
      >
        <span
          className={`text-lg font-bold transition-smooth ${
            active ? TEXT_COLOR[color] : 'text-gray-600'
          }`}
        >
          {noteLabel}
        </span>
      </div>

      {/* Note name large */}
      <span
        className={`text-2xl font-black transition-smooth ${
          active ? TEXT_COLOR[color] : 'text-gray-700'
        }`}
      >
        {label}
      </span>

      {/* Pressure bar */}
      <PressureBar pressure={pressure} color={color} active={active} />

      {/* MIDI note number */}
      <span className="text-[10px] text-gray-600 font-mono">
        MIDI {sensor.midiNote}
      </span>

      {/* Note selector */}
      <NoteSelector config={config} color={color} allChordTypes={allChordTypes} onChange={onConfigChange} />
    </div>
  );
}
