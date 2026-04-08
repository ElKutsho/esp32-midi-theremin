# kdriver/CMakeLists.txt — Kernel-Mode Virtual MIDI Driver
#
# This builds a .sys file using MSVC with WDK headers and libraries.
# It's NOT a standard CMake kernel driver build (WDF/KMDF use MSBuild),
# but works for simple PortCls miniport drivers.

cmake_minimum_required(VERSION 3.20)
project(vmidi_km LANGUAGES CXX)

# WDK paths
set(WDK_ROOT "C:/Program Files (x86)/Windows Kits/10")
set(WDK_VERSION "10.0.26100.0")
set(WDK_INC "${WDK_ROOT}/Include/${WDK_VERSION}")
set(WDK_LIB "${WDK_ROOT}/Lib/${WDK_VERSION}")

# Kernel-mode compile definitions
add_definitions(
    -D_AMD64_
    -DAMD64
    -D_WIN64
    -DNTDDI_VERSION=0x0A00000C
    -D_NT_TARGET_VERSION_WIN10_RS5
    -DWINNT=1
    -DWINVER=0x0A00
    -D_WIN32_WINNT=0x0A00
    -DUNICODE
    -D_UNICODE
    -DPOOL_NX_OPTIN=1
    -DKERNEL_MODE
)

# Create the .sys as a shared library (DLL with .sys extension)
add_library(vmidi_km SHARED vmidi_km.cpp)

# Include directories
target_include_directories(vmidi_km PRIVATE
    "${WDK_INC}/km"
    "${WDK_INC}/km/crt"
    "${WDK_INC}/shared"
    "${WDK_INC}/um"
)

# Kernel-mode compiler flags
target_compile_options(vmidi_km PRIVATE
    /kernel
    /GS-           # No buffer security check (kernel mode)
    /Gy            # Function-level linking
    /W3
    /Zi
    /EHs-c-        # No exceptions
    /Zc:wchar_t
    /Zc:forScope
    /GR-           # No RTTI
)

# Linker flags for .sys
set_target_properties(vmidi_km PROPERTIES
    SUFFIX ".sys"
    PREFIX ""
    LINK_FLAGS "/DRIVER /SUBSYSTEM:NATIVE /ENTRY:DriverEntry /NODEFAULTLIB /MANIFEST:NO"
)

# Kernel libraries
target_link_libraries(vmidi_km PRIVATE
    "${WDK_LIB}/km/x64/ntoskrnl.lib"
    "${WDK_LIB}/km/x64/hal.lib"
    "${WDK_LIB}/km/x64/portcls.lib"
    "${WDK_LIB}/km/x64/ks.lib"
    "${WDK_LIB}/km/x64/wdm.lib"
    "${WDK_LIB}/km/x64/BufferOverflowK.lib"
    "${WDK_LIB}/km/x64/wdmsec.lib"
)

# Copy INF alongside .sys
add_custom_command(TARGET vmidi_km POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/vmidi.inf"
        "$<TARGET_FILE_DIR:vmidi_km>/vmidi.inf"
    COMMENT "Copying vmidi.inf to output directory"
)
