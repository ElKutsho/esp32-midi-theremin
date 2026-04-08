#pragma once

// Icons
#define IDI_TRAYICON            100
#define IDI_APPICON             101

// Menu
#define IDM_TRAY_POPUP          200
#define IDM_ADD_PORT            201
#define IDM_REMOVE_PORT         202
#define IDM_AUTOSTART           203
#define IDM_ABOUT               204
#define IDM_EXIT                205
#define IDM_PORT_BASE           1000  // Port items: IDM_PORT_BASE + portIndex

// Dialog
#define IDD_ADDPORT             300
#define IDC_PORT_NAME_EDIT      301
#define IDC_PORT_LIST           302
#define IDC_BTN_ADD             303
#define IDC_BTN_REMOVE          304

// Strings
#define APP_NAME                "Virtual MIDI"
#define APP_CLASS               "VirtualMIDI_MainWnd"
#define WM_TRAYICON             (WM_USER + 1)
