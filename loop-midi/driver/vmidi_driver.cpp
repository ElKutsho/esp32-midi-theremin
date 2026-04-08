/*
 * vmidi_driver.cpp — Virtual MIDI Loopback Driver (User-Mode DLL)
 *
 * This DLL is loaded by winmm.dll when applications open virtual MIDI ports.
 * It implements the standard Windows MIDI driver interface:
 *   - midMessage() for MIDI input
 *   - modMessage() for MIDI output
 *   - DriverProc() for driver lifecycle
 *
 * MIDI data written to the output is routed through shared memory to the
 * corresponding input, creating a virtual loopback cable.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmsystem.h>
#include <mmddk.h>
#include <cstring>
#include <cstdio>

#include "vmidi.h"

// MMSYSERR_UNPREPARED may not be defined in all SDK versions
#ifndef MMSYSERR_UNPREPARED
#define MMSYSERR_UNPREPARED 22
#endif

// ============================================================================
// Globals
// ============================================================================

static HMODULE g_hModule = nullptr;

// Cache of global state from the control application
static HANDLE                   g_hGlobalMem = nullptr;
static vmidi::GlobalSharedState* g_pGlobal   = nullptr;

static CRITICAL_SECTION g_cs;
static bool g_csInitialized = false;

// ============================================================================
// Helpers
// ============================================================================

static int getPortCount() {
    if (!g_pGlobal) {
        // Try to open global state
        vmidi::openGlobalState(g_hGlobalMem, g_pGlobal);
    }
    return g_pGlobal ? static_cast<int>(g_pGlobal->portCount) : 0;
}

static const char* getPortName(int index) {
    if (!g_pGlobal || index < 0 || index >= static_cast<int>(vmidi::MAX_PORTS))
        return vmidi::DEFAULT_PORT_NAME;
    return g_pGlobal->portNames[index];
}

// Perform MIDI input callback to the application
static void doInputCallback(vmidi::MidiInputInstance* inst, UINT msg,
                            DWORD_PTR dwParam1, DWORD_PTR dwParam2) {
    if (!inst || !inst->callback) return;

    DWORD flags = inst->flags & CALLBACK_TYPEMASK;

    switch (flags) {
        case CALLBACK_FUNCTION: {
            auto fn = reinterpret_cast<DRVCALLBACK*>(inst->callback);
            fn((HDRVR)inst, msg, inst->callbackInstance, dwParam1, dwParam2);
            break;
        }
        case CALLBACK_WINDOW:
            PostMessageA(reinterpret_cast<HWND>(inst->callback), msg,
                         static_cast<WPARAM>(dwParam1), static_cast<LPARAM>(dwParam2));
            break;
        case CALLBACK_THREAD:
            PostThreadMessageA(static_cast<DWORD>(inst->callback), msg,
                               static_cast<WPARAM>(dwParam1), static_cast<LPARAM>(dwParam2));
            break;
        case CALLBACK_EVENT:
            SetEvent(reinterpret_cast<HANDLE>(inst->callback));
            break;
        default:
            break;
    }
}

// Input polling thread — reads events from the ring buffer and dispatches callbacks
static DWORD WINAPI inputPollThread(LPVOID param) {
    auto* inst = static_cast<vmidi::MidiInputInstance*>(param);
    if (!inst || !inst->ipc.isValid()) return 1;

    while (inst->threadRunning) {
        // Wait for signal from the output side (or timeout for checking threadRunning)
        WaitForSingleObject(inst->ipc.hSignalEvent, 10); // 10ms timeout

        if (!inst->started || !inst->threadRunning) continue;

        vmidi::MidiEvent evt;
        while (inst->ipc.pData && inst->ipc.pData->ringBuffer.read(evt)) {
            if (!inst->started) break;

            if (evt.length <= 3) {
                // Short MIDI message — pack into DWORD
                DWORD shortMsg = 0;
                for (int i = 0; i < evt.length && i < 3; i++) {
                    shortMsg |= (static_cast<DWORD>(evt.data[i]) << (i * 8));
                }
                doInputCallback(inst, MIM_DATA,
                                static_cast<DWORD_PTR>(shortMsg),
                                static_cast<DWORD_PTR>(evt.timestamp));
            }
            // SysEx / long messages would go through MIDM_ADDBUFFER / MIM_LONGDATA
            // (simplified: only short messages for now)
        }
    }
    return 0;
}

// ============================================================================
// MIDI OUTPUT (modMessage)
// ============================================================================

extern "C" __declspec(dllexport)
DWORD WINAPI modMessage(UINT deviceId, UINT msg, DWORD_PTR user,
                        DWORD_PTR param1, DWORD_PTR param2) {
    switch (msg) {

    case MODM_GETNUMDEVS:
        return getPortCount();

    case MODM_GETDEVCAPS: {
        if (!param1 || param2 < sizeof(MIDIOUTCAPSA)) return MMSYSERR_INVALPARAM;
        auto* caps = reinterpret_cast<MIDIOUTCAPSA*>(param1);
        memset(caps, 0, sizeof(MIDIOUTCAPSA));
        caps->wMid           = vmidi::VMIDI_MID;
        caps->wPid           = vmidi::VMIDI_PID;
        caps->vDriverVersion = vmidi::VMIDI_VERSION;
        const char* name = getPortName(static_cast<int>(deviceId));
        strncpy(caps->szPname, name, MAXPNAMELEN - 1);
        caps->szPname[MAXPNAMELEN - 1] = '\0';
        caps->wTechnology    = MOD_MIDIPORT;
        caps->wVoices        = 0;
        caps->wNotes         = 0;
        caps->wChannelMask   = 0xFFFF;
        caps->dwSupport      = 0;
        return MMSYSERR_NOERROR;
    }

    case MODM_OPEN: {
        auto* openDesc = reinterpret_cast<MIDIOPENDESC*>(param1);
        if (!openDesc) return MMSYSERR_INVALPARAM;

        auto* inst = new (std::nothrow) vmidi::MidiOutputInstance();
        if (!inst) return MMSYSERR_NOMEM;

        inst->portIndex        = static_cast<int>(deviceId);
        inst->flags            = static_cast<DWORD>(param2);
        inst->callback         = openDesc->dwCallback;
        inst->callbackInstance = openDesc->dwInstance;

        // Open shared memory for this port
        if (!vmidi::openPortIpc(inst->portIndex, inst->ipc)) {
            delete inst;
            return MMSYSERR_ALLOCATED; // port not available
        }

        InterlockedIncrement(reinterpret_cast<volatile LONG*>(
            &inst->ipc.pData->outputOpenCount));

        // Store instance pointer for subsequent calls
        *reinterpret_cast<DWORD_PTR*>(user) = reinterpret_cast<DWORD_PTR>(inst);

        // Notify app that port is open
        DWORD cbFlags = inst->flags & CALLBACK_TYPEMASK;
        if (cbFlags == CALLBACK_FUNCTION) {
            auto fn = reinterpret_cast<DRVCALLBACK*>(inst->callback);
            fn((HDRVR)inst, MOM_OPEN, inst->callbackInstance, 0, 0);
        } else if (cbFlags == CALLBACK_WINDOW) {
            PostMessageA(reinterpret_cast<HWND>(inst->callback), MOM_OPEN, 0, 0);
        }

        return MMSYSERR_NOERROR;
    }

    case MODM_CLOSE: {
        auto* inst = reinterpret_cast<vmidi::MidiOutputInstance*>(user);
        if (!inst) return MMSYSERR_INVALHANDLE;

        if (inst->ipc.pData) {
            InterlockedDecrement(reinterpret_cast<volatile LONG*>(
                &inst->ipc.pData->outputOpenCount));
        }

        // Notify app
        DWORD cbFlags = inst->flags & CALLBACK_TYPEMASK;
        if (cbFlags == CALLBACK_FUNCTION) {
            auto fn = reinterpret_cast<DRVCALLBACK*>(inst->callback);
            fn((HDRVR)inst, MOM_CLOSE, inst->callbackInstance, 0, 0);
        } else if (cbFlags == CALLBACK_WINDOW) {
            PostMessageA(reinterpret_cast<HWND>(inst->callback), MOM_CLOSE, 0, 0);
        }

        inst->ipc.close();
        delete inst;
        return MMSYSERR_NOERROR;
    }

    case MODM_DATA: {
        // Short MIDI message (up to 3 bytes packed in param1)
        auto* inst = reinterpret_cast<vmidi::MidiOutputInstance*>(user);
        if (!inst || !inst->ipc.isValid()) return MMSYSERR_INVALHANDLE;

        vmidi::MidiEvent evt;
        evt.timestamp = timeGetTime();

        DWORD shortMsg = static_cast<DWORD>(param1);
        evt.data[0] = static_cast<uint8_t>(shortMsg & 0xFF);
        evt.data[1] = static_cast<uint8_t>((shortMsg >> 8) & 0xFF);
        evt.data[2] = static_cast<uint8_t>((shortMsg >> 16) & 0xFF);
        evt.data[3] = 0;

        // Determine message length from status byte
        uint8_t status = evt.data[0];
        if (status >= 0xF0) {
            // System messages
            switch (status) {
                case 0xF1: case 0xF3: evt.length = 2; break;
                case 0xF2:            evt.length = 3; break;
                default:              evt.length = 1; break;
            }
        } else if (status >= 0xC0 && status <= 0xDF) {
            evt.length = 2; // Program Change, Channel Pressure
        } else {
            evt.length = 3; // Note On/Off, CC, Pitch Bend, Aftertouch
        }

        inst->ipc.pData->ringBuffer.write(evt);
        SetEvent(inst->ipc.hSignalEvent); // wake up input thread

        return MMSYSERR_NOERROR;
    }

    case MODM_LONGDATA: {
        // SysEx / long MIDI message
        auto* inst = reinterpret_cast<vmidi::MidiOutputInstance*>(user);
        if (!inst || !inst->ipc.isValid()) return MMSYSERR_INVALHANDLE;

        auto* hdr = reinterpret_cast<MIDIHDR*>(param1);
        if (!hdr || !(hdr->dwFlags & MHDR_PREPARED)) return MMSYSERR_UNPREPARED;

        // Write SysEx data as individual short events (simplified)
        // A full implementation would handle long data buffers on the input side
        uint32_t ts = timeGetTime();
        for (DWORD i = 0; i < hdr->dwBufferLength; i++) {
            vmidi::MidiEvent evt;
            evt.timestamp = ts;
            evt.length = 1;
            evt.data[0] = static_cast<uint8_t>(hdr->lpData[i]);
            evt.data[1] = 0;
            evt.data[2] = 0;
            evt.data[3] = 0;
            inst->ipc.pData->ringBuffer.write(evt);
        }
        SetEvent(inst->ipc.hSignalEvent);

        hdr->dwFlags |= MHDR_DONE;

        // Notify completion
        DWORD cbFlags = inst->flags & CALLBACK_TYPEMASK;
        if (cbFlags == CALLBACK_FUNCTION) {
            auto fn = reinterpret_cast<DRVCALLBACK*>(inst->callback);
            fn((HDRVR)inst, MOM_DONE, inst->callbackInstance,
               reinterpret_cast<DWORD_PTR>(hdr), 0);
        } else if (cbFlags == CALLBACK_WINDOW) {
            PostMessageA(reinterpret_cast<HWND>(inst->callback), MOM_DONE,
                         reinterpret_cast<WPARAM>(hdr), 0);
        }

        return MMSYSERR_NOERROR;
    }

    case MODM_PREPARE:
    case MODM_UNPREPARE:
        return MMSYSERR_NOERROR; // nothing to do for software driver

    case MODM_RESET: {
        // Cancel pending output — ring buffer flush
        auto* inst = reinterpret_cast<vmidi::MidiOutputInstance*>(user);
        if (inst && inst->ipc.isValid()) {
            inst->ipc.pData->ringBuffer.init();
        }
        return MMSYSERR_NOERROR;
    }

    default:
        return MMSYSERR_NOTSUPPORTED;
    }
}

// ============================================================================
// MIDI INPUT (midMessage)
// ============================================================================

extern "C" __declspec(dllexport)
DWORD WINAPI midMessage(UINT deviceId, UINT msg, DWORD_PTR user,
                        DWORD_PTR param1, DWORD_PTR param2) {
    switch (msg) {

    case MIDM_GETNUMDEVS:
        return getPortCount();

    case MIDM_GETDEVCAPS: {
        if (!param1 || param2 < sizeof(MIDIINCAPSA)) return MMSYSERR_INVALPARAM;
        auto* caps = reinterpret_cast<MIDIINCAPSA*>(param1);
        memset(caps, 0, sizeof(MIDIINCAPSA));
        caps->wMid           = vmidi::VMIDI_MID;
        caps->wPid           = vmidi::VMIDI_PID;
        caps->vDriverVersion = vmidi::VMIDI_VERSION;
        const char* name = getPortName(static_cast<int>(deviceId));
        strncpy(caps->szPname, name, MAXPNAMELEN - 1);
        caps->szPname[MAXPNAMELEN - 1] = '\0';
        caps->dwSupport      = 0;
        return MMSYSERR_NOERROR;
    }

    case MIDM_OPEN: {
        auto* openDesc = reinterpret_cast<MIDIOPENDESC*>(param1);
        if (!openDesc) return MMSYSERR_INVALPARAM;

        auto* inst = new (std::nothrow) vmidi::MidiInputInstance();
        if (!inst) return MMSYSERR_NOMEM;

        memset(inst, 0, sizeof(vmidi::MidiInputInstance));
        inst->portIndex        = static_cast<int>(deviceId);
        inst->flags            = static_cast<DWORD>(param2);
        inst->callback         = openDesc->dwCallback;
        inst->callbackInstance = openDesc->dwInstance;
        inst->started          = false;
        inst->firstBuffer      = nullptr;

        InitializeCriticalSection(&inst->bufferLock);

        // Open shared memory
        if (!vmidi::openPortIpc(inst->portIndex, inst->ipc)) {
            DeleteCriticalSection(&inst->bufferLock);
            delete inst;
            return MMSYSERR_ALLOCATED;
        }

        InterlockedIncrement(reinterpret_cast<volatile LONG*>(
            &inst->ipc.pData->inputOpenCount));

        // Start input polling thread
        inst->threadRunning = true;
        inst->hThread = CreateThread(nullptr, 0, inputPollThread, inst, 0, nullptr);
        if (!inst->hThread) {
            inst->ipc.close();
            DeleteCriticalSection(&inst->bufferLock);
            delete inst;
            return MMSYSERR_NOMEM;
        }

        *reinterpret_cast<DWORD_PTR*>(user) = reinterpret_cast<DWORD_PTR>(inst);

        doInputCallback(inst, MIM_OPEN, 0, 0);
        return MMSYSERR_NOERROR;
    }

    case MIDM_CLOSE: {
        auto* inst = reinterpret_cast<vmidi::MidiInputInstance*>(user);
        if (!inst) return MMSYSERR_INVALHANDLE;

        // Stop thread
        inst->threadRunning = false;
        inst->started = false;
        if (inst->hThread) {
            WaitForSingleObject(inst->hThread, 1000);
            CloseHandle(inst->hThread);
            inst->hThread = nullptr;
        }

        if (inst->ipc.pData) {
            InterlockedDecrement(reinterpret_cast<volatile LONG*>(
                &inst->ipc.pData->inputOpenCount));
        }

        doInputCallback(inst, MIM_CLOSE, 0, 0);

        inst->ipc.close();
        DeleteCriticalSection(&inst->bufferLock);
        delete inst;
        return MMSYSERR_NOERROR;
    }

    case MIDM_START: {
        auto* inst = reinterpret_cast<vmidi::MidiInputInstance*>(user);
        if (!inst) return MMSYSERR_INVALHANDLE;
        inst->started = true;
        return MMSYSERR_NOERROR;
    }

    case MIDM_STOP: {
        auto* inst = reinterpret_cast<vmidi::MidiInputInstance*>(user);
        if (!inst) return MMSYSERR_INVALHANDLE;
        inst->started = false;
        return MMSYSERR_NOERROR;
    }

    case MIDM_ADDBUFFER: {
        auto* inst = reinterpret_cast<vmidi::MidiInputInstance*>(user);
        if (!inst) return MMSYSERR_INVALHANDLE;
        auto* hdr = reinterpret_cast<MIDIHDR*>(param1);
        if (!hdr || !(hdr->dwFlags & MHDR_PREPARED)) return MMSYSERR_UNPREPARED;

        hdr->dwFlags &= ~MHDR_DONE;
        hdr->dwFlags |= MHDR_INQUEUE;
        hdr->dwBytesRecorded = 0;

        EnterCriticalSection(&inst->bufferLock);
        hdr->lpNext = inst->firstBuffer;
        inst->firstBuffer = hdr;
        LeaveCriticalSection(&inst->bufferLock);

        return MMSYSERR_NOERROR;
    }

    case MIDM_PREPARE:
    case MIDM_UNPREPARE:
        return MMSYSERR_NOERROR;

    case MIDM_RESET: {
        auto* inst = reinterpret_cast<vmidi::MidiInputInstance*>(user);
        if (!inst) return MMSYSERR_INVALHANDLE;
        inst->started = false;

        // Return all pending buffers
        EnterCriticalSection(&inst->bufferLock);
        MIDIHDR* hdr = inst->firstBuffer;
        inst->firstBuffer = nullptr;
        LeaveCriticalSection(&inst->bufferLock);

        while (hdr) {
            MIDIHDR* next = hdr->lpNext;
            hdr->dwFlags &= ~MHDR_INQUEUE;
            hdr->dwFlags |= MHDR_DONE;
            doInputCallback(inst, MIM_LONGERROR,
                            reinterpret_cast<DWORD_PTR>(hdr), 0);
            hdr = next;
        }
        return MMSYSERR_NOERROR;
    }

    default:
        return MMSYSERR_NOTSUPPORTED;
    }
}

// ============================================================================
// DriverProc — Standard driver procedure
// ============================================================================

extern "C" __declspec(dllexport)
LRESULT WINAPI DriverProc(DWORD_PTR dwDriverId, HDRVR hDriver,
                          UINT msg, LPARAM lParam1, LPARAM lParam2) {
    switch (msg) {
    case DRV_LOAD:
        if (!g_csInitialized) {
            InitializeCriticalSection(&g_cs);
            g_csInitialized = true;
        }
        // Try to connect to global shared state
        vmidi::openGlobalState(g_hGlobalMem, g_pGlobal);
        return 1; // success

    case DRV_FREE:
        if (g_pGlobal) {
            UnmapViewOfFile(g_pGlobal);
            g_pGlobal = nullptr;
        }
        if (g_hGlobalMem) {
            CloseHandle(g_hGlobalMem);
            g_hGlobalMem = nullptr;
        }
        if (g_csInitialized) {
            DeleteCriticalSection(&g_cs);
            g_csInitialized = false;
        }
        return 1;

    case DRV_OPEN:
        return 1;

    case DRV_CLOSE:
        return 1;

    case DRV_ENABLE:
    case DRV_DISABLE:
        return 1;

    case DRV_QUERYCONFIGURE:
        return 0; // no configuration dialog

    case DRV_INSTALL:
        return DRVCNF_OK;

    case DRV_REMOVE:
        return 1;

    default:
        return DefDriverProc(dwDriverId, hDriver, msg, lParam1, lParam2);
    }
}

// ============================================================================
// DLL Entry Point
// ============================================================================

BOOL WINAPI DllMain(HINSTANCE hInstance, DWORD reason, LPVOID /*reserved*/) {
    switch (reason) {
    case DLL_PROCESS_ATTACH:
        g_hModule = hInstance;
        DisableThreadLibraryCalls(hInstance);
        break;
    case DLL_PROCESS_DETACH:
        break;
    }
    return TRUE;
}
