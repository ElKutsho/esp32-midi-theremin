import type { MidiMessage } from '../types/electron';

interface MidiLogProps {
  messages: MidiMessage[];
}

const TYPE_COLORS: Record<string, string> = {
  noteOn: 'text-green-400',
  noteOff: 'text-red-400',
  polyAftertouch: 'text-amber-400',
};

const TYPE_LABELS: Record<string, string> = {
  noteOn: 'NOTE ON ',
  noteOff: 'NOTE OFF',
  polyAftertouch: 'POLY AT ',
};

function noteToName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12);
  return `${names[note % 12]}${octave}`;
}

export function MidiLog({ messages }: MidiLogProps) {
  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-gray-600">Warte auf MIDI-Daten...</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-2 space-y-0.5">
      {messages.slice(0, 30).map((msg, i) => (
        <div
          key={`${msg.timestamp}-${i}`}
          className="flex items-center gap-3 text-[11px] font-mono py-0.5 animate-fade-in"
        >
          <span className="text-gray-600 tabular-nums w-20">
            {new Date(msg.timestamp).toLocaleTimeString('de-DE', { hour12: false })}
          </span>
          <span className={`font-semibold w-20 ${TYPE_COLORS[msg.type]}`}>
            {TYPE_LABELS[msg.type]}
          </span>
          <span className="text-gray-300 w-12">{noteToName(msg.note)}</span>
          <span className="text-gray-500">
            {msg.type === 'polyAftertouch'
              ? `pressure: ${msg.pressure}`
              : `vel: ${msg.velocity}`}
          </span>
        </div>
      ))}
    </div>
  );
}
