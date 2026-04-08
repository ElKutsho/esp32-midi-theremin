#pragma once
/*
 * ports.h — Virtual MIDI port management.
 *
 * Manages the shared memory regions and events that implement
 * the virtual MIDI loopback for each port.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string>
#include <vector>

#include "../shared/ipc.h"

namespace vmidi {
namespace ports {

struct PortInfo {
    int         index;
    std::string name;
    bool        active;
    uint32_t    outputOpenCount;
    uint32_t    inputOpenCount;
    PortIpcHandles handles;
};

// Initialize the port manager — creates global shared state
bool init();

// Shutdown — closes all ports and releases global shared state
void shutdown();

// Add a new virtual MIDI port with the given name. Returns port index or -1.
int addPort(const std::string& name);

// Remove a port by index
bool removePort(int index);

// Get list of all active ports
std::vector<PortInfo> getPorts();

// Get port count
int getPortCount();

// Refresh port stats (open counts etc.)
void refreshStats();

// Rebuild ports from saved configuration
bool loadFromConfig();

// Save current ports to config
bool saveToConfig();

} // namespace ports
} // namespace vmidi
