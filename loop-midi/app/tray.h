#pragma once
/*
 * tray.h — System tray icon and popup menu for the Virtual MIDI app.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace vmidi {
namespace tray {

// Initialize the tray icon. Call after creating the main window.
bool init(HWND hWnd, HINSTANCE hInstance);

// Remove the tray icon and cleanup.
void shutdown();

// Show the right-click context menu at the cursor position.
void showContextMenu(HWND hWnd);

// Update the tray tooltip text (e.g. port count info)
void updateTooltip(const char* text);

// Show a balloon notification
void showBalloon(const char* title, const char* text);

} // namespace tray
} // namespace vmidi
