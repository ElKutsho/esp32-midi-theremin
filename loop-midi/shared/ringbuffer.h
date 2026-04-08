#pragma once
/*
 * Lock-free Single-Producer Single-Consumer (SPSC) Ring Buffer
 * Used for passing MIDI data between output and input driver instances
 * across process boundaries via shared memory.
 */

#include <cstdint>
#include <cstring>
#include <atomic>

namespace vmidi {

// Each MIDI message in the ring buffer is prefixed with a small header
#pragma pack(push, 1)
struct MidiEvent {
    uint32_t timestamp;   // milliseconds (from timeGetTime)
    uint8_t  length;      // 1-3 for short messages, up to 255 for SysEx chunks
    uint8_t  data[4];     // short MIDI message (up to 3 bytes + padding)
};
#pragma pack(pop)

static constexpr uint32_t RING_BUFFER_SIZE = 4096; // number of MidiEvent slots

/*
 * Ring buffer stored in shared memory.
 * Producer (MIDI output) writes events, Consumer (MIDI input) reads them.
 * Both indices use relaxed atomics + acquire/release for correctness.
 */
struct alignas(64) RingBuffer {
    // Cache-line separated to avoid false sharing
    alignas(64) std::atomic<uint32_t> writePos;
    alignas(64) std::atomic<uint32_t> readPos;
    MidiEvent events[RING_BUFFER_SIZE];

    void init() {
        writePos.store(0, std::memory_order_relaxed);
        readPos.store(0, std::memory_order_relaxed);
        memset(events, 0, sizeof(events));
    }

    // --- Producer (output side) ---

    bool write(const MidiEvent& evt) {
        uint32_t wp = writePos.load(std::memory_order_relaxed);
        uint32_t nextWp = (wp + 1) % RING_BUFFER_SIZE;
        uint32_t rp = readPos.load(std::memory_order_acquire);

        if (nextWp == rp) {
            return false; // full
        }

        events[wp] = evt;
        writePos.store(nextWp, std::memory_order_release);
        return true;
    }

    // --- Consumer (input side) ---

    bool read(MidiEvent& out) {
        uint32_t rp = readPos.load(std::memory_order_relaxed);
        uint32_t wp = writePos.load(std::memory_order_acquire);

        if (rp == wp) {
            return false; // empty
        }

        out = events[rp];
        readPos.store((rp + 1) % RING_BUFFER_SIZE, std::memory_order_release);
        return true;
    }

    bool empty() const {
        return readPos.load(std::memory_order_acquire) ==
               writePos.load(std::memory_order_acquire);
    }
};

} // namespace vmidi
