import { useState } from 'react';
import type { SensorNoteConfig } from '../types/electron';
import { getConfigLabel } from '../hooks/useMidiBridge';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface ChordType {
  label: string;
  pattern: number[];
}

interface NoteSelectorProps {
  config: SensorNoteConfig;
  color: string;
  allChordTypes: ChordType[];
  onChange: (config: SensorNoteConfig) => void;
}

const TEXT_COLOR: Record<string, string> = {
  blue: 'text-blue-400',
  green: 'text-green-400',
  purple: 'text-purple-400',
  amber: 'text-amber-400',
  cyan: 'text-cyan-400',
  rose: 'text-rose-400',
};

const BORDER_COLOR: Record<string, string> = {
  blue: 'border-blue-500/30 focus:border-blue-500/60',
  green: 'border-green-500/30 focus:border-green-500/60',
  purple: 'border-purple-500/30 focus:border-purple-500/60',
  amber: 'border-amber-500/30 focus:border-amber-500/60',
  cyan: 'border-cyan-500/30 focus:border-cyan-500/60',
  rose: 'border-rose-500/30 focus:border-rose-500/60',
};

const LABEL_COLOR: Record<string, string> = {
  blue: 'text-blue-500/60',
  green: 'text-green-500/60',
  purple: 'text-purple-500/60',
  amber: 'text-amber-500/60',
  cyan: 'text-cyan-500/60',
  rose: 'text-rose-500/60',
};

export function NoteSelector({ config, color, allChordTypes, onChange }: NoteSelectorProps) {
  const [open, setOpen] = useState(false);

  const currentChordIdx = allChordTypes.findIndex((c) =>
    c.pattern.length === config.chordPattern.length &&
    c.pattern.every((v, i) => v === config.chordPattern[i])
  );

  const handleRootChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const rootSemitone = parseInt(e.target.value, 10);
    const newConfig: SensorNoteConfig = {
      ...config,
      rootSemitone,
      label: '',
    };
    newConfig.label = getConfigLabel(newConfig, allChordTypes);
    onChange(newConfig);
  };

  const handleChordChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chordIdx = parseInt(e.target.value, 10);
    const chord = allChordTypes[chordIdx];
    if (!chord) return;
    const newConfig: SensorNoteConfig = {
      ...config,
      chordPattern: [...chord.pattern],
      label: '',
    };
    newConfig.label = getConfigLabel(newConfig, allChordTypes);
    onChange(newConfig);
  };

  const handleOctaveChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const octave = parseInt(e.target.value, 10);
    onChange({ ...config, octave });
  };

  const selectClass = `w-full text-[10px] px-2 py-1 rounded-md border ${BORDER_COLOR[color]} bg-bg-secondary text-gray-300 cursor-pointer appearance-none`;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full text-[10px] px-2 py-1 rounded-md border ${BORDER_COLOR[color]}
          bg-bg-secondary/50 ${TEXT_COLOR[color]} hover:bg-bg-secondary transition-all cursor-pointer`}
      >
        {getConfigLabel(config, allChordTypes)} {open ? '\u25B2' : '\u25BC'}
      </button>

      <div className={`collapsible ${open ? 'is-open' : ''}`}>
        <div className="collapsible-inner">
          <div className="mt-1.5 flex flex-col gap-1.5">
            <div>
              <label className={`text-[8px] uppercase tracking-wider font-medium mb-0.5 block ${LABEL_COLOR[color]}`}>Note</label>
              <select value={config.rootSemitone % 12} onChange={handleRootChange} tabIndex={open ? 0 : -1} className={selectClass}>
                {NOTE_NAMES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`text-[8px] uppercase tracking-wider font-medium mb-0.5 block ${LABEL_COLOR[color]}`}>Oktave</label>
              <select value={config.octave} onChange={handleOctaveChange} tabIndex={open ? 0 : -1} className={selectClass}>
                {Array.from({ length: 9 }, (_, i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`text-[8px] uppercase tracking-wider font-medium mb-0.5 block ${LABEL_COLOR[color]}`}>Akkord</label>
              <select value={currentChordIdx >= 0 ? currentChordIdx : 0} onChange={handleChordChange} tabIndex={open ? 0 : -1} className={selectClass}>
                {allChordTypes.map((chord, i) => (
                  <option key={i} value={i}>{chord.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
