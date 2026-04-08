interface PressureBarProps {
  pressure: number; // 0-127
  color: string;
  active: boolean;
}

const COLOR_MAP: Record<string, { bar: string; bg: string }> = {
  blue:   { bar: 'from-blue-900/50 via-blue-500 to-blue-300',   bg: 'bg-blue-500/10' },
  green:  { bar: 'from-green-900/50 via-green-500 to-green-300', bg: 'bg-green-500/10' },
  purple: { bar: 'from-purple-900/50 via-purple-500 to-purple-300', bg: 'bg-purple-500/10' },
  amber:  { bar: 'from-amber-900/50 via-amber-500 to-amber-300',  bg: 'bg-amber-500/10' },
  cyan:   { bar: 'from-cyan-900/50 via-cyan-500 to-cyan-300',    bg: 'bg-cyan-500/10' },
  rose:   { bar: 'from-rose-900/50 via-rose-500 to-rose-300',    bg: 'bg-rose-500/10' },
};

export function PressureBar({ pressure, color, active }: PressureBarProps) {
  const percent = Math.round((pressure / 127) * 100);
  const colors = COLOR_MAP[color] || COLOR_MAP.blue;

  return (
    <div className={`relative w-full h-36 rounded-lg overflow-hidden ${colors.bg} border border-border-subtle/50`}>
      {/* Background grid lines */}
      <div className="absolute inset-0 flex flex-col justify-between py-2 px-1 pointer-events-none">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-full h-px bg-white/5" />
        ))}
      </div>

      {/* Pressure fill */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t ${colors.bar} transition-all duration-100 ease-out rounded-t-sm`}
        style={{ height: `${active ? percent : 0}%` }}
      />

      {/* Value label */}
      <div className="absolute inset-0 flex items-end justify-center pb-1">
        <span
          className={`text-[10px] font-mono tabular-nums transition-smooth ${
            active ? 'text-white/90' : 'text-white/20'
          }`}
        >
          {active ? pressure : 0}
        </span>
      </div>
    </div>
  );
}
