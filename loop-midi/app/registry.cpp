/*
 * registry.cpp — Windows Registry operations for the Virtual MIDI driver.
 *
 * Manages:
 * 1. Driver DLL registration in Drivers32
 * 2. Port configuration in HKLM\SOFTWARE\VirtualMIDI
 * 3. Autostart in HKCU\...\Run
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <cstdio>

#include "registry.h"

namespace vmidi {
namespace registry {

static const char* DRIVERS32_KEY = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Drivers32";
static const char* VMIDI_CONFIG_KEY = "SOFTWARE\\VirtualMIDI";
static const char* AUTOSTART_KEY = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
static const char* AUTOSTART_VALUE = "VirtualMIDI";
static const char* DRIVER_DLL_NAME = "vmidi.dll";

// ============================================================================
// Driver DLL Path
// ============================================================================

std::string getDriverDllPath() {
    char exePath[MAX_PATH] = {};
    GetModuleFileNameA(nullptr, exePath, MAX_PATH);

    // Replace exe filename with dll filename
    std::string path(exePath);
    size_t lastSlash = path.find_last_of("\\/");
    if (lastSlash != std::string::npos) {
        path = path.substr(0, lastSlash + 1);
    }
    path += DRIVER_DLL_NAME;
    return path;
}

// ============================================================================
// Drivers32 Registration
// ============================================================================

std::string getInstalledSlot() {
    HKEY hKey = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, DRIVERS32_KEY, 0, KEY_READ, &hKey) != ERROR_SUCCESS)
        return "";

    std::string dllPath = getDriverDllPath();
    std::string result;

    // Check midi, midi1, midi2, ... midi9
    for (int i = 0; i <= 9; i++) {
        char valueName[32];
        if (i == 0)
            snprintf(valueName, sizeof(valueName), "midi");
        else
            snprintf(valueName, sizeof(valueName), "midi%d", i);

        char data[MAX_PATH] = {};
        DWORD dataSize = sizeof(data);
        DWORD type = 0;

        if (RegQueryValueExA(hKey, valueName, nullptr, &type,
                             reinterpret_cast<BYTE*>(data), &dataSize) == ERROR_SUCCESS) {
            if (type == REG_SZ && _stricmp(data, dllPath.c_str()) == 0) {
                result = valueName;
                break;
            }
        }
    }

    RegCloseKey(hKey);
    return result;
}

bool isDriverInstalled() {
    return !getInstalledSlot().empty();
}

std::string installDriver() {
    // Check if already installed
    std::string existing = getInstalledSlot();
    if (!existing.empty()) return existing;

    HKEY hKey = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, DRIVERS32_KEY, 0,
                      KEY_READ | KEY_WRITE, &hKey) != ERROR_SUCCESS)
        return "";

    std::string dllPath = getDriverDllPath();
    std::string slot;

    // Find first free slot: midi, midi1, midi2, ...
    for (int i = 0; i <= 9; i++) {
        char valueName[32];
        if (i == 0)
            snprintf(valueName, sizeof(valueName), "midi");
        else
            snprintf(valueName, sizeof(valueName), "midi%d", i);

        char data[MAX_PATH] = {};
        DWORD dataSize = sizeof(data);
        DWORD type = 0;

        LONG result = RegQueryValueExA(hKey, valueName, nullptr, &type,
                                       reinterpret_cast<BYTE*>(data), &dataSize);
        if (result != ERROR_SUCCESS || (type == REG_SZ && strlen(data) == 0)) {
            // Empty or non-existent — use this slot
            if (RegSetValueExA(hKey, valueName, 0, REG_SZ,
                               reinterpret_cast<const BYTE*>(dllPath.c_str()),
                               static_cast<DWORD>(dllPath.length() + 1)) == ERROR_SUCCESS) {
                slot = valueName;
            }
            break;
        }
    }

    RegCloseKey(hKey);
    return slot;
}

bool uninstallDriver() {
    std::string slot = getInstalledSlot();
    if (slot.empty()) return true; // not installed

    HKEY hKey = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, DRIVERS32_KEY, 0,
                      KEY_WRITE, &hKey) != ERROR_SUCCESS)
        return false;

    bool ok = (RegDeleteValueA(hKey, slot.c_str()) == ERROR_SUCCESS);
    RegCloseKey(hKey);
    return ok;
}

// ============================================================================
// Port Configuration
// ============================================================================

bool savePortConfig(const std::vector<std::string>& portNames) {
    HKEY hKey = nullptr;
    DWORD disposition = 0;
    if (RegCreateKeyExA(HKEY_LOCAL_MACHINE, VMIDI_CONFIG_KEY, 0, nullptr,
                        REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr,
                        &hKey, &disposition) != ERROR_SUCCESS)
        return false;

    DWORD count = static_cast<DWORD>(portNames.size());
    RegSetValueExA(hKey, "PortCount", 0, REG_DWORD,
                   reinterpret_cast<const BYTE*>(&count), sizeof(DWORD));

    for (size_t i = 0; i < portNames.size(); i++) {
        char valueName[32];
        snprintf(valueName, sizeof(valueName), "Port%zuName", i);
        RegSetValueExA(hKey, valueName, 0, REG_SZ,
                       reinterpret_cast<const BYTE*>(portNames[i].c_str()),
                       static_cast<DWORD>(portNames[i].length() + 1));
    }

    RegCloseKey(hKey);
    return true;
}

std::vector<std::string> loadPortConfig() {
    std::vector<std::string> result;

    HKEY hKey = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, VMIDI_CONFIG_KEY, 0,
                      KEY_READ, &hKey) != ERROR_SUCCESS)
        return result;

    DWORD count = 0;
    DWORD size = sizeof(DWORD);
    if (RegQueryValueExA(hKey, "PortCount", nullptr, nullptr,
                         reinterpret_cast<BYTE*>(&count), &size) != ERROR_SUCCESS) {
        RegCloseKey(hKey);
        return result;
    }

    for (DWORD i = 0; i < count && i < 16; i++) {
        char valueName[32];
        snprintf(valueName, sizeof(valueName), "Port%uName", i);

        char data[128] = {};
        DWORD dataSize = sizeof(data);
        if (RegQueryValueExA(hKey, valueName, nullptr, nullptr,
                             reinterpret_cast<BYTE*>(data), &dataSize) == ERROR_SUCCESS) {
            result.push_back(data);
        }
    }

    RegCloseKey(hKey);
    return result;
}

// ============================================================================
// Autostart
// ============================================================================

bool setAutostart(bool enable) {
    HKEY hKey = nullptr;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, AUTOSTART_KEY, 0,
                      KEY_WRITE, &hKey) != ERROR_SUCCESS)
        return false;

    bool ok;
    if (enable) {
        char exePath[MAX_PATH] = {};
        GetModuleFileNameA(nullptr, exePath, MAX_PATH);
        std::string cmd = std::string("\"") + exePath + "\" --minimized";
        ok = (RegSetValueExA(hKey, AUTOSTART_VALUE, 0, REG_SZ,
                             reinterpret_cast<const BYTE*>(cmd.c_str()),
                             static_cast<DWORD>(cmd.length() + 1)) == ERROR_SUCCESS);
    } else {
        ok = (RegDeleteValueA(hKey, AUTOSTART_VALUE) == ERROR_SUCCESS);
    }

    RegCloseKey(hKey);
    return ok;
}

bool isAutostartEnabled() {
    HKEY hKey = nullptr;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, AUTOSTART_KEY, 0,
                      KEY_READ, &hKey) != ERROR_SUCCESS)
        return false;

    char data[MAX_PATH] = {};
    DWORD dataSize = sizeof(data);
    bool exists = (RegQueryValueExA(hKey, AUTOSTART_VALUE, nullptr, nullptr,
                                    reinterpret_cast<BYTE*>(data), &dataSize) == ERROR_SUCCESS);
    RegCloseKey(hKey);
    return exists;
}

} // namespace registry
} // namespace vmidi
