/*
 * ESP32 MIDI Theremin – Ultra Clean & Fast Version
 * Ziel: Minimale Note-On Latency + stabile und genaue Aftertouch
 */

#include <NewPing.h>
#include <array>

// ─── Konfiguration ────────────────────────────────────────────────────────────
constexpr uint8_t NUM_SENSORS         = 6;
constexpr uint8_t MIN_DISTANCE_CM     = 2;
constexpr uint8_t MAX_DISTANCE_CM     = 18;   // Maximale Erkennungsdistanz (NewPing-Limit)

constexpr uint8_t POLL_ORDER[NUM_SENSORS] = {0, 3, 1, 4, 2, 5};

constexpr uint8_t DEFAULT_OCTAVE      = 4;
constexpr uint8_t MIN_OCTAVE          = 0;
constexpr uint8_t MAX_OCTAVE          = 8;

constexpr uint8_t DEBOUNCE_MS         = 40;
constexpr uint8_t NOTE_OFF_THRESHOLD  = 8;    // Fehlmessungen bis Note-Off (höher = stabiler)

// Pins
constexpr uint8_t trigPins[NUM_SENSORS] = {17, 19, 22, 25, 27, 16};
constexpr uint8_t echoPins[NUM_SENSORS] = {18, 21, 23, 26, 32,  4};

constexpr uint8_t BTN_OCTAVE_UP   = 14;
constexpr uint8_t BTN_OCTAVE_DOWN = 13;

// ─── Sensor Klasse ────────────────────────────────────────────────────────────
class ThereminSensor {
public:
    NewPing  sonar;
    bool     active    = false;
    uint8_t  lastSent  = 0;
    uint8_t  missCount = 0;

    ThereminSensor(uint8_t trig, uint8_t echo)
        : sonar(trig, echo, MAX_DISTANCE_CM) {}

    inline int fastPing()    { return sonar.ping_cm(); }

    // Median von 3 — filtert einzelne Crosstalk-Spikes, nur ~0.6ms extra
    int quickPing() {
        int a = sonar.ping_cm();
        delayMicroseconds(200);
        int b = sonar.ping_cm();
        delayMicroseconds(200);
        int c = sonar.ping_cm();
        // Median of 3
        if (a > b) std::swap(a, b);
        if (b > c) std::swap(b, c);
        if (a > b) std::swap(a, b);
        return b;
    }

    int accuratePing() {
        int v[5];
        for (uint8_t j = 0; j < 5; j++) {
            v[j] = sonar.ping_cm();
            if (j < 4) delayMicroseconds(300);
        }
        // Simple sort for median of 5
        for (uint8_t a = 0; a < 4; a++)
            for (uint8_t b = a + 1; b < 5; b++)
                if (v[a] > v[b]) std::swap(v[a], v[b]);
        return v[2];  // Median
    }
};

// ─── Globale Objekte ──────────────────────────────────────────────────────────
std::array<ThereminSensor, NUM_SENSORS> sensors = {
    ThereminSensor(trigPins[0], echoPins[0]),
    ThereminSensor(trigPins[1], echoPins[1]),
    ThereminSensor(trigPins[2], echoPins[2]),
    ThereminSensor(trigPins[3], echoPins[3]),
    ThereminSensor(trigPins[4], echoPins[4]),
    ThereminSensor(trigPins[5], echoPins[5])
};

int     currentOctave  = DEFAULT_OCTAVE;
uint8_t pollIndex      = 0;

// Button-Zustand
struct Button {
    uint8_t       pin;
    bool          lastState = HIGH;
    unsigned long lastTime  = 0;
};

Button btnUp   {BTN_OCTAVE_UP};
Button btnDown {BTN_OCTAVE_DOWN};

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
inline uint8_t distanceToVelocity(int cm) {
    return constrain(map(cm, MIN_DISTANCE_CM, MAX_DISTANCE_CM, 127, 8), 8, 127);
}

inline uint8_t distanceToAftertouch(int cm) {
    // Roh: nah = 127, weit = 0 — Kalibrierung passiert in der App
    return constrain(map(cm, MAX_DISTANCE_CM, MIN_DISTANCE_CM, 0, 127), 0, 127);
}

// ─── MIDI-Ausgabe (über Serial) ───────────────────────────────────────────────
inline void sendNoteOn(uint8_t sensorId, uint8_t value) {
    Serial.printf("S:%d:%d\n", sensorId, value);
}

inline void sendNoteOff(uint8_t sensorId) {
    Serial.printf("X:%d\n", sensorId);
}

inline void sendOctave(int octave) {
    Serial.printf("O:%d\n", octave);
}

void allSensorsOff() {
    for (uint8_t i = 0; i < NUM_SENSORS; ++i) {
        if (sensors[i].active) {
            sendNoteOff(i);
            sensors[i].active   = false;
            sensors[i].lastSent = 0;
            sensors[i].missCount = 0;
        }
    }
}

// ─── Taster Handling ──────────────────────────────────────────────────────────
void handleButtons() {
    unsigned long now = millis();

    bool stateUp = digitalRead(btnUp.pin);
    if (stateUp == LOW && btnUp.lastState == HIGH &&
        (now - btnUp.lastTime > DEBOUNCE_MS)) {
        btnUp.lastTime = now;
        if (currentOctave < MAX_OCTAVE) {
            allSensorsOff();
            currentOctave++;
            sendOctave(currentOctave);
        }
    }
    btnUp.lastState = stateUp;

    bool stateDown = digitalRead(btnDown.pin);
    if (stateDown == LOW && btnDown.lastState == HIGH &&
        (now - btnDown.lastTime > DEBOUNCE_MS)) {
        btnDown.lastTime = now;
        if (currentOctave > MIN_OCTAVE) {
            allSensorsOff();
            currentOctave--;
            sendOctave(currentOctave);
        }
    }
    btnDown.lastState = stateDown;
}

// ─── Sensor Polling (Round-Robin: 1 Sensor pro Loop) ─────────────────────────
void pollSensors() {
    uint8_t i = POLL_ORDER[pollIndex];
    pollIndex = (pollIndex + 1) % NUM_SENSORS;

    auto& s = sensors[i];
    int cm;

    if (!s.active) {
        cm = s.quickPing();

        if (cm >= MIN_DISTANCE_CM) {
            sendNoteOn(i, distanceToVelocity(cm));
            s.active   = true;
            s.lastSent = distanceToVelocity(cm);
            s.missCount = 0;
        }
    }
    else {
        cm = s.accuratePing();

        if (cm >= MIN_DISTANCE_CM) {
            s.missCount = 0;
            uint8_t aftertouch = distanceToAftertouch(cm);

            if (abs(aftertouch - s.lastSent) > 4) {
                sendNoteOn(i, aftertouch);
                s.lastSent = aftertouch;
            }
        }
        else if (++s.missCount >= NOTE_OFF_THRESHOLD) {
            sendNoteOff(i);
            s.active       = false;
            s.lastSent     = 0;
            s.missCount = 0;
        }
    }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
    delay(1500);
    Serial.begin(115200);
    Serial.setTxBufferSize(8192);

    pinMode(btnUp.pin,   INPUT_PULLUP);
    pinMode(btnDown.pin, INPUT_PULLUP);

    sendOctave(currentOctave);
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
    handleButtons();
    pollSensors();
}
