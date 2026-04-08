import { useState, useCallback } from 'react';
import type { Template, SensorNoteConfig } from '../types/electron';

const STORAGE_KEY = 'midi-bridge-templates';

const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: 'builtin-c-major',
    name: 'C-Dur Akkorde',
    builtIn: true,
    configs: [
      { rootSemitone: 0, chordPattern: [0, 4, 7], label: 'Cmaj', octave: 4 },
      { rootSemitone: 2, chordPattern: [0, 3, 7], label: 'Dmin', octave: 4 },
      { rootSemitone: 4, chordPattern: [0, 3, 7], label: 'Emin', octave: 4 },
      { rootSemitone: 5, chordPattern: [0, 4, 7], label: 'Fmaj', octave: 4 },
      { rootSemitone: 7, chordPattern: [0, 4, 7], label: 'Gmaj', octave: 4 },
      { rootSemitone: 9, chordPattern: [0, 3, 7], label: 'Amin', octave: 4 },
    ],
  },
  {
    id: 'builtin-a-minor-pent',
    name: 'A-Moll Pentatonik',
    builtIn: true,
    configs: [
      { rootSemitone: 9, chordPattern: [0], label: 'A', octave: 4 },
      { rootSemitone: 0, chordPattern: [0], label: 'C', octave: 5 },
      { rootSemitone: 2, chordPattern: [0], label: 'D', octave: 5 },
      { rootSemitone: 4, chordPattern: [0], label: 'E', octave: 5 },
      { rootSemitone: 7, chordPattern: [0], label: 'G', octave: 5 },
      { rootSemitone: 9, chordPattern: [0], label: 'A', octave: 5 },
    ],
  },
  {
    id: 'builtin-power-chords',
    name: 'Power Chords',
    builtIn: true,
    configs: [
      { rootSemitone: 0, chordPattern: [0, 7], label: 'CPower', octave: 3 },
      { rootSemitone: 2, chordPattern: [0, 7], label: 'DPower', octave: 3 },
      { rootSemitone: 4, chordPattern: [0, 7], label: 'EPower', octave: 3 },
      { rootSemitone: 5, chordPattern: [0, 7], label: 'FPower', octave: 3 },
      { rootSemitone: 7, chordPattern: [0, 7], label: 'GPower', octave: 3 },
      { rootSemitone: 9, chordPattern: [0, 7], label: 'APower', octave: 3 },
    ],
  },
  {
    id: 'builtin-default',
    name: 'Standard',
    builtIn: true,
    configs: [
      { rootSemitone: 0, chordPattern: [0], label: 'C', octave: 4 },
      { rootSemitone: 4, chordPattern: [0], label: 'E', octave: 4 },
      { rootSemitone: 7, chordPattern: [0], label: 'G', octave: 4 },
      { rootSemitone: 9, chordPattern: [0], label: 'A', octave: 4 },
      { rootSemitone: 0, chordPattern: [0], label: 'C', octave: 5 },
      { rootSemitone: 2, chordPattern: [0], label: 'D', octave: 4 },
    ],
  },
];

function loadUserTemplates(): Template[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveUserTemplates(templates: Template[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function useTemplates() {
  const [userTemplates, setUserTemplates] = useState<Template[]>(loadUserTemplates);

  const templates = [...BUILT_IN_TEMPLATES, ...userTemplates];

  const saveTemplate = useCallback((name: string, configs: SensorNoteConfig[]) => {
    setUserTemplates((prev) => {
      const template: Template = {
        id: `user-${Date.now()}`,
        name,
        configs: configs.map((c) => ({ ...c })),
      };
      const next = [...prev, template];
      saveUserTemplates(next);
      return next;
    });
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setUserTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveUserTemplates(next);
      return next;
    });
  }, []);

  return { templates, saveTemplate, deleteTemplate };
}
