import { useState } from 'react';
import type { Template, SensorNoteConfig } from '../types/electron';

interface TemplateBarProps {
  templates: Template[];
  currentConfigs: SensorNoteConfig[];
  onLoad: (configs: SensorNoteConfig[]) => void;
  onSave: (name: string, configs: SensorNoteConfig[]) => void;
  onDelete: (id: string) => void;
  onOpenChordEditor: () => void;
}

const btnBase = 'text-[10px] px-2.5 py-1 rounded-md border font-medium transition-all duration-200 cursor-pointer';

export function TemplateBar({ templates, currentConfigs, onLoad, onSave, onDelete, onOpenChordEditor }: TemplateBarProps) {
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  const handleLoad = () => {
    if (!selectedTemplate) return;
    onLoad(selectedTemplate.configs.map((c) => ({ ...c })));
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    onSave(saveName.trim(), currentConfigs);
    setSaveName('');
    setSaving(false);
  };

  const handleDelete = () => {
    if (!selectedTemplate || selectedTemplate.builtIn) return;
    onDelete(selectedTemplate.id);
    setSelectedId('');
  };

  const builtIn = templates.filter((t) => t.builtIn);
  const user = templates.filter((t) => !t.builtIn);

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b border-border-subtle bg-bg-secondary/30">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mr-1">Templates</span>

      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="text-[10px] px-2 py-1 rounded-md border border-border-subtle bg-bg-secondary text-gray-300 cursor-pointer min-w-[140px] appearance-none"
      >
        <option value="">-- Auswahl --</option>
        {builtIn.length > 0 && (
          <optgroup label="Vorlagen">
            {builtIn.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )}
        {user.length > 0 && (
          <optgroup label="Eigene">
            {user.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )}
      </select>

      <button
        onClick={handleLoad}
        disabled={!selectedTemplate}
        className={`${btnBase} border-accent-blue/30 bg-accent-blue/10 text-blue-300 hover:bg-accent-blue/20 disabled:opacity-30 disabled:cursor-default`}
      >
        Laden
      </button>

      {selectedTemplate && !selectedTemplate.builtIn && (
        <button
          onClick={handleDelete}
          className={`${btnBase} border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20`}
        >
          Entfernen
        </button>
      )}

      <div className="ml-auto flex items-center gap-2 transition-all duration-300 ease-out">
        {saving ? (
          <div className="flex items-center gap-2 animate-fade-in">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Template-Name..."
              autoFocus
              className="text-[10px] px-2 py-1 rounded-md border border-border-subtle bg-bg-secondary text-white placeholder-gray-600 w-36"
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim()}
              className={`${btnBase} border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20 disabled:opacity-30 disabled:cursor-default`}
            >
              OK
            </button>
            <button
              onClick={() => { setSaving(false); setSaveName(''); }}
              className="text-[10px] px-2 py-1 text-gray-500 hover:text-gray-300 cursor-pointer"
            >
              Abbrechen
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 animate-fade-in">
            <button
              onClick={() => setSaving(true)}
              className={`${btnBase} border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20`}
            >
              Konfig speichern
            </button>
            <button
              onClick={onOpenChordEditor}
              className={`${btnBase} border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 flex items-center gap-1`}
              title="Eigene Akkorde erstellen"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Akkorde
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
