import { useState, useCallback } from 'react';
import type { CustomChord } from '../types/electron';

const STORAGE_KEY = 'midi-bridge-custom-chords';

function loadCustomChords(): CustomChord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveCustomChords(chords: CustomChord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chords));
}

export function useCustomChords() {
  const [customChords, setCustomChords] = useState<CustomChord[]>(loadCustomChords);

  const addChord = useCallback((label: string, pattern: number[]) => {
    setCustomChords((prev) => {
      const chord: CustomChord = { id: `custom-${Date.now()}`, label, pattern };
      const next = [...prev, chord];
      saveCustomChords(next);
      return next;
    });
  }, []);

  const removeChord = useCallback((id: string) => {
    setCustomChords((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveCustomChords(next);
      return next;
    });
  }, []);

  return { customChords, addChord, removeChord };
}
