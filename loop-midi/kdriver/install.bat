@echo off
:: ============================================================================
:: Virtual MIDI Treiber — Installation
::
:: MUSS als Administrator ausgefuehrt werden!
:: Rechtsklick > "Als Administrator ausfuehren"
:: ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo   Virtual MIDI Treiber - Installation
echo  ============================================
echo.

:: Admin check
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FEHLER] Nicht als Administrator gestartet!
    echo.
    echo  Bitte: Rechtsklick auf install.bat
    echo         "Als Administrator ausfuehren"
    echo.
    pause
    exit /b 1
)

set SYS_FILE=%~dp0build\Release\vmidi_km.sys
set INF_FILE=%~dp0build\Release\vmidi.inf

if not exist "%SYS_FILE%" (
    echo  [FEHLER] vmidi_km.sys nicht gefunden!
    echo  Pfad: %SYS_FILE%
    pause
    exit /b 1
)

echo  [1/5] Test-Signing aktivieren...
bcdedit /set testsigning on
if %errorlevel% neq 0 (
    echo.
    echo  [!] Test-Signing konnte nicht aktiviert werden.
    echo  Wahrscheinlich ist Secure Boot aktiv.
    echo.
    echo  LOESUNG: Erweiterten Start nutzen:
    echo  1. Einstellungen ^> System ^> Wiederherstellung
    echo  2. "Erweiterter Start" ^> "Jetzt neu starten"
    echo  3. Problembehandlung ^> Erweiterte Optionen
    echo  4. Starteinstellungen ^> Neu starten
    echo  5. Taste 7: "Erzwingen der Treibersignatur deaktivieren"
    echo  6. Nach dem Neustart dieses Skript erneut ausfuehren
    echo.
    echo  ODER: Im BIOS Secure Boot deaktivieren.
    echo.
    choice /c JN /m "Trotzdem fortfahren? (J/N)"
    if !errorlevel! equ 2 exit /b 1
)

echo.
echo  [2/5] Selbstsigniertes Zertifikat erstellen...
powershell -ExecutionPolicy Bypass -Command ^
  "$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object {$_.Subject -like '*VirtualMIDI*'}; ^
   if (!$cert) { ^
     $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=VirtualMIDI Test' -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5); ^
     $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine'); ^
     $rootStore.Open('ReadWrite'); $rootStore.Add($cert); $rootStore.Close(); ^
     $pubStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPublisher','LocalMachine'); ^
     $pubStore.Open('ReadWrite'); $pubStore.Add($cert); $pubStore.Close(); ^
     Write-Host '  Zertifikat erstellt und installiert.' ^
   } else { ^
     Write-Host '  Zertifikat existiert bereits.' ^
   }"

echo.
echo  [3/5] Treiber signieren...
set SIGNTOOL=
for /f "delims=" %%i in ('where signtool.exe 2^>nul') do set SIGNTOOL=%%i
if "!SIGNTOOL!"=="" set SIGNTOOL=C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe
if exist "!SIGNTOOL!" (
    "!SIGNTOOL!" sign /a /s My /n "VirtualMIDI Test" /fd SHA256 "%SYS_FILE%" 2>nul
    if !errorlevel! equ 0 (
        echo  Treiber erfolgreich signiert.
    ) else (
        echo  [!] Signierung fehlgeschlagen - versuche ohne Zertifikat weiter...
    )
) else (
    echo  [!] signtool.exe nicht gefunden - ueberspringe Signierung
)

echo.
echo  [4/5] Treiber-Paket im Driver Store registrieren...
pnputil /add-driver "%INF_FILE%" /install
if %errorlevel% neq 0 (
    echo  [!] pnputil Installation - versuche manuell...
)

echo.
echo  [5/5] Virtuelles Geraet erstellen (ROOT\VirtualMIDI)...
:: Use devcon if available, otherwise use PowerShell with cfgmgr32
where devcon.exe >nul 2>&1
if %errorlevel% equ 0 (
    devcon install "%INF_FILE%" ROOT\VirtualMIDI
) else (
    :: Try using pnputil to scan for hardware changes
    powershell -ExecutionPolicy Bypass -Command ^
      "Add-Type @' ^
using System; ^
using System.Runtime.InteropServices; ^
public class DeviceHelper { ^
    [DllImport(\"cfgmgr32.dll\", CharSet=CharSet.Unicode)] ^
    public static extern int CM_Locate_DevNodeW(out int pdnDevInst, string pDeviceID, int ulFlags); ^
    [DllImport(\"cfgmgr32.dll\", CharSet=CharSet.Unicode)] ^
    public static extern int CM_Create_DevNodeW(out int pdnDevInst, string pDeviceID, int dnParent, int ulFlags); ^
} ^
'@; ^
      $root = 0; ^
      [DeviceHelper]::CM_Locate_DevNodeW([ref]$root, $null, 0) | Out-Null; ^
      $dev = 0; ^
      $result = [DeviceHelper]::CM_Create_DevNodeW([ref]$dev, 'ROOT\VirtualMIDI\0000', $root, 1); ^
      if ($result -eq 0) { Write-Host '  Geraet erstellt.' } ^
      elseif ($result -eq 0x00000028) { Write-Host '  Geraet existiert bereits.' } ^
      else { Write-Host ('  Ergebnis: 0x{0:X8}' -f $result) }"
)

echo.
echo  ============================================
echo   Installation abgeschlossen!
echo  ============================================
echo.
echo  NAECHSTE SCHRITTE:
echo  1. PC NEUSTARTEN (erforderlich!)
echo  2. Nach Neustart: ESP32 MIDI Bridge starten
echo  3. "Virtual MIDI Port" sollte als MIDI-Geraet sichtbar sein
echo.
echo  Hinweis: "Test Mode" Wasserzeichen in der Taskleiste
echo  ist normal (wegen Test-Signing fuer unsignierten Treiber).
echo.
pause
