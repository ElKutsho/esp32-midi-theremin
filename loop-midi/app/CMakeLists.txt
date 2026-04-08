# app/CMakeLists.txt — Virtual MIDI Control Application

# Generate a minimal .ico file at configure time (a simple 16x16 blue square)
# This avoids needing an external icon file for the initial build.
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/generate_ico.py [=[
import struct, sys

def create_ico(path):
    """Create a minimal 16x16 32-bit ICO file (blue MIDI note icon)."""
    w, h = 16, 16
    pixels = bytearray()
    # Simple MIDI note pattern: blue background with white note symbol
    for y in range(h):
        for x in range(w):
            # Draw a simple filled circle (note head) in the center
            cx, cy = 8, 9
            dx, dy = x - cx, y - cy
            dist_sq = dx * dx + dy * dy
            # Note head (filled circle)
            if dist_sq <= 12:
                r, g, b, a = 255, 255, 255, 255
            # Note stem (vertical line)
            elif x == 12 and 2 <= y <= 9:
                r, g, b, a = 255, 255, 255, 255
            # Note flag
            elif x == 13 and 2 <= y <= 4:
                r, g, b, a = 255, 255, 255, 255
            else:
                # Dark blue background
                r, g, b, a = 40, 40, 120, 255
            pixels.extend([b, g, r, a])  # BGRA format

    # AND mask (all zeros = fully opaque)
    and_mask = bytes(h * ((w + 31) // 32 * 4))

    bmp_size = 40 + len(pixels) + len(and_mask)

    with open(path, 'wb') as f:
        # ICO header
        f.write(struct.pack('<HHH', 0, 1, 1))  # reserved, type=icon, count=1
        # ICO directory entry
        f.write(struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, bmp_size, 22))
        # BMP info header
        f.write(struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0,
                            len(pixels) + len(and_mask), 0, 0, 0, 0))
        f.write(pixels)
        f.write(and_mask)

create_ico(sys.argv[1])
print(f"Created icon: {sys.argv[1]}")
]=])

find_package(Python3 COMPONENTS Interpreter QUIET)

set(ICO_FILE "${CMAKE_CURRENT_SOURCE_DIR}/app.ico")
if(NOT EXISTS "${ICO_FILE}" AND Python3_FOUND)
    execute_process(
        COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_BINARY_DIR}/generate_ico.py "${ICO_FILE}"
        RESULT_VARIABLE ICO_RESULT
    )
    if(NOT ICO_RESULT EQUAL 0)
        message(WARNING "Could not generate app.ico — build may fail on resource compilation")
    endif()
elseif(NOT EXISTS "${ICO_FILE}")
    message(WARNING "app.ico not found and Python not available to generate it. "
                    "Resource compilation may fail. Create a 16x16 .ico manually.")
endif()

add_executable(VirtualMIDI WIN32
    main.cpp
    tray.cpp
    tray.h
    ports.cpp
    ports.h
    registry.cpp
    registry.h
    resource.h
    app.rc
)

target_include_directories(VirtualMIDI PRIVATE
    ${CMAKE_SOURCE_DIR}/shared
    ${CMAKE_SOURCE_DIR}/app
)

target_link_libraries(VirtualMIDI PRIVATE
    shell32
    comctl32
    user32
    advapi32
    winmm
)

# Use CMake's built-in UAC support + disable conflicting auto-manifest
set_target_properties(VirtualMIDI PROPERTIES
    OUTPUT_NAME "VirtualMIDI"
    VS_DPI_AWARE "ON"
)

# Request admin elevation via linker flags
target_link_options(VirtualMIDI PRIVATE
    "/MANIFESTUAC:level='requireAdministrator'"
)

# Make sure the DLL and EXE end up in the same directory
add_dependencies(VirtualMIDI vmidi)
