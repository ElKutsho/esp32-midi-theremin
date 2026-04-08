interface SetupGuideProps {
  visible: boolean;
}

export function SetupGuide({ visible }: SetupGuideProps) {
  return (
    <div className={`collapsible ${visible ? 'is-open' : ''}`}>
      <div className="collapsible-inner">
        <div className="mx-6 mb-3 glass rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-amber-300">Kein MIDI Output gefunden</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Um MIDI-Signale an deine DAW zu senden, brauchst du einen virtuellen MIDI-Port.
                Installiere <span className="text-amber-300 font-medium">loopMIDI</span> (kostenlos) von Tobias Erichsen:
              </p>
              <div className="flex gap-3 pt-1">
                <a
                  href="https://www.tobias-erichsen.de/software/loopmidi.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-medium hover:bg-amber-500/30 transition-smooth"
                >
                  loopMIDI herunterladen
                </a>
              </div>
              <div className="pt-2 space-y-1">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Anleitung:</p>
                <ol className="text-xs text-gray-500 space-y-0.5 list-decimal list-inside">
                  <li>loopMIDI installieren und starten</li>
                  <li>Einen neuen Port erstellen (z.B. "ESP32 MIDI")</li>
                  <li>Hier auf "Ports aktualisieren" klicken</li>
                  <li>Den neuen Port als MIDI Output auswahlen</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
