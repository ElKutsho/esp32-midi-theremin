import { SensorLane } from './SensorLane';
import type { SensorState, SensorNoteConfig } from '../types/electron';

const COLORS = ['blue', 'green', 'purple', 'amber', 'cyan', 'rose'];

interface SensorLanesProps {
  sensors: SensorState[];
  configs: SensorNoteConfig[];
  octave: number;
  allChordTypes: { label: string; pattern: number[] }[];
  onConfigChange: (sensorIndex: number, config: SensorNoteConfig) => void;
}

export function SensorLanes({ sensors, configs, octave, allChordTypes, onConfigChange }: SensorLanesProps) {
  return (
    <div className="flex-1 flex items-center justify-center gap-4 px-6 py-4">
      {sensors.map((sensor, i) => (
        <div key={i} className="flex-1 max-w-[180px] animate-fade-in" style={{ animationDelay: `${i * 80}ms` }}>
          <SensorLane
            sensor={sensor}
            config={configs[i]}
            color={COLORS[i]}
            octave={octave}
            allChordTypes={allChordTypes}
            onConfigChange={(config) => onConfigChange(i, config)}
          />
        </div>
      ))}
    </div>
  );
}
