#pragma once
/*
 * Shared Memory IPC for Virtual MIDI loopback.
 *
 * The control application creates the shared memory region and named events.
 * The MIDI driver DLL (loaded in various app processes) opens existing handles.
 *
 * Naming convention:
 *   Shared Memory : "Local\\VirtualMIDI_Port_<N>"
 *   Signal Event  : "Local\\VirtualMIDI_Signal_<N>"   (output→input notification)
 *   Active Event  : "Local\\VirtualMIDI_Active_<N>"   (port is active)
 */

#include <cstdint>
#include <cstring>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "ringbuffer.h"

namespace vmidi {

static constexpr uint32_t MAX_PORTS       = 16;
static constexpr uint32_t MAGIC           = 0x564D4944; // 'VMID'
static constexpr uint32_t VERSION         = 1;
static constexpr uint32_t PORT_NAME_LEN   = 64;

// Stored in shared memory — one per virtual port
struct PortSharedData {
    uint32_t   magic;
    uint32_t   version;
    char       name[PORT_NAME_LEN];
    uint32_t   active;          // 1 = port is active
    uint32_t   outputOpenCount; // how many output handles are open
    uint32_t   inputOpenCount;  // how many input handles are open
    RingBuffer ringBuffer;
};

// ----- Helper: build named object names -----

inline void buildSharedMemName(char* buf, size_t bufLen, int portIndex) {
    snprintf(buf, bufLen, "Local\\VirtualMIDI_Port_%d", portIndex);
}

inline void buildSignalEventName(char* buf, size_t bufLen, int portIndex) {
    snprintf(buf, bufLen, "Local\\VirtualMIDI_Signal_%d", portIndex);
}

inline void buildActiveEventName(char* buf, size_t bufLen, int portIndex) {
    snprintf(buf, bufLen, "Local\\VirtualMIDI_Active_%d", portIndex);
}

// ----- Global shared state (created by the control app) -----

static constexpr const char* GLOBAL_SHARED_MEM_NAME = "Local\\VirtualMIDI_Global";

struct GlobalSharedState {
    uint32_t magic;
    uint32_t version;
    uint32_t portCount;
    char     portNames[MAX_PORTS][PORT_NAME_LEN];
};

// ----- IPC Handle wrapper -----

struct PortIpcHandles {
    HANDLE hSharedMem   = nullptr;
    HANDLE hSignalEvent = nullptr;
    HANDLE hActiveEvent = nullptr;
    PortSharedData* pData = nullptr;

    bool isValid() const { return pData != nullptr; }

    void close() {
        if (pData) {
            UnmapViewOfFile(pData);
            pData = nullptr;
        }
        if (hSharedMem) {
            CloseHandle(hSharedMem);
            hSharedMem = nullptr;
        }
        if (hSignalEvent) {
            CloseHandle(hSignalEvent);
            hSignalEvent = nullptr;
        }
        if (hActiveEvent) {
            CloseHandle(hActiveEvent);
            hActiveEvent = nullptr;
        }
    }
};

// Create a port's shared memory region (called by control app)
inline bool createPortIpc(int portIndex, const char* portName, PortIpcHandles& out) {
    char shmName[128], sigName[128], actName[128];
    buildSharedMemName(shmName, sizeof(shmName), portIndex);
    buildSignalEventName(sigName, sizeof(sigName), portIndex);
    buildActiveEventName(actName, sizeof(actName), portIndex);

    // Create shared memory
    out.hSharedMem = CreateFileMappingA(
        INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
        0, sizeof(PortSharedData), shmName);
    if (!out.hSharedMem) return false;

    out.pData = static_cast<PortSharedData*>(
        MapViewOfFile(out.hSharedMem, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(PortSharedData)));
    if (!out.pData) { out.close(); return false; }

    // Initialize shared data
    memset(out.pData, 0, sizeof(PortSharedData));
    out.pData->magic   = MAGIC;
    out.pData->version = VERSION;
    strncpy(out.pData->name, portName, PORT_NAME_LEN - 1);
    out.pData->name[PORT_NAME_LEN - 1] = '\0';
    out.pData->active = 1;
    out.pData->ringBuffer.init();

    // Create signal event (auto-reset)
    out.hSignalEvent = CreateEventA(nullptr, FALSE, FALSE, sigName);
    if (!out.hSignalEvent) { out.close(); return false; }

    // Create active event (manual-reset, signaled when port is active)
    out.hActiveEvent = CreateEventA(nullptr, TRUE, TRUE, actName);
    if (!out.hActiveEvent) { out.close(); return false; }

    return true;
}

// Open an existing port's shared memory (called by driver DLL)
inline bool openPortIpc(int portIndex, PortIpcHandles& out) {
    char shmName[128], sigName[128], actName[128];
    buildSharedMemName(shmName, sizeof(shmName), portIndex);
    buildSignalEventName(sigName, sizeof(sigName), portIndex);
    buildActiveEventName(actName, sizeof(actName), portIndex);

    out.hSharedMem = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, shmName);
    if (!out.hSharedMem) return false;

    out.pData = static_cast<PortSharedData*>(
        MapViewOfFile(out.hSharedMem, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(PortSharedData)));
    if (!out.pData) { out.close(); return false; }

    // Validate magic
    if (out.pData->magic != MAGIC || out.pData->version != VERSION) {
        out.close();
        return false;
    }

    out.hSignalEvent = OpenEventA(EVENT_ALL_ACCESS, FALSE, sigName);
    if (!out.hSignalEvent) { out.close(); return false; }

    out.hActiveEvent = OpenEventA(SYNCHRONIZE, FALSE, actName);
    if (!out.hActiveEvent) { out.close(); return false; }

    return true;
}

// Create global shared state (control app)
inline bool createGlobalState(HANDLE& hMem, GlobalSharedState*& pState) {
    hMem = CreateFileMappingA(
        INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
        0, sizeof(GlobalSharedState), GLOBAL_SHARED_MEM_NAME);
    if (!hMem) return false;

    pState = static_cast<GlobalSharedState*>(
        MapViewOfFile(hMem, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(GlobalSharedState)));
    if (!pState) { CloseHandle(hMem); hMem = nullptr; return false; }

    memset(pState, 0, sizeof(GlobalSharedState));
    pState->magic   = MAGIC;
    pState->version = VERSION;
    return true;
}

// Open global shared state (driver DLL)
inline bool openGlobalState(HANDLE& hMem, GlobalSharedState*& pState) {
    hMem = OpenFileMappingA(FILE_MAP_READ, FALSE, GLOBAL_SHARED_MEM_NAME);
    if (!hMem) return false;

    pState = static_cast<GlobalSharedState*>(
        MapViewOfFile(hMem, FILE_MAP_READ, 0, 0, sizeof(GlobalSharedState)));
    if (!pState) { CloseHandle(hMem); hMem = nullptr; return false; }

    if (pState->magic != MAGIC || pState->version != VERSION) {
        UnmapViewOfFile(pState); pState = nullptr;
        CloseHandle(hMem); hMem = nullptr;
        return false;
    }
    return true;
}

} // namespace vmidi
