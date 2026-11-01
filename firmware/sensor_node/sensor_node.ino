/*
  H2KNOW - SENSOR NODE (Arduino Mega) -- v3
  v3 changes: new pump cycle, every 30 min (2 readings/hour). The intake hose is flushed BEFORE each reading, so
  the sample is fresh river water and not the water that sat in the 4.5 m hose since the last cycle:
    FLUSH IN (intake 20 s) -> FLUSH OUT (drain 15 s) -> FILL (intake 20 s) -> SETTLE 30 s -> READ -> SEND -> DRAIN (15 s)
  The two pumps never run together (short gap between pump states). Optional level-sensor guard against
  overflow (USE_LEVEL_SENSOR, OFF by default - confirm the FULL polarity on the bench first).
  The DATA frame (33 bytes, marker 0xB1) and the radio settings are unchanged, so the Controller Node
  needs NO change.

  v2 changes: turbidity is now clear-water calibrated. Clear water (measured 4.020 V = 822.5 raw ADC counts)
  maps to 0 NTU, scaling is done on RAW counts (so it does not depend on the 5 V rail value), and values
  below TURB_NOISE_FLOOR are reported as 0. Everything else is unchanged from v1.1.

  v1.1 changes: (1) reset flags with impossible bits set are reported as 0xFF = unknown (some bootloaders
  leave garbage there). (2) The supply voltage sent with each reading is now the LOWEST 5 V rail value seen
  while the pumps ran (sampled every 200 ms), so a pump-start sag shows up in the data. (3) Serial output now
  says why no boot cycle started and prints an [idle] line every 30 s with the current time.
  (This is the node that was called "Field Node" in the earlier v1-v7 sketches.)

  FLOW (matches the "Recommended Flow" chart)
  -------------------------------------------
  IDLE/SLEEP -> RTC slot (minute % CYCLE_MINUTES == 0)
    -> FLUSH IN -> FLUSH OUT -> FILL -> SETTLE -> READ (median of N samples; RAW ADC + calibrated value + quality flags)
    -> add reading to PERSISTENT queue (EEPROM, 4 slots, survives resets/power loss)
    -> TX DATA to Controller (reading + supply voltage + reset reason)
    -> listen for the ACK only during a short window, radio sleeps otherwise
    -> no ACK: retry up to MAX_TRIES with random backoff (jitter); later tries use more TX power
    -> still no ACK: reading stays in the EEPROM queue and goes out at the next slot
    -> DRAIN pump -> IDLE/SLEEP

  NEW in v1 vs the old Field Node v7
  - EEPROM queue (4 readings) instead of RAM. Wear-levelled across slots.
  - Median-of-15 sampling; raw ADC values are sent too, so calibration can be redone later.
  - Quality flags per reading (floating/saturated inputs, noisy input, bad temperature, bad RTC).
  - Supply voltage (Mega 5 V rail) and reset reason are sent with every reading.
  - Handshake removed. The radio sleeps except during the ACK window.
  - Retries: jittered backoff, TX power raised on later tries.
  - Optional: deep sleep woken by the DS3231 alarm (USE_RTC_ALARM_SLEEP) and hardware watchdog (USE_WATCHDOG).
  - Interrupted-cycle protection kept (drain first after a mid-cycle reset, stop after 3 in a row).

  Radio settings MUST match the Controller v1: 433 MHz, SF9, BW125k, CR4/5, sync 0x2B, CRC on.
  Note: SF is NOT changed on retries because the Controller listens on a single SF.
*/

#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <RTClib.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <EEPROM.h>
#include <stddef.h>
#include <avr/io.h>
#include <avr/wdt.h>
#include <avr/sleep.h>

// ---------- Capture the reset reason before anything clears it ----------
// (bit0 power-on, bit1 external reset, bit2 brown-out, bit3 watchdog. 0 = unknown: some bootloaders clear it)
uint8_t mcusrMirror __attribute__((section(".noinit")));
void captureMcusr(void) __attribute__((naked)) __attribute__((section(".init3")));
void captureMcusr(void) {
  mcusrMirror = MCUSR;
  MCUSR = 0;
  wdt_disable();
}

// ---------- LoRa ----------
#define LORA_NSS   53
#define LORA_RST   9
#define LORA_DIO0  2
#define LORA_FREQ  433E6
#define LORA_SF        9
#define LORA_BW        125E3
#define LORA_CR        5
#define LORA_SYNC      0x2B
#define LORA_TXPOWER        14      // dBm for the first tries
#define LORA_TXPOWER_RETRY  17      // dBm for later tries (more current: watch for supply dips)
#define TX_TIMEOUT_MS  1500UL

// ---------- Sensors / actuators ----------
#define DS18B20_PIN   6
#define TURBIDITY_PIN A0
#define PH_PIN        A1
#define TDS_PIN       A2
#define RELAY_INTAKE  7
#define RELAY_DRAIN   8
#define RELAY_ON  LOW      // active-LOW relay board
#define RELAY_OFF HIGH

// ---------- Schedule / pumps (ADJUST to your tank) ----------
#define CYCLE_MINUTES        30      // one cycle at every minute that is a multiple of this (:00 and :30)
#define RUN_ON_BOOT           1      // 1 = also run a cycle right after power-up (bench testing). Use 0 when deployed.
#define SET_RTC_FROM_COMPILE  0      // set to 1 ONCE (uses your PC clock = PH local time), flash, then back to 0 and flash again
#define RTC_AUTO_FIX          1      // 1 = on every upload/boot, if the RTC is behind the compile time (or lost power), set it from the PC clock. Safe to leave on.
#define RTC_UPLOAD_DELAY_S    15     // seconds between compiling and the board booting (compile -> upload -> reset), added when setting the RTC
#define CLEAR_QUEUE_ON_BOOT   1      // 1 = throw away old unsent readings (stale timestamps) at boot. Set to 0 after the first clean upload so real unsent data survives resets.

// Pump timings. CHECK on the bench:
//  - flush: intake flow x FLUSH_IN_MS should be at least 1 hose volume (7 mm x 4.5 m = about 173 mL), ideally 3 (about 520 mL)
//  - the drain pump x 15 s must empty what the intake pump put in during 20 s (drain flow >= 1.33 x intake flow),
//    otherwise water builds up in the container cycle after cycle
//  - intake flow x 20 s must be less than the container volume (no overflow)
#define FLUSH_IN_MS       30000UL    // intake pump: push fresh river water through the hose
#define FLUSH_OUT_MS      13000UL    // drain pump: empty the container (flush water is discarded)
#define FILL_MS           30000UL    // intake pump: sample water for the reading
#define SETTLE_MS         30000UL    // both pumps off
#define DRAIN_MS          13000UL    // drain pump: empty the container after the reading
#define PUMP_GAP_MS         500UL    // both pumps off for this long when switching from one pump to the other

// Optional non-contact level sensor (SEN0370 / XKC-Y26, signal on pin 5). OFF by default.
// When ON it stops an intake early as soon as the water reaches the sensor (overflow guard); the timers above stay as the limit.
// BENCH TEST FIRST: set USE_LEVEL_SENSOR to 1, watch the [level] value in the [idle] line with the tank empty and then
// full, and set LEVEL_FULL_STATE (HIGH or LOW) to the value you see when the tank is FULL.
#define USE_LEVEL_SENSOR      0
#define LEVEL_PIN             5
#define LEVEL_FULL_STATE   HIGH      // ASSUMPTION - confirm on the bench
#define LEVEL_DEBOUNCE_MS   300UL    // must read FULL this long before the intake is stopped (ignores splashes)

// ---------- Optional features (both OFF by default - read the notes) ----------
// Deep sleep between cycles. Needs the DS3231 SQW/INT pin wired to RTC_INT_PIN (Mega pin 3).
// With sleep ON, unsent readings are retried at the next slot only. NOT tested on hardware.
#define USE_RTC_ALARM_SLEEP   0
#define RTC_INT_PIN           3
// Hardware watchdog (8 s). ONLY enable if your Mega runs Optiboot. The stock Mega2560 bootloader (many
// clones) can get stuck in a reset loop after a watchdog reset and then needs an ISP programmer to fix.
#define USE_WATCHDOG          0

// ---------- Delivery ----------
#define ACK_WINDOW_MS      3000UL    // listen this long after each TX, then sleep the radio
#define MAX_TRIES             6      // total transmissions per reading per cycle
#define TRIES_AT_NORMAL_POWER 2      // tries 1..2 at LORA_TXPOWER, later ones at LORA_TXPOWER_RETRY
#define BACKOFF_MIN_MS      800UL    // random wait between tries
#define BACKOFF_MAX_MS     3500UL
#define SEND_GAP_MS         800UL    // pause between queued readings

// ---------- Sampling / quality ----------
#define SAMPLES              15      // median of this many ADC samples per channel
#define SAMPLE_DELAY_MS      10
#define NOISY_SPREAD         60      // (max-min) in ADC counts above this => FLAG_NOISY
#define TEMP_SENTINEL    -999.0

// ---------- Calibration (PLACEHOLDERS - calibrate with real solutions!) ----------
#define PH_SLOPE   -5.5334f      // pH = PH_SLOPE * volts + PH_OFFSET. Do a 2-point calibration (e.g. pH 4.01 and 6.86)
#define PH_OFFSET  15.8846f

// Turbidity clear-water calibration (clear water = 0 NTU). Re-measure if the sensor or container changes.
#define TURB_CLEAR_RAW    571.9f   // raw ADC in clear water, new board + 26 in cable (= 2.795 V on a 5.0 V reference). Old board, 14 in cable: 822.5
#define TURB_GAIN         1.000f   // NTU scale factor from a known-turbidity second point (1.000 = clear-water point only)
#define TURB_ZERO_V       4.20f    // DFRobot curve reaches 0 NTU at about 4.2 V
#define TURB_NOISE_FLOOR  30.0f    // anything below this is reported as 0 NTU

// TDS: DFRobot Gravity TDS curve with temperature compensation. Verify against a known reference.
// Turbidity: DFRobot SEN0189 curve (valid ~2.5-4.2 V), now clear-water calibrated (see above).

// ---------- Protocol ----------
#define START_BYTE        0x7E
#define ADDR_SENSOR       0x01
#define ADDR_CONTROLLER   0x02
#define MSG_DATA          0x03
#define MSG_DATA_ACK      0x04
#define DATA_MARKER       0xB1
#define PAYLOAD_LEN       33
/*
  DATA payload (33 bytes):
   [0]      marker 0xB1
   [1..6]   year-2000, month, day, hour, minute, second (RTC, local time)
   [7..22]  4 floats: temperature C, pH, turbidity NTU, TDS ppm
   [23..28] 3 x uint16: raw ADC turbidity (A0), raw ADC pH (A1), raw ADC TDS (A2)
   [29..30] uint16: supply voltage in mV (Mega 5 V rail)
   [31]     reset flags (MCUSR)
   [32]     quality flags
*/
#define FLAG_TEMP_BAD    0x01
#define FLAG_PH_SUSPECT  0x02
#define FLAG_TURB_SUSPECT 0x04
#define FLAG_TDS_SUSPECT 0x08
#define FLAG_RTC_BAD     0x10
#define FLAG_NOISY       0x20

// ---------- EEPROM layout ----------
#define EE_FLAGRING         2      // 16 rotating "cycle in progress" cells (spreads EEPROM wear)
#define EE_FLAGRING_LEN    16
#define EE_COUNT           18      // consecutive interrupted cycles
#define EE_Q_BASE          32      // queue slots start here
#define QUEUE_SLOTS         4
#define Q_VALID          0xA5
#define CYCLE_ACTIVE_MAGIC 0xA7
#define MAX_INTERRUPTED     3

struct __attribute__((packed)) Pending {
  uint8_t  valid;
  uint16_t order;
  uint8_t  seq;
  uint8_t  len;
  uint8_t  data[PAYLOAD_LEN];
};

RTC_DS3231 rtc;
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

enum State { ST_IDLE, ST_FLUSH_IN, ST_FLUSH_OUT, ST_FILL, ST_SETTLE, ST_SEND, ST_AWAIT_ACK, ST_BACKOFF, ST_DRAIN };
State state = ST_IDLE;
unsigned long stateStart = 0;

Pending cur;
int8_t  curSlot = -1;
uint8_t tries = 0;
bool dataAcked = false;
unsigned long ackWaitStart = 0;
unsigned long backoffUntil = 0;
unsigned long nextSendAt = 0;
uint8_t seqCounter = 0;
uint16_t orderCounter = 0;
uint8_t nextSlot = 0;
uint8_t flagPos = 0;
uint32_t lastSlot = 0xFFFFFFFFUL;
uint16_t minSupplyMv = 65535;          // lowest 5 V rail value seen while the pumps ran
unsigned long lastSupplySample = 0;
unsigned long lastIdlePrint = 0;
uint8_t resetFlagsReport = 0xFF;       // MCUSR as reported to the Controller (0xFF = unknown)

// =====================================================================
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(A5) ^ micros());          // A5 is unused (floating) = free entropy
  Wire.begin();
  Wire.setWireTimeout(25000, true);

  if (!rtc.begin()) Serial.println(F("RTC not found!"));
  else {
    DateTime compiled(F(__DATE__), F(__TIME__));                 // PC clock at compile time (must be PH local time)
    bool lost  = rtc.lostPower();
    bool behind = rtc.now().unixtime() < compiled.unixtime();    // RTC older than the moment this code was built = wrong
    if (SET_RTC_FROM_COMPILE || (RTC_AUTO_FIX && (lost || behind))) {
      rtc.adjust(compiled + TimeSpan(RTC_UPLOAD_DELAY_S));
      Serial.print(F("RTC was wrong/stale -> set from compile time. "));
      Serial.println(SET_RTC_FROM_COMPILE ? F("(forced)") : (lost ? F("(lost power)") : F("(behind compile time)")));
    } else if (lost) {
      Serial.println(F("WARNING: RTC lost power - time is NOT valid. Replace the RTC battery and set the time."));
    }
  }

  ds18b20.begin();

  pinMode(RELAY_INTAKE, OUTPUT);
  pinMode(RELAY_DRAIN, OUTPUT);
  relaysOff();
#if USE_LEVEL_SENSOR
  pinMode(LEVEL_PIN, INPUT);
#endif

  queueInit();
#if CLEAR_QUEUE_ON_BOOT
  for (uint8_t i = 0; i < QUEUE_SLOTS; i++) queuePop(i);         // drop stale readings left from earlier tests
  queueInit();
  Serial.println(F("Old queued readings cleared."));
#endif

  pinMode(LORA_NSS, OUTPUT);
  digitalWrite(LORA_NSS, HIGH);
  SPI.begin();
  while (!radioInit()) {
    Serial.println(F("LoRa init failed, retrying..."));
    delay(500);
  }
  LoRa.sleep();

  Serial.print(F("Sensor Node v3 ready. RTC: "));
  printTime(rtc.now());
  Serial.print(F("Cycle every ")); Serial.print(CYCLE_MINUTES);
  resetFlagsReport = (mcusrMirror & 0xE0) ? 0xFF : mcusrMirror;   // bits 5-7 do not exist => value is garbage
  Serial.print(F(" min. Reset flags=0x")); Serial.print(resetFlagsReport, HEX);
  if (resetFlagsReport == 0xFF) Serial.print(F(" (unknown)"));
  Serial.print(F(" Supply=")); Serial.print(readVccMv()); Serial.println(F(" mV"));
  Serial.print(F("Queued readings from before: ")); Serial.println(queueCount());

  // ---- interrupted-cycle protection ----
  bool interrupted = anyCycleFlag();
  uint8_t cnt = EEPROM.read(EE_COUNT);
  if (cnt > 10) cnt = 0;                          // fresh EEPROM reads 0xFF
  if (interrupted) {
    cnt++;
    EEPROM.update(EE_COUNT, cnt);
    clearCycleFlags();
    flagPos = 0;
    Serial.print(F("!! Previous cycle was INTERRUPTED by a reset (in a row: ")); Serial.print(cnt); Serial.println(F(")"));
    if (cnt >= MAX_INTERRUPTED) {
      Serial.println(F("!! FAULT: too many interrupted cycles. Pumps stay OFF until the next scheduled slot. Check pump power."));
      state = ST_IDLE;
    } else {
      Serial.println(F("Draining the tank first, then idling until the next slot."));
      delay(3000);
      state = ST_DRAIN;
      stateStart = millis();
    }
  } else if (RUN_ON_BOOT && cnt == 0) {
    startCycle();
  } else if (RUN_ON_BOOT) {
    Serial.print(F("Boot cycle SKIPPED: interrupted-cycle counter is "));
    Serial.print(cnt);
    Serial.println(F(". Waiting for the next scheduled slot."));
  } else {
    Serial.println(F("RUN_ON_BOOT is 0: waiting for the next scheduled slot."));
  }

#if USE_WATCHDOG
  wdt_enable(WDTO_8S);
#endif
}

void loop() {
#if USE_WATCHDOG
  wdt_reset();
#endif

  switch (state) {
    case ST_IDLE:
      relaysOff();
      if (slotDue(USE_RTC_ALARM_SLEEP != 0)) {
        startCycle();
      }
#if USE_RTC_ALARM_SLEEP
      else {
        sleepUntilNextSlot();
      }
#else
      else if (millis() - lastIdlePrint > 30000UL) {
        lastIdlePrint = millis();
        Serial.print(F("[idle] waiting for a slot (minute % "));
        Serial.print(CYCLE_MINUTES);
        Serial.print(F(" == 0). Now: "));
        printTime(rtc.now());
#if USE_LEVEL_SENSOR
        Serial.print(F("[level] pin ")); Serial.print(LEVEL_PIN);
        Serial.print(F(" = ")); Serial.println(digitalRead(LEVEL_PIN) == HIGH ? F("HIGH") : F("LOW"));
#endif
      }
#endif
      break;

    case ST_FLUSH_IN:                            // push fresh river water through the hose (the container is drained next)
      digitalWrite(RELAY_DRAIN, RELAY_OFF);
      digitalWrite(RELAY_INTAKE, RELAY_ON);
      sampleSupply();
      if (millis() - stateStart >= FLUSH_IN_MS || levelFull()) {
        relaysOff();
        if (millis() - stateStart < FLUSH_IN_MS) Serial.println(F("Level sensor FULL - flush-in stopped early"));
        Serial.println(F("Flush-in done, flushing out..."));
        delay(PUMP_GAP_MS);                      // never switch straight from one pump to the other
        state = ST_FLUSH_OUT;
        stateStart = millis();
      }
      break;

    case ST_FLUSH_OUT:                           // empty the container; the flush water is discarded
      digitalWrite(RELAY_INTAKE, RELAY_OFF);
      digitalWrite(RELAY_DRAIN, RELAY_ON);
      sampleSupply();
      if (millis() - stateStart >= FLUSH_OUT_MS) {
        relaysOff();
        Serial.println(F("Flush-out done, filling for the reading..."));
        delay(PUMP_GAP_MS);
        state = ST_FILL;
        stateStart = millis();
      }
      break;

    case ST_FILL:                                // the water that will actually be measured
      digitalWrite(RELAY_DRAIN, RELAY_OFF);
      digitalWrite(RELAY_INTAKE, RELAY_ON);
      sampleSupply();
      if (millis() - stateStart >= FILL_MS || levelFull()) {
        relaysOff();
        if (millis() - stateStart < FILL_MS) Serial.println(F("Level sensor FULL - fill stopped early"));
        Serial.println(F("Fill done, settling..."));
        state = ST_SETTLE;
        stateStart = millis();
      }
      break;

    case ST_SETTLE:
      relaysOff();
      if (millis() - stateStart >= SETTLE_MS) {
        readAndQueue();
        nextSendAt = 0;
        state = ST_SEND;
      }
      break;

    case ST_SEND:
      relaysOff();                               // radio never transmits while a pump runs
      if (millis() < nextSendAt) break;
      curSlot = oldestSlot();
      if (curSlot < 0) { finishSend(); break; }  // nothing (left) to send
      EEPROM.get(slotAddr(curSlot), cur);
      tries = 0;
      doTransmit();
      break;

    case ST_AWAIT_ACK:
      handleIncoming();                          // radio only listens during this window
      if (dataAcked) {
        Serial.println(F("Controller ACKed - reading delivered"));
        queuePop(curSlot);
        dataAcked = false;
        LoRa.sleep();
        nextSendAt = millis() + SEND_GAP_MS;
        state = ST_SEND;
      } else if (millis() - ackWaitStart >= ACK_WINDOW_MS) {
        LoRa.sleep();
        if (tries < MAX_TRIES) {
          backoffUntil = millis() + (unsigned long)random(BACKOFF_MIN_MS, BACKOFF_MAX_MS + 1);
          state = ST_BACKOFF;
        } else {
          Serial.println(F("No ACK after all tries - reading stays queued (EEPROM), retried at the next slot"));
          finishSend();
        }
      }
      break;

    case ST_BACKOFF:
      if (millis() >= backoffUntil) doTransmit();
      break;

    case ST_DRAIN:
      digitalWrite(RELAY_INTAKE, RELAY_OFF);
      digitalWrite(RELAY_DRAIN, RELAY_ON);
      sampleSupply();
      if (millis() - stateStart >= DRAIN_MS) {
        relaysOff();
        Serial.println(F("Drain done. Cycle complete."));
        cycleFinished();
        state = ST_IDLE;
      }
      break;
  }
}

// =====================================================================
// Scheduling / state helpers
// =====================================================================
void relaysOff() {
  digitalWrite(RELAY_INTAKE, RELAY_OFF);
  digitalWrite(RELAY_DRAIN, RELAY_OFF);
}

// true when the level sensor has read FULL continuously for LEVEL_DEBOUNCE_MS (always false when the guard is OFF)
#if USE_LEVEL_SENSOR
unsigned long levelFullSince = 0;
bool levelFull() {
  if (digitalRead(LEVEL_PIN) == LEVEL_FULL_STATE) {
    if (levelFullSince == 0) levelFullSince = millis();
    return (millis() - levelFullSince) >= LEVEL_DEBOUNCE_MS;
  }
  levelFullSince = 0;
  return false;
}
#else
bool levelFull() { return false; }
#endif

void print2(int v) {
  if (v < 10) Serial.print('0');
  Serial.print(v);
}

void printTime(DateTime n) {
  Serial.print(n.year()); Serial.print('-');
  print2(n.month());  Serial.print('-');
  print2(n.day());    Serial.print(' ');
  print2(n.hour());   Serial.print(':');
  print2(n.minute()); Serial.print(':');
  print2(n.second()); Serial.println();
}

// true once per scheduled slot (minute % CYCLE_MINUTES == 0)
bool slotDue(bool noLimit) {
  static unsigned long lastCheck = 0;
  if (!noLimit && millis() - lastCheck < 1000) return false;
  lastCheck = millis();

  DateTime n = rtc.now();
  if (n.minute() % CYCLE_MINUTES != 0) return false;
  uint32_t slot = (uint32_t)n.day() * 1440UL + (uint32_t)n.hour() * 60UL + n.minute();
  if (slot == lastSlot) return false;
  lastSlot = slot;
  return true;
}

void startCycle() {
  DateTime n0 = rtc.now();
  Serial.print(F("=== CYCLE START at ")); printTime(n0);
  lastSlot = (uint32_t)n0.day() * 1440UL + (uint32_t)n0.hour() * 60UL + n0.minute();   // no second cycle in this minute
  EEPROM.update(EE_FLAGRING + flagPos, CYCLE_ACTIVE_MAGIC);                            // cleared when the drain completes
  state = ST_FLUSH_IN;
  stateStart = millis();
}

void cycleFinished() {
  EEPROM.update(EE_FLAGRING + flagPos, 0);
  flagPos = (flagPos + 1) % EE_FLAGRING_LEN;
  EEPROM.update(EE_COUNT, 0);
}

void finishSend() {
  LoRa.sleep();
  Serial.println(F("Starting drain"));
  state = ST_DRAIN;
  stateStart = millis();
}

#if USE_RTC_ALARM_SLEEP
void wakeISR() { }                               // level interrupt only needs to wake the CPU

void sleepUntilNextSlot() {
  DateTime n = rtc.now();
  uint8_t nextMin = ((n.minute() / CYCLE_MINUTES) + 1) * CYCLE_MINUTES;
  DateTime at;
  if (nextMin >= 60) at = DateTime(n.year(), n.month(), n.day(), n.hour(), 0, 0) + TimeSpan(0, 1, 0, 0);
  else               at = DateTime(n.year(), n.month(), n.day(), n.hour(), nextMin, 0);
  if ((long)(at.unixtime() - n.unixtime()) < 3) return;          // too close: stay awake and poll instead

  rtc.writeSqwPinMode(DS3231_OFF);               // INT/SQW pin acts as alarm output
  rtc.clearAlarm(1);
  rtc.setAlarm1(at, DS3231_A1_Minute);           // fires when minute + second match
  pinMode(RTC_INT_PIN, INPUT_PULLUP);

  Serial.print(F("Sleeping until ")); printTime(at);
  Serial.flush();
#if USE_WATCHDOG
  wdt_disable();
#endif
  set_sleep_mode(SLEEP_MODE_PWR_DOWN);
  noInterrupts();
  sleep_enable();
  attachInterrupt(digitalPinToInterrupt(RTC_INT_PIN), wakeISR, LOW);
  interrupts();
  sleep_cpu();
  sleep_disable();
  detachInterrupt(digitalPinToInterrupt(RTC_INT_PIN));
  rtc.clearAlarm(1);
#if USE_WATCHDOG
  wdt_enable(WDTO_8S);
#endif
}
#endif

// =====================================================================
// Persistent queue (EEPROM). Slot is valid when its first byte == Q_VALID. The valid marker is written
// LAST, so a power cut in the middle of a write never leaves a half-written reading looking valid.
// =====================================================================
int slotAddr(uint8_t i) { return EE_Q_BASE + (int)i * (int)sizeof(Pending); }

bool slotValid(uint8_t i) { return EEPROM.read(slotAddr(i)) == Q_VALID; }

uint8_t queueCount() {
  uint8_t c = 0;
  for (uint8_t i = 0; i < QUEUE_SLOTS; i++) if (slotValid(i)) c++;
  return c;
}

int8_t oldestSlot() {
  int8_t best = -1;
  uint16_t bestOrder = 0;
  for (uint8_t i = 0; i < QUEUE_SLOTS; i++) {
    if (!slotValid(i)) continue;
    uint16_t o;
    EEPROM.get(slotAddr(i) + (int)offsetof(Pending, order), o);
    if (best < 0 || (int16_t)(o - bestOrder) < 0) { best = i; bestOrder = o; }
  }
  return best;
}

void queueInit() {
  uint16_t maxOrder = 0;
  bool any = false;
  for (uint8_t i = 0; i < QUEUE_SLOTS; i++) {
    if (!slotValid(i)) continue;
    uint16_t o;
    EEPROM.get(slotAddr(i) + (int)offsetof(Pending, order), o);
    if (!any || (int16_t)(o - maxOrder) > 0) maxOrder = o;
    any = true;
  }
  orderCounter = any ? (uint16_t)(maxOrder + 1) : 0;
}

void queuePush(const uint8_t *data, uint8_t len, uint8_t seq) {
  int8_t slot = -1;
  for (uint8_t k = 0; k < QUEUE_SLOTS; k++) {
    uint8_t i = (nextSlot + k) % QUEUE_SLOTS;
    if (!slotValid(i)) { slot = i; break; }
  }
  if (slot < 0) {
    Serial.println(F("Queue full - dropping the oldest reading"));
    slot = oldestSlot();
  }
  Pending p;
  memset(&p, 0, sizeof(p));
  p.valid = 0;                                   // not valid until completely written
  p.order = orderCounter++;
  p.seq = seq;
  p.len = len;
  memcpy(p.data, data, len);
  EEPROM.put(slotAddr(slot), p);
  EEPROM.update(slotAddr(slot), Q_VALID);        // marker last
  nextSlot = (slot + 1) % QUEUE_SLOTS;
}

void queuePop(int8_t slot) {
  if (slot < 0) return;
  EEPROM.update(slotAddr(slot), 0);
}

// ---- interrupted-cycle flag ring ----
bool anyCycleFlag() {
  for (uint8_t i = 0; i < EE_FLAGRING_LEN; i++)
    if (EEPROM.read(EE_FLAGRING + i) == CYCLE_ACTIVE_MAGIC) return true;
  return false;
}

void clearCycleFlags() {
  for (uint8_t i = 0; i < EE_FLAGRING_LEN; i++) EEPROM.update(EE_FLAGRING + i, 0);
}

// =====================================================================
// Radio (direct register control with timeout; verified on this hardware)
// =====================================================================
uint8_t calcChecksum(uint8_t *buf, uint8_t len) {
  uint8_t cs = 0;
  for (uint8_t i = 0; i < len; i++) cs ^= buf[i];
  return cs;
}

uint8_t nextSeq() { return seqCounter++; }

uint8_t loraReadReg(uint8_t addr) {
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_NSS, LOW);
  SPI.transfer(addr & 0x7F);
  uint8_t v = SPI.transfer(0x00);
  digitalWrite(LORA_NSS, HIGH);
  SPI.endTransaction();
  return v;
}

void loraWriteReg(uint8_t addr, uint8_t val) {
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_NSS, LOW);
  SPI.transfer(addr | 0x80);
  SPI.transfer(val);
  digitalWrite(LORA_NSS, HIGH);
  SPI.endTransaction();
}

bool radioInit() {
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) return false;      // begin() pulses the RST pin = full chip reset
  LoRa.setSPIFrequency(1000000);
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNC);
  LoRa.enableCrc();
  LoRa.setTxPower(LORA_TXPOWER);
  LoRa.idle();
  return true;
}

void radioReinit() {
  LoRa.sleep();
  delay(20);
  if (!radioInit()) Serial.println(F("  !! Radio re-init FAILED (check RA-02 power)"));
}

void ensureRadioAlive() {
  uint8_t op  = loraReadReg(0x01);
  uint8_t ver = loraReadReg(0x42);
  if ((op & 0x80) == 0 || ver != 0x12) {
    Serial.print(F("  !! Radio unhealthy: OpMode=0x")); Serial.print(op, HEX);
    Serial.print(F(" Ver=0x")); Serial.println(ver, HEX);
    radioReinit();
  }
}

void sendPacket(uint8_t dest, uint8_t msgType, uint8_t seq, uint8_t *payload, uint8_t payloadLen) {
  uint8_t buf[64];
  uint8_t idx = 0;
  buf[idx++] = dest;
  buf[idx++] = ADDR_SENSOR;
  buf[idx++] = msgType;
  buf[idx++] = seq;
  buf[idx++] = payloadLen;
  for (uint8_t i = 0; i < payloadLen; i++) buf[idx++] = payload[i];
  uint8_t cs = calcChecksum(buf, idx);

  ensureRadioAlive();
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.write(START_BYTE);
  LoRa.write(buf, idx);
  LoRa.write(cs);

  loraWriteReg(0x12, 0xFF);                      // clear IRQ flags
  unsigned long t0 = millis();
  loraWriteReg(0x01, 0x83);                      // LoRa mode + TX
  while (!(loraReadReg(0x12) & 0x08) && (millis() - t0) < TX_TIMEOUT_MS) { }
  bool done = loraReadReg(0x12) & 0x08;
  unsigned long ms = millis() - t0;
  loraWriteReg(0x12, 0xFF);

  Serial.print(F("  TX type=0x")); Serial.print(msgType, HEX);
  Serial.print(F(" seq=")); Serial.print(seq);
  Serial.print(F(" bytes=")); Serial.print(idx + 2);
  if (done) { Serial.print(F(" airtime(ms)=")); Serial.println(ms); }
  else { Serial.println(F(" !! TX TIMEOUT")); radioReinit(); }
  LoRa.receive();                                // listen for the ACK
}

void doTransmit() {
  tries++;
  radioReinit();                                 // fresh radio config before every data send
  LoRa.setTxPower(tries > TRIES_AT_NORMAL_POWER ? LORA_TXPOWER_RETRY : LORA_TXPOWER);
  Serial.print(F("TX attempt ")); Serial.print(tries); Serial.print(F("/")); Serial.println(MAX_TRIES);
  sendPacket(ADDR_CONTROLLER, MSG_DATA, cur.seq, cur.data, cur.len);
  ackWaitStart = millis();
  dataAcked = false;
  state = ST_AWAIT_ACK;
}

void handleIncoming() {
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;

  uint8_t buf[64];
  uint8_t idx = 0;
  while (LoRa.available() && idx < sizeof(buf)) buf[idx++] = LoRa.read();

  Serial.print(F("  RX len=")); Serial.print(idx);
  Serial.print(F(" RSSI=")); Serial.println(LoRa.packetRssi());

  if (idx < 7) return;
  if (buf[0] != START_BYTE) return;

  uint8_t dest    = buf[1];
  uint8_t msgType = buf[3];
  uint8_t len     = buf[5];

  if (idx < (uint16_t)(6 + len + 1)) { Serial.println(F("Frame length mismatch, dropping")); return; }

  uint8_t *payload = &buf[6];
  uint8_t recvCs = buf[idx - 1];
  if (calcChecksum(&buf[1], idx - 2) != recvCs) { Serial.println(F("Checksum mismatch, dropping")); return; }
  if (dest != ADDR_SENSOR) return;

  if (msgType == MSG_DATA_ACK && state == ST_AWAIT_ACK && len >= 1 && payload[0] == cur.seq) {
    dataAcked = true;
  }
}

// =====================================================================
// Sensors
// =====================================================================
// Mega 5 V rail in mV, measured against the internal 1.1 V reference. Also the ADC reference voltage.
uint16_t readVccMv() {
  ADMUX = _BV(REFS0) | _BV(MUX4) | _BV(MUX3) | _BV(MUX2) | _BV(MUX1);
  ADCSRB &= ~_BV(MUX5);
  delay(3);
  ADCSRA |= _BV(ADSC);
  while (bit_is_set(ADCSRA, ADSC)) { }
  uint16_t raw = ADC;
  if (raw == 0) return 0;
  return (uint16_t)(1125300UL / raw);
}

void sampleSupply() {
  if (millis() - lastSupplySample < 200) return;
  lastSupplySample = millis();
  uint16_t v = readVccMv();
  if (v > 3000 && v < minSupplyMv) minSupplyMv = v;
}

int readAnalogMedian(uint8_t pin, uint16_t *spread) {
  int s[SAMPLES];
  analogRead(pin);                               // discard first sample after the mux switch
  delay(2);
  for (uint8_t i = 0; i < SAMPLES; i++) { s[i] = analogRead(pin); delay(SAMPLE_DELAY_MS); }
  for (uint8_t i = 1; i < SAMPLES; i++) {        // insertion sort
    int v = s[i];
    int j = i - 1;
    while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; j--; }
    s[j + 1] = v;
  }
  *spread = (uint16_t)(s[SAMPLES - 1] - s[0]);
  return s[SAMPLES / 2];
}

float calcPh(int raw, float vref) {
  float v = raw * vref / 1023.0f;
  return PH_SLOPE * v + PH_OFFSET;
}

float calcTurbidity(int raw, float vref) {       // DFRobot SEN0189 curve, clear-water calibrated
  (void)vref;                                    // not needed: scaling is done on raw counts
  float vc = TURB_ZERO_V * (float)raw / TURB_CLEAR_RAW;   // clear water maps to 4.20 V (0 NTU)
  if (vc >= 4.2f) return 0.0f;
  if (vc < 2.5f)  return 3000.0f;
  float ntu = (-1120.4f * vc * vc + 5742.3f * vc - 4352.9f) * TURB_GAIN;
  if (ntu < TURB_NOISE_FLOOR) ntu = 0.0f;
  if (ntu > 3000.0f) ntu = 3000.0f;
  return ntu;
}

float calcTds(int raw, float vref, float tempC) { // DFRobot Gravity TDS curve + temperature compensation
  float v = raw * vref / 1023.0f;
  float comp = 1.0f + 0.02f * (tempC - 25.0f);
  float cv = v / comp;
  float tds = (133.42f * cv * cv * cv - 255.86f * cv * cv + 857.39f * cv) * 0.5f;
  return tds < 0 ? 0 : tds;
}

void readAndQueue() {
  DateTime now = rtc.now();
  uint8_t flags = 0;
  if (rtc.lostPower() || now.year() < 2024) flags |= FLAG_RTC_BAD;

  uint16_t vccNow = readVccMv();
  uint16_t vccMv = (minSupplyMv < vccNow) ? minSupplyMv : vccNow;   // lowest value seen while the pumps ran
  minSupplyMv = 65535;
  float vref = (vccNow > 3000 && vccNow < 5600) ? vccNow / 1000.0f : 5.0f;   // ADC reference = current 5 V rail

  ds18b20.requestTemperatures();
  float temperature = ds18b20.getTempCByIndex(0);
  if (temperature == 85.0) {                     // DS18B20 power-on value = conversion not finished
    delay(200);
    ds18b20.requestTemperatures();
    temperature = ds18b20.getTempCByIndex(0);
  }
  if (temperature == DEVICE_DISCONNECTED_C || temperature == 85.0) {
    Serial.println(F("WARNING: DS18B20 bad/disconnected, sending sentinel"));
    temperature = TEMP_SENTINEL;
    flags |= FLAG_TEMP_BAD;
  }

  uint16_t spT, spP, spD;
  int rawTurb = readAnalogMedian(TURBIDITY_PIN, &spT);
  int rawPh   = readAnalogMedian(PH_PIN, &spP);
  int rawTds  = readAnalogMedian(TDS_PIN, &spD);

  if (spT > NOISY_SPREAD || spP > NOISY_SPREAD || spD > NOISY_SPREAD) flags |= FLAG_NOISY;
  if (rawPh   < 5 || rawPh   > 1018) flags |= FLAG_PH_SUSPECT;     // floating / saturated / disconnected
  if (rawTurb < 5 || rawTurb > 1018) flags |= FLAG_TURB_SUSPECT;
  if (rawTds  < 3)                   flags |= FLAG_TDS_SUSPECT;     // dead channel or probe in air

  float tempForComp = (flags & FLAG_TEMP_BAD) ? 25.0f : temperature;
  float phValue      = calcPh(rawPh, vref);
  float turbidityNTU = calcTurbidity(rawTurb, vref);
  float tdsPPM       = calcTds(rawTds, vref, tempForComp);

  uint8_t p[PAYLOAD_LEN];
  uint8_t i = 0;
  p[i++] = DATA_MARKER;
  p[i++] = now.year() - 2000;
  p[i++] = now.month();
  p[i++] = now.day();
  p[i++] = now.hour();
  p[i++] = now.minute();
  p[i++] = now.second();
  memcpy(&p[i], &temperature,  4); i += 4;
  memcpy(&p[i], &phValue,      4); i += 4;
  memcpy(&p[i], &turbidityNTU, 4); i += 4;
  memcpy(&p[i], &tdsPPM,       4); i += 4;
  uint16_t rt = (uint16_t)rawTurb, rp = (uint16_t)rawPh, rd = (uint16_t)rawTds;
  memcpy(&p[i], &rt, 2); i += 2;
  memcpy(&p[i], &rp, 2); i += 2;
  memcpy(&p[i], &rd, 2); i += 2;
  memcpy(&p[i], &vccMv, 2); i += 2;
  p[i++] = resetFlagsReport;
  p[i++] = flags;

  uint8_t seq = nextSeq();
  queuePush(p, i, seq);

  Serial.print(F("Reading queued (seq=")); Serial.print(seq);
  Serial.print(F(") T:")); Serial.print(temperature);
  Serial.print(F(" pH:")); Serial.print(phValue);
  Serial.print(F(" Turb:")); Serial.print(turbidityNTU);
  Serial.print(F(" TDS:")); Serial.println(tdsPPM);
  Serial.print(F("  raw turb/pH/tds=")); Serial.print(rawTurb); Serial.print('/');
  Serial.print(rawPh); Serial.print('/'); Serial.print(rawTds);
  Serial.print(F(" supply(min)=")); Serial.print(vccMv);
  Serial.print(F("mV flags=0x")); Serial.println(flags, HEX);
}
