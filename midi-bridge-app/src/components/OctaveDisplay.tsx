interface OctaveDisplayProps {
  octave: number;
  onOctaveChange: (octave: number) => void;
}

export function OctaveDisplay({ octave, onOctaveChange }: OctaveDisplayProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 uppercase tracking-wider">Grundoktave</span>
      <div className="glass rounded-lg px-2 py-1 flex items-center gap-2">
        <button
          onClick={() => onOctaveChange(octave - 1)}
          disabled={octave <= 0}
          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        >
          -
        </button>
        <span className="text-2xl font-bold text-white tabular-nums w-6 text-center">{octave}</span>
        <button
          onClick={() => onOctaveChange(octave + 1)}
          disabled={octave >= 8}
          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        >
          +
        </button>
      </div>
    </div>
  );
}
