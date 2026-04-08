#pragma once
/*
 * registry.h — Register/unregister the virtual MIDI driver DLL
 *              in the Windows Drivers32 registry key.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string>
#include <vector>

namespace vmidi {
namespace registry {

// Find the path to our vmidi.dll (next to the .exe)
std::string getDriverDllPath();

// Register the driver DLL in Drivers32. Returns the slot name (e.g. "midi3")
// or empty string on failure. Requires admin privileges.
std::string installDriver();

// Remove the driver from Drivers32
bool uninstallDriver();

// Check if the driver is currently registered
bool isDriverInstalled();

// Get the registry slot (e.g. "midi2") if installed, or empty
std::string getInstalledSlot();

// ---- Port configuration (stored in HKLM\SOFTWARE\VirtualMIDI) ----

bool savePortConfig(const std::vector<std::string>& portNames);
std::vector<std::string> loadPortConfig();

// ---- Autostart ----

bool setAutostart(bool enable);
bool isAutostartEnabled();

} // namespace registry
} // namespace vmidi
