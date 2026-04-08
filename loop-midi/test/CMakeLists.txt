cmake_minimum_required(VERSION 3.20)
project(MidiTest LANGUAGES CXX)
add_executable(midi_list ../test_midi_list.cpp)
target_link_libraries(midi_list PRIVATE winmm advapi32)
