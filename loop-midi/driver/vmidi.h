#pragma once
/*
 * Virtual MIDI Driver — shared definitions between driver components.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmsystem.h>
#include <mmddk.h>

#include "../shared/ipc.h"
#include "../shared/ringbuffer.h"

namespace vmidi {

// Manufacturer / product identifiers for MIDIINCAPS / MIDIOUTCAPS
static constexpr WORD   VMIDI_MID         = 0xFFFF;  // Manufacturer ID (private)
static constexpr WORD   VMIDI_PID         = 0x0001;  // Product ID
static constexpr MMVERSION VMIDI_VERSION  = 0x0100;  // Driver version 1.0
static constexpr WORD   VMIDI_TECHNOLOGY  = MOD_SWSYNTH; // Software synth type

// Default port name prefix
static constexpr const char* DEFAULT_PORT_NAME = "Virtual MIDI Port";

// Per-instance data for an open MIDI input stream
struct MidiInputInstance {
    int          portIndex;
    DWORD        flags;
    DWORD_PTR    callback;
    DWORD_PTR    callbackInstance;
    DWORD_PTR    dwUser;
    bool         started;       // MIDM_START was called
    HANDLE       hThread;       // input polling thread
    bool         threadRunning;
    PortIpcHandles ipc;

    // Long data (SysEx) buffers queued via MIDM_ADDBUFFER
    MIDIHDR*     firstBuffer;
    CRITICAL_SECTION bufferLock;
};

// Per-instance data for an open MIDI output stream
struct MidiOutputInstance {
    int          portIndex;
    DWORD        flags;
    DWORD_PTR    callback;
    DWORD_PTR    callbackInstance;
    DWORD_PTR    dwUser;
    PortIpcHandles ipc;
};

} // namespace vmidi
