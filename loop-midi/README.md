# Virtual MIDI — Eigenes loopMIDI

Erstellt virtuelle MIDI-Loopback-Ports auf Windows, um MIDI-Daten zwischen Anwendungen zu routen (z.B. ESP32 MIDI Bridge → DAW).

## Architektur

```
┌──────────────────┐     Shared Memory      ┌──────────────────┐
│  App A (Bridge)  │     Ring Buffer         │  App B (DAW)     │
│  MIDI Output     │ ──────────────────────► │  MIDI Input      │
│  (vmidi.dll)     │     Named Events        │  (vmidi.dll)     │
└──────────────────┘                         └──────────────────┘
                          ▲
                          │ verwaltet von
                 ┌────────┴─────────┐
                 │  VirtualMIDI.exe │
                 │  (System Tray)   │
                 └──────────────────┘
```

### Komponenten

| Datei | Beschreibung |
|-------|-------------|
| `driver/vmidi.dll` | User-Mode MIDI-Treiber (registriert sich in Windows Drivers32) |
| `app/VirtualMIDI.exe` | System-Tray-App zur Port-Verwaltung |
| `shared/ringbuffer.h` | Lock-free SPSC Ring Buffer |
| `shared/ipc.h` | Shared Memory IPC Strukturen |

## Build-Voraussetzungen

- **Windows 11** (oder Windows 10)
- **CMake** 3.20+
- **Visual Studio 2022** (oder Build Tools mit MSVC)
- **Python 3** (optional, für Icon-Generierung)

## Build-Anleitung

```bash
# Im loop-midi/ Verzeichnis:
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

Die Ausgabe-Dateien landen in `build/bin/`:
- `VirtualMIDI.exe` — Control App
- `vmidi.dll` — MIDI-Treiber DLL

## Installation & Nutzung

### 1. Erststart

```bash
# Als Administrator ausführen!
build\bin\Release\VirtualMIDI.exe
```

Beim ersten Start:
- Die App registriert `vmidi.dll` automatisch in der Windows Registry (`Drivers32`)
- Ein Standard-Port "loopMIDI Port 1" wird erstellt
- Ein Tray-Icon erscheint in der Taskleiste

### 2. Ports verwalten

**Rechtsklick auf Tray-Icon:**
- **Port hinzufügen (+)** — Neuen virtuellen MIDI-Port erstellen
- **Port entfernen (-)** — Bestehenden Port löschen
- **Autostart mit Windows** — App beim Windows-Start automatisch starten
- **Beenden** — App beenden (Ports werden erst beim Neustart sichtbar)

### 3. In der Bridge-App nutzen

Nach dem Start von VirtualMIDI erscheinen die virtuellen Ports als MIDI-Geräte in allen Anwendungen:
- In der ESP32 MIDI Bridge als MIDI-Output wählbar
- In der DAW (Ableton, FL Studio, etc.) als MIDI-Input verfügbar

## Technische Details

### Wie funktioniert der Loopback?

1. **VirtualMIDI.exe** erstellt Shared Memory Regionen für jeden Port
2. **vmidi.dll** wird von winmm.dll geladen wenn eine App einen MIDI-Port öffnet
3. MIDI-Output schreibt in den Ring Buffer → Named Event signalisiert
4. MIDI-Input Thread empfängt das Signal → liest aus dem Ring Buffer → Callback an die App

### Registry-Einträge

```
HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Drivers32
  midiX = C:\...\vmidi.dll

HKLM\SOFTWARE\VirtualMIDI
  PortCount = N
  Port0Name = "loopMIDI Port 1"
  ...
```

### Deinstallation

1. VirtualMIDI.exe beenden
2. Registry-Einträge manuell entfernen oder ein neues Build starten mit Uninstall-Option

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| Ports nicht sichtbar | App als Administrator starten, MIDI-App neu starten |
| "Shared Memory Fehler" | Andere Instanz läuft bereits — erst beenden |
| Treiber nicht registriert | Als Administrator ausführen |
| Kein Sound in DAW | Richtigen MIDI-Input in der DAW auswählen |
