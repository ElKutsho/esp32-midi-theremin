/*
 * tray.cpp — System tray icon and context menu.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <cstdio>
#include <cstring>

#include "tray.h"
#include "resource.h"
#include "ports.h"
#include "registry.h"

namespace vmidi {
namespace tray {

static NOTIFYICONDATAA g_nid = {};
static HWND g_hWnd = nullptr;

bool init(HWND hWnd, HINSTANCE hInstance) {
    g_hWnd = hWnd;

    memset(&g_nid, 0, sizeof(g_nid));
    g_nid.cbSize = sizeof(NOTIFYICONDATAA);
    g_nid.hWnd   = hWnd;
    g_nid.uID    = IDI_TRAYICON;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon  = LoadIconA(hInstance, MAKEINTRESOURCEA(IDI_APPICON));

    // Fallback to default application icon
    if (!g_nid.hIcon) {
        g_nid.hIcon = LoadIconA(nullptr, IDI_APPLICATION);
    }

    strncpy(g_nid.szTip, "Virtual MIDI - 0 Ports", sizeof(g_nid.szTip) - 1);

    Shell_NotifyIconA(NIM_ADD, &g_nid);
    return true;
}

void shutdown() {
    Shell_NotifyIconA(NIM_DELETE, &g_nid);
    if (g_nid.hIcon) {
        DestroyIcon(g_nid.hIcon);
        g_nid.hIcon = nullptr;
    }
}

void showContextMenu(HWND hWnd) {
    HMENU hMenu = CreatePopupMenu();
    if (!hMenu) return;

    // --- Active ports ---
    auto portList = ports::getPorts();
    if (!portList.empty()) {
        for (size_t i = 0; i < portList.size(); i++) {
            char label[128];
            snprintf(label, sizeof(label), "%s  [In:%u Out:%u]",
                     portList[i].name.c_str(),
                     portList[i].inputOpenCount,
                     portList[i].outputOpenCount);
            AppendMenuA(hMenu, MF_STRING | MF_GRAYED,
                        IDM_PORT_BASE + static_cast<UINT>(i), label);
        }
        AppendMenuA(hMenu, MF_SEPARATOR, 0, nullptr);
    }

    // --- Actions ---
    AppendMenuA(hMenu, MF_STRING, IDM_ADD_PORT, "Port hinzufuegen (+)");

    if (!portList.empty()) {
        // Sub-menu for removing ports
        HMENU hRemoveMenu = CreatePopupMenu();
        for (size_t i = 0; i < portList.size(); i++) {
            AppendMenuA(hRemoveMenu, MF_STRING,
                        IDM_PORT_BASE + 100 + static_cast<UINT>(i),
                        portList[i].name.c_str());
        }
        AppendMenuA(hMenu, MF_POPUP, reinterpret_cast<UINT_PTR>(hRemoveMenu),
                     "Port entfernen (-)");
    }

    AppendMenuA(hMenu, MF_SEPARATOR, 0, nullptr);

    // Autostart toggle
    bool autostart = registry::isAutostartEnabled();
    AppendMenuA(hMenu, MF_STRING | (autostart ? MF_CHECKED : MF_UNCHECKED),
                IDM_AUTOSTART, "Autostart mit Windows");

    AppendMenuA(hMenu, MF_SEPARATOR, 0, nullptr);
    AppendMenuA(hMenu, MF_STRING, IDM_ABOUT, "Ueber Virtual MIDI...");
    AppendMenuA(hMenu, MF_STRING, IDM_EXIT, "Beenden");

    // Show menu at cursor
    POINT pt;
    GetCursorPos(&pt);
    SetForegroundWindow(hWnd);
    TrackPopupMenu(hMenu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hWnd, nullptr);
    PostMessageA(hWnd, WM_NULL, 0, 0); // recommended after TrackPopupMenu

    DestroyMenu(hMenu);
}

void updateTooltip(const char* text) {
    strncpy(g_nid.szTip, text, sizeof(g_nid.szTip) - 1);
    g_nid.szTip[sizeof(g_nid.szTip) - 1] = '\0';
    Shell_NotifyIconA(NIM_MODIFY, &g_nid);
}

void showBalloon(const char* title, const char* text) {
    g_nid.uFlags |= NIF_INFO;
    strncpy(g_nid.szInfoTitle, title, sizeof(g_nid.szInfoTitle) - 1);
    strncpy(g_nid.szInfo, text, sizeof(g_nid.szInfo) - 1);
    g_nid.dwInfoFlags = NIIF_INFO;
    Shell_NotifyIconA(NIM_MODIFY, &g_nid);
    g_nid.uFlags &= ~NIF_INFO;
}

} // namespace tray
} // namespace vmidi
