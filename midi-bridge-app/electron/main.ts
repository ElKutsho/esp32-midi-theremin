import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname shim (Vite outputs ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @ts-ignore – jzz has no type declarations
import JZZ from 'jzz';

let mainWindow: BrowserWindow | null = null;

// --- MIDI Output via jzz (Node.js, works with loopMIDI) ---
// Persistent JZZ engine — initialized once, kept alive for the app lifetime
let jzzEngine: any = null;
let jzzReady: Promise<void> = Promise.resolve();
let midiOut: any = null;
let midiPortName = '';
let midiLock: Promise<void> = Promise.resolve();

/** Serialize MIDI open/close operations to prevent race conditions */
function withMidiLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = midiLock;
  let release: () => void;
  midiLock = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}

/** Initialize the JZZ engine once on startup */
async function initMidiEngine(): Promise<void> {
  jzzReady = (async () => {
    try {
      jzzEngine = await JZZ({ sysex: false });
      // Give JZZ time to discover virtual MIDI ports (loopMIDI, etc.)
      await new Promise((r) => setTimeout(r, 300));
      const info = jzzEngine.info();
      console.log('[MIDI Main] Engine ready. Outputs:', info.outputs.map((o: any) => o.name));
    } catch (err) {
      console.error('[MIDI Main] Failed to initialize JZZ engine:', err);
      jzzEngine = null;
    }
  })();
  await jzzReady;
}

async function listMidiOutputs(): Promise<string[]> {
  await jzzReady;
  if (!jzzEngine) return [];
  try {
    // Refresh to detect hot-plugged devices (loopMIDI started after app, etc.)
    await jzzEngine.refresh();
    const info = jzzEngine.info();
    const outputs: string[] = info.outputs.map((o: any) => o.name);
    console.log('[MIDI Main] Available outputs:', outputs);
    return outputs;
  } catch (e) {
    console.error('[MIDI Main] Failed to list outputs:', e);
    return [];
  }
}

async function openMidiOutput(portName: string): Promise<boolean> {
  return withMidiLock(async () => {
    await jzzReady;
    if (!jzzEngine) return false;
    try {
      // Close existing port
      if (midiOut) {
        try { await midiOut.close(); } catch {}
        midiOut = null;
      }

      midiOut = await jzzEngine.openMidiOut(portName);
      midiPortName = portName;
      console.log('[MIDI Main] Opened output:', portName);
      return true;
    } catch (err) {
      console.error('[MIDI Main] Failed to open output:', portName, err);
      midiOut = null;
      midiPortName = '';
      return false;
    }
  });
}

async function closeMidiOutput(): Promise<void> {
  return withMidiLock(async () => {
    if (midiOut) {
      try { await midiOut.close(); } catch {}
      midiOut = null;
      midiPortName = '';
      console.log('[MIDI Main] Output closed');
    }
  });
}

function sendMidi(data: number[]): void {
  if (!midiOut) return;
  try {
    midiOut.send(data);
  } catch (err) {
    console.error('[MIDI Main] Send error:', err);
  }
}

async function shutdownMidi(): Promise<void> {
  await closeMidiOutput();
  if (jzzEngine) {
    try { await jzzEngine.close(); } catch {}
    jzzEngine = null;
    console.log('[MIDI Main] Engine shut down');
  }
}

// --- IPC Handlers ---
function setupIPC(): void {
  ipcMain.handle('midi:list-outputs', async () => {
    return listMidiOutputs();
  });

  ipcMain.handle('midi:open-output', async (_event, portName: string) => {
    return openMidiOutput(portName);
  });

  ipcMain.handle('midi:close-output', async () => {
    await closeMidiOutput();
  });

  ipcMain.on('midi:send', (_event, data: number[]) => {
    sendMidi(data);
  });
}

// --- Window ---
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#888',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Enable Web Serial API — auto-grant permission for serial devices
  session.defaultSession.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    if (portList.length === 1) {
      callback(portList[0].portId);
    } else {
      callback('');
    }
  });

  // Grant all permissions
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });
  session.defaultSession.setDevicePermissionHandler(() => true);

  // Dev or production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await initMidiEngine();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  shutdownMidi();
  if (process.platform !== 'darwin') app.quit();
});
