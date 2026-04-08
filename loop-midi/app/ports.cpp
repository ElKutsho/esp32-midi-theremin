/*
 * ports.cpp — Virtual MIDI port lifecycle management.
 *
 * Creates and manages shared memory regions + events for each virtual port.
 * Also maintains the global shared state that the driver DLL reads to know
 * how many ports are available and what they're named.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <cstring>
#include <algorithm>

#include "ports.h"
#include "registry.h"

namespace vmidi {
namespace ports {

// --- Internal state ---

static HANDLE              g_hGlobalMem = nullptr;
static GlobalSharedState*  g_pGlobal    = nullptr;

static PortInfo g_ports[MAX_PORTS];
static int      g_portCount = 0;

// --- Helpers ---

static void updateGlobalState() {
    if (!g_pGlobal) return;
    g_pGlobal->portCount = static_cast<uint32_t>(g_portCount);
    for (int i = 0; i < static_cast<int>(MAX_PORTS); i++) {
        if (i < g_portCount) {
            strncpy(g_pGlobal->portNames[i], g_ports[i].name.c_str(), PORT_NAME_LEN - 1);
            g_pGlobal->portNames[i][PORT_NAME_LEN - 1] = '\0';
        } else {
            g_pGlobal->portNames[i][0] = '\0';
        }
    }
}

// --- Public API ---

bool init() {
    if (!createGlobalState(g_hGlobalMem, g_pGlobal))
        return false;

    g_portCount = 0;
    memset(g_ports, 0, sizeof(g_ports));
    updateGlobalState();
    return true;
}

void shutdown() {
    // Close all ports
    for (int i = 0; i < g_portCount; i++) {
        if (g_ports[i].handles.pData) {
            g_ports[i].handles.pData->active = 0;
        }
        g_ports[i].handles.close();
    }
    g_portCount = 0;

    if (g_pGlobal) {
        g_pGlobal->portCount = 0;
        UnmapViewOfFile(g_pGlobal);
        g_pGlobal = nullptr;
    }
    if (g_hGlobalMem) {
        CloseHandle(g_hGlobalMem);
        g_hGlobalMem = nullptr;
    }
}

int addPort(const std::string& name) {
    if (g_portCount >= static_cast<int>(MAX_PORTS)) return -1;

    int idx = g_portCount;

    PortIpcHandles handles;
    if (!createPortIpc(idx, name.c_str(), handles))
        return -1;

    g_ports[idx].index = idx;
    g_ports[idx].name = name;
    g_ports[idx].active = true;
    g_ports[idx].outputOpenCount = 0;
    g_ports[idx].inputOpenCount = 0;
    g_ports[idx].handles = handles;

    g_portCount++;
    updateGlobalState();
    return idx;
}

bool removePort(int index) {
    if (index < 0 || index >= g_portCount) return false;

    // Mark inactive
    if (g_ports[index].handles.pData) {
        g_ports[index].handles.pData->active = 0;
        // Reset active event to signal closing
        if (g_ports[index].handles.hActiveEvent) {
            ResetEvent(g_ports[index].handles.hActiveEvent);
        }
    }
    g_ports[index].handles.close();

    // Shift remaining ports down
    for (int i = index; i < g_portCount - 1; i++) {
        g_ports[i] = g_ports[i + 1];
        g_ports[i].index = i;
    }
    g_portCount--;

    // Clear last slot
    memset(&g_ports[g_portCount], 0, sizeof(PortInfo));

    updateGlobalState();
    return true;
}

std::vector<PortInfo> getPorts() {
    std::vector<PortInfo> result;
    for (int i = 0; i < g_portCount; i++) {
        refreshStats();
        result.push_back(g_ports[i]);
    }
    return result;
}

int getPortCount() {
    return g_portCount;
}

void refreshStats() {
    for (int i = 0; i < g_portCount; i++) {
        if (g_ports[i].handles.pData) {
            g_ports[i].outputOpenCount = g_ports[i].handles.pData->outputOpenCount;
            g_ports[i].inputOpenCount  = g_ports[i].handles.pData->inputOpenCount;
        }
    }
}

bool loadFromConfig() {
    auto names = registry::loadPortConfig();
    for (const auto& name : names) {
        if (addPort(name) < 0) return false;
    }
    return true;
}

bool saveToConfig() {
    std::vector<std::string> names;
    for (int i = 0; i < g_portCount; i++) {
        names.push_back(g_ports[i].name);
    }
    return registry::savePortConfig(names);
}

} // namespace ports
} // namespace vmidi
