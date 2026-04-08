@echo off
:: ============================================================================
:: Virtual MIDI Driver — Deinstallation
:: Must be run as Administrator!
:: ============================================================================

echo ============================================
echo   Virtual MIDI Treiber Deinstallation
echo ============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo FEHLER: Bitte als Administrator ausfuehren!
    pause
    exit /b 1
)

echo [1/3] Virtuelles Geraet entfernen...
pnputil /remove-device "ROOT\VirtualMIDI\0000" 2>nul

echo [2/3] Treiber aus Driver Store entfernen...
:: Find and remove the driver package
for /f "tokens=1" %%i in ('pnputil /enum-drivers /class MEDIA 2^>nul ^| findstr /i "vmidi"') do (
    pnputil /delete-driver %%i /force 2>nul
)

echo [3/3] Test-Signing deaktivieren...
bcdedit /set testsigning off >nul 2>&1

echo.
echo Deinstallation abgeschlossen.
echo Ein Neustart ist erforderlich.
echo.
pause
