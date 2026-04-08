# driver/CMakeLists.txt — Virtual MIDI Driver DLL

add_library(vmidi SHARED
    vmidi_driver.cpp
    vmidi.h
    vmidi.def
)

target_include_directories(vmidi PRIVATE
    ${CMAKE_SOURCE_DIR}/shared
    ${CMAKE_SOURCE_DIR}/driver
)

target_link_libraries(vmidi PRIVATE
    winmm
)

# Ensure the .def file is used for exports
set_target_properties(vmidi PROPERTIES
    OUTPUT_NAME "vmidi"
    PREFIX ""
    DEFINE_SYMBOL ""
)
