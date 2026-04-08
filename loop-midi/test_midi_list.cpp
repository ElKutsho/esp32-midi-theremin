/*
 * Quick test: List all MIDI ports visible to the Windows MIDI API (winmm).
 * Build: cl /EHsc test_midi_list.cpp winmm.lib
 */
#include <windows.h>
#include <mmsystem.h>
#include <cstdio>

#pragma comment(lib, "winmm.lib")

int main() {
    printf("=== MIDI OUTPUT DEVICES ===\n");
    UINT numOut = midiOutGetNumDevs();
    printf("Count: %u\n\n", numOut);
    for (UINT i = 0; i < numOut; i++) {
        MIDIOUTCAPSA caps = {};
        if (midiOutGetDevCapsA(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
            printf("  [%u] Name: \"%s\"\n", i, caps.szPname);
            printf("       MID: 0x%04X  PID: 0x%04X  Tech: %u\n",
                   caps.wMid, caps.wPid, caps.wTechnology);
        }
    }

    printf("\n=== MIDI INPUT DEVICES ===\n");
    UINT numIn = midiInGetNumDevs();
    printf("Count: %u\n\n", numIn);
    for (UINT i = 0; i < numIn; i++) {
        MIDIINCAPSA caps = {};
        if (midiInGetDevCapsA(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
            printf("  [%u] Name: \"%s\"\n", i, caps.szPname);
            printf("       MID: 0x%04X  PID: 0x%04X\n", caps.wMid, caps.wPid);
        }
    }

    printf("\n=== Drivers32 Registry Check ===\n");
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE,
        "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Drivers32",
        0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        for (int i = 0; i <= 9; i++) {
            char name[32];
            if (i == 0) snprintf(name, sizeof(name), "midi");
            else snprintf(name, sizeof(name), "midi%d", i);

            char data[MAX_PATH] = {};
            DWORD size = sizeof(data);
            DWORD type;
            if (RegQueryValueExA(hKey, name, NULL, &type, (BYTE*)data, &size) == ERROR_SUCCESS) {
                printf("  %s = %s\n", name, data);
            }
        }
        RegCloseKey(hKey);
    }

    return 0;
}
