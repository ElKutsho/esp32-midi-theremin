/*
 * main.cpp — Virtual MIDI Loopback Control Application
 *
 * System tray application that:
 * 1. Registers the vmidi.dll driver in Windows Drivers32 registry
 * 2. Creates and manages shared memory for virtual MIDI ports
 * 3. Provides a tray icon with context menu for port management
 *
 * Must be run as Administrator (for Drivers32 registry access).
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <commctrl.h>
#include <cstdio>
#include <cstring>
#include <string>

#include "resource.h"
#include "tray.h"
#include "ports.h"
#include "registry.h"

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")

// ============================================================================
// Globals
// ============================================================================

static HINSTANCE g_hInstance = nullptr;
static HWND      g_hWnd     = nullptr;
static bool      g_minimized = false;
static int       g_nextPortNum = 1; // for auto-naming

// ============================================================================
// Port Management Helpers
// ============================================================================

static void updateTooltipText() {
    char tip[128];
    int count = vmidi::ports::getPortCount();
    snprintf(tip, sizeof(tip), "Virtual MIDI - %d Port%s aktiv",
             count, count == 1 ? "" : "s");
    vmidi::tray::updateTooltip(tip);
}

static void doAddPort() {
    // Simple input dialog — we use a MessageBox-style approach with GetSaveFileName
    // For simplicity, auto-generate a port name
    char name[64];
    snprintf(name, sizeof(name), "loopMIDI Port %d", g_nextPortNum);

    int idx = vmidi::ports::addPort(name);
    if (idx >= 0) {
        g_nextPortNum++;
        vmidi::ports::saveToConfig();
        updateTooltipText();

        char msg[128];
        snprintf(msg, sizeof(msg), "Port '%s' erstellt.", name);
        vmidi::tray::showBalloon("Virtual MIDI", msg);
    } else {
        MessageBoxA(g_hWnd, "Konnte Port nicht erstellen.\n"
                    "Maximale Anzahl erreicht oder Fehler beim Shared Memory.",
                    "Virtual MIDI - Fehler", MB_OK | MB_ICONERROR);
    }
}

static void doRemovePort(int index) {
    auto portsBefore = vmidi::ports::getPorts();
    if (index < 0 || index >= static_cast<int>(portsBefore.size())) return;

    std::string name = portsBefore[index].name;
    if (vmidi::ports::removePort(index)) {
        vmidi::ports::saveToConfig();
        updateTooltipText();

        char msg[128];
        snprintf(msg, sizeof(msg), "Port '%s' entfernt.", name.c_str());
        vmidi::tray::showBalloon("Virtual MIDI", msg);
    }
}

static void doToggleAutostart() {
    bool current = vmidi::registry::isAutostartEnabled();
    vmidi::registry::setAutostart(!current);
}

static void doShowAbout() {
    char text[512];
    int portCount = vmidi::ports::getPortCount();
    bool driverInstalled = vmidi::registry::isDriverInstalled();

    snprintf(text, sizeof(text),
             "Virtual MIDI Loopback v1.0\n\n"
             "Erstellt virtuelle MIDI-Ports fuer die\n"
             "Kommunikation zwischen Anwendungen.\n\n"
             "Treiber: %s\n"
             "Aktive Ports: %d\n"
             "Max Ports: %d\n\n"
             "Teil des ESP32 MIDI Theremin Projekts.",
             driverInstalled ? "Installiert" : "Nicht installiert",
             portCount,
             static_cast<int>(vmidi::MAX_PORTS));

    MessageBoxA(g_hWnd, text, "Ueber Virtual MIDI", MB_OK | MB_ICONINFORMATION);
}

// ============================================================================
// Window Procedure
// ============================================================================

static LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {

    case WM_TRAYICON:
        switch (LOWORD(lParam)) {
        case WM_RBUTTONUP:
        case WM_CONTEXTMENU:
            vmidi::tray::showContextMenu(hWnd);
            break;
        case WM_LBUTTONDBLCLK:
            doShowAbout();
            break;
        }
        return 0;

    case WM_COMMAND: {
        UINT cmdId = LOWORD(wParam);

        if (cmdId == IDM_ADD_PORT) {
            doAddPort();
        } else if (cmdId == IDM_AUTOSTART) {
            doToggleAutostart();
        } else if (cmdId == IDM_ABOUT) {
            doShowAbout();
        } else if (cmdId == IDM_EXIT) {
            PostQuitMessage(0);
        } else if (cmdId >= IDM_PORT_BASE + 100 && cmdId < IDM_PORT_BASE + 200) {
            // Remove port
            int portIdx = static_cast<int>(cmdId - IDM_PORT_BASE - 100);
            doRemovePort(portIdx);
        }
        return 0;
    }

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;

    default:
        return DefWindowProcA(hWnd, msg, wParam, lParam);
    }
}

// ============================================================================
// Initialization
// ============================================================================

static bool initApp(HINSTANCE hInstance, bool startMinimized) {
    // Register window class
    WNDCLASSEXA wc = {};
    wc.cbSize        = sizeof(WNDCLASSEXA);
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = hInstance;
    wc.lpszClassName = APP_CLASS;
    wc.hIcon         = LoadIconA(hInstance, MAKEINTRESOURCEA(IDI_APPICON));
    if (!wc.hIcon) wc.hIcon = LoadIconA(nullptr, IDI_APPLICATION);

    if (!RegisterClassExA(&wc)) return false;

    // Create hidden window (message-only for tray)
    g_hWnd = CreateWindowExA(
        0, APP_CLASS, APP_NAME,
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 400, 300,
        nullptr, nullptr, hInstance, nullptr);

    if (!g_hWnd) return false;

    // Don't show the window — we're a tray-only app
    // (Could show a management window on double-click later)

    // Initialize tray icon
    vmidi::tray::init(g_hWnd, hInstance);

    // Initialize port manager
    if (!vmidi::ports::init()) {
        MessageBoxA(nullptr,
                    "Konnte Shared Memory nicht erstellen.\n"
                    "Laeuft die Anwendung bereits?",
                    "Virtual MIDI - Fehler", MB_OK | MB_ICONERROR);
        return false;
    }

    // Install driver if not yet done
    if (!vmidi::registry::isDriverInstalled()) {
        std::string slot = vmidi::registry::installDriver();
        if (slot.empty()) {
            MessageBoxA(nullptr,
                        "Konnte MIDI-Treiber nicht in der Registry registrieren.\n"
                        "Bitte als Administrator ausfuehren!",
                        "Virtual MIDI - Fehler", MB_OK | MB_ICONERROR);
            // Continue anyway — user might fix permissions later
        } else {
            char msg[128];
            snprintf(msg, sizeof(msg), "Treiber installiert in Slot: %s", slot.c_str());
            vmidi::tray::showBalloon("Virtual MIDI", msg);
        }
    }

    // Load saved port configuration
    vmidi::ports::loadFromConfig();

    // If no saved ports, create a default one
    if (vmidi::ports::getPortCount() == 0) {
        vmidi::ports::addPort("loopMIDI Port 1");
        g_nextPortNum = 2;
        vmidi::ports::saveToConfig();
    } else {
        g_nextPortNum = vmidi::ports::getPortCount() + 1;
    }

    updateTooltipText();

    vmidi::tray::showBalloon("Virtual MIDI",
        "Virtual MIDI laeuft. Rechtsklick auf das Tray-Icon fuer Optionen.");

    return true;
}

// ============================================================================
// Entry Point
// ============================================================================

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE /*hPrevInstance*/,
                   LPSTR lpCmdLine, int /*nCmdShow*/) {
    g_hInstance = hInstance;

    // Check for --minimized flag (autostart mode)
    bool startMinimized = (strstr(lpCmdLine, "--minimized") != nullptr);

    // Prevent multiple instances
    HANDLE hMutex = CreateMutexA(nullptr, TRUE, "VirtualMIDI_SingleInstance");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        MessageBoxA(nullptr, "Virtual MIDI laeuft bereits!", "Virtual MIDI",
                    MB_OK | MB_ICONINFORMATION);
        if (hMutex) CloseHandle(hMutex);
        return 0;
    }

    // Initialize COM and common controls
    InitCommonControls();

    if (!initApp(hInstance, startMinimized)) {
        if (hMutex) {
            ReleaseMutex(hMutex);
            CloseHandle(hMutex);
        }
        return 1;
    }

    // Message loop
    MSG msg;
    while (GetMessageA(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }

    // Cleanup
    vmidi::tray::shutdown();
    vmidi::ports::shutdown();

    if (hMutex) {
        ReleaseMutex(hMutex);
        CloseHandle(hMutex);
    }

    return static_cast<int>(msg.wParam);
}
