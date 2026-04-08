interface StatusIndicatorProps {
  connected: boolean;
  label: string;
}

export function StatusIndicator({ connected, label }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2.5 h-2.5 rounded-full transition-smooth ${
          connected
            ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]'
            : 'bg-red-400/60 shadow-[0_0_8px_rgba(239,68,68,0.3)]'
        }`}
      />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}
