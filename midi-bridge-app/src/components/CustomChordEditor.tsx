import { useState } from 'react';
import type { CustomChord } from '../types/electron';

const INTERVAL_NAMES = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const INTERVAL_NAMES_HIGH = ['8', 'b9', '9', 'b10', '10', '11', 'b12', '12', 'b13', '13', 'b14', '14'];

interface CustomChordEditorProps {
  customChords: CustomChord[];
  onAdd: (label: string, pattern: number[]) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function CustomChordEditor({ customChords, onAdd, onRemove, onClose }: CustomChordEditorProps) {
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set([0]));

  const toggleInterval = (semitone: number) => {
    if (semitone === 0) return; // Root always selected
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(semitone)) next.delete(semitone);
      else next.add(semitone);
      return next;
    });
  };

  const handleSave = () => {
    if (!label.trim()) return;
    if (selected.size < 2) return;
    const pattern = Array.from(selected).sort((a, b) => a - b);
    onAdd(label.trim(), pattern);
    setLabel('');
    setSelected(new Set([0]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 modal-backdrop" onClick={onClose}>
      <div
        className="bg-bg-secondary border border-border-subtle rounded-2xl p-6 w-[420px] max-h-[80vh] overflow-y-auto shadow-2xl modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Eigene Akkorde</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none cursor-pointer">&times;</button>
        </div>

        {/* Builder */}
        <div className="mb-4">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Neuer Akkord</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (z.B. add9)"
            className="w-full text-xs px-3 py-1.5 rounded border border-border-subtle bg-bg-primary text-white placeholder-gray-600 mb-3"
          />

          <p className="text-[10px] text-gray-500 mb-1.5">Intervalle (Grundton ist immer dabei):</p>

          {/* Row 1: semitones 0-11 */}
          <div className="flex gap-1 mb-1">
            {INTERVAL_NAMES.map((name, i) => (
              <button
                key={i}
                onClick={() => toggleInterval(i)}
                className={`flex-1 text-[9px] py-1.5 rounded border transition-all cursor-pointer ${
                  selected.has(i)
                    ? 'bg-accent-blue/30 border-accent-blue/60 text-blue-300'
                    : 'bg-bg-primary border-border-subtle text-gray-500 hover:text-gray-300'
                } ${i === 0 ? 'opacity-60 cursor-default' : ''}`}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Row 2: semitones 12-23 (extended) */}
          <div className="flex gap-1 mb-3">
            {INTERVAL_NAMES_HIGH.map((name, i) => (
              <button
                key={i + 12}
                onClick={() => toggleInterval(i + 12)}
                className={`flex-1 text-[9px] py-1.5 rounded border transition-all cursor-pointer ${
                  selected.has(i + 12)
                    ? 'bg-purple-500/30 border-purple-500/60 text-purple-300'
                    : 'bg-bg-primary border-border-subtle text-gray-500 hover:text-gray-300'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">
              Pattern: [{Array.from(selected).sort((a, b) => a - b).join(', ')}]
            </span>
            <button
              onClick={handleSave}
              disabled={!label.trim() || selected.size < 2}
              className="ml-auto text-xs px-3 py-1 rounded bg-accent-blue/20 border border-accent-blue/40 text-blue-300 hover:bg-accent-blue/30 disabled:opacity-30 disabled:cursor-default transition-all cursor-pointer"
            >
              Speichern
            </button>
          </div>
        </div>

        {/* Existing custom chords */}
        {customChords.length > 0 && (
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">Gespeicherte Akkorde</label>
            <div className="flex flex-col gap-1">
              {customChords.map((chord) => (
                <div key={chord.id} className="flex items-center justify-between px-3 py-1.5 rounded bg-bg-primary border border-border-subtle">
                  <span className="text-xs text-white font-medium">{chord.label}</span>
                  <span className="text-[10px] text-gray-500 font-mono">[{chord.pattern.join(', ')}]</span>
                  <button
                    onClick={() => onRemove(chord.id)}
                    className="text-gray-600 hover:text-rose-400 text-sm leading-none ml-2 cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
