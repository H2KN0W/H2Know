/*
  H2KNOW - CONTROLLER NODE (ESP32) -- v1.2

  v1.2.1: if Supabase answers 401 / 42501 (row-level security) to the upsert, the Controller now switches to plain
  inserts by itself (the unique index still rejects duplicates with 409, which is dropped as "already stored").
  The raw table gets the same fallback.

  v1.2 changes (hardware: SD module moved to its own SPI bus)
  - LoRa RA-02 stays on VSPI (default SPI object): SCK 18, MISO 19, MOSI 23, NSS 5, RST 14, DIO0 26.
  - microSD module now on HSPI: SCK 25, MISO 27, MOSI 32, CS 33.  The two buses are independent, so there is
    no CS juggling and no SPI re-initialisation between devices any more.
  - Two FreeRTOS tasks:
      LoRa task   (core 1): ONLY talks to the radio. Receive -> checksum/sequence check -> ACK immediately ->
                            duplicate check -> push the reading into a FreeRTOS queue. Never touches SD or WiFi.
      Worker task (core 0): takes readings from the queue.
                            WiFi up   -> HTTPS POST to Supabase.
                            WiFi down or POST failed -> append one line to /pending.txt on the SD card.
                            WiFi back -> upload /pending.txt line by line, then delete the file
                                         (if it stops half way, only the unsent lines are kept).
  - SD file operations are always open -> write/read -> close. No file stays open between packets.
  - If the SD card is missing or failing, readings fall back to an 8-slot RAM queue (lost on power cut).
  - Radio settings, Supabase settings and the data format are unchanged from v1.1.

  FLOW
  ----
  LoRa task:   always listening (SF9, CRC on, sync 0x2B) -> ACK -> queue
  Worker task: queue -> (wait 5 s of radio silence) -> POST 4 rows (temp, pH, turb, TDS) with upsert /
               ignore-duplicates -> raw row -> heartbeat every HEARTBEAT_MS
               failure -> /pending.txt, retry with backoff 15 s -> 60 s -> 5 min (or at once when WiFi reconnects)

  NEEDS in Supabase (unchanged):
    - unique index on sensor_readings (node_id, parameter_id, recorded_at)     [duplicate-safe uploads]
    - table sensor_readings_raw   [raw ADC + quality flags, optional]
    - table node_status           [heartbeat, optional]
  Radio settings MUST match the Sensor Node v1.
*/

#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SD.h>
#include <FS.h>
#include <time.h>
#include <esp_system.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

// ---------- Options ----------
#define USE_WATCHDOG          1       // task watchdog: reboot if the LoRa or worker task freezes
#define WDT_TIMEOUT_S         60
#define USE_UPSERT            1       // needs the unique index in Supabase. Auto-falls back if it is missing.
#define RAW_TABLE_ENABLED     1       // also upload raw ADC values + quality flags (auto-disables on HTTP 404)
#define HEARTBEAT_ENABLED     1
#define HEARTBEAT_MS     600000UL     // 10 minutes
#define SKIP_SUSPECT_PARAMS   0       // 1 = do NOT upload a parameter whose quality flag says "suspect"

#if USE_WATCHDOG
#include <esp_task_wdt.h>
#define WDT_FEED()      esp_task_wdt_reset()
#define WDT_ADD_SELF()  esp_task_wdt_add(NULL)
#else
#define WDT_FEED()      do {} while (0)
#define WDT_ADD_SELF()  do {} while (0)
#endif

// ---------- LoRa pins: VSPI (default SPI object), ESP32 native 3.3 V ----------
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_NSS   5
#define LORA_RST   14
#define LORA_DIO0  26
#define LORA_FREQ  433E6
#define LORA_SF    9
#define LORA_BW    125E3
#define LORA_CR    5
#define LORA_SYNC  0x2B
#define LORA_TXPOWER 14
#define TX_TIMEOUT_MS 1500UL

// ---------- SD card: its own HSPI bus ----------
#define SD_SCK   25
#define SD_MISO  27
#define SD_MOSI  32
#define SD_CS    33
#define PENDING_FILE "/pending.txt"
#define PENDING_TMP  "/pending.tmp"
SPIClass sdSPI(HSPI);

// ---------- WiFi / Supabase ----------
const char* WIFI_SSID     = "";
const char* WIFI_PASS     = "";
const char* SUPABASE_BASE = "";     // ends with /rest/v1/
const char* SUPABASE_KEY  = "";
#define SUPABASE_HOST ""
const char* TABLE_READINGS = "sensor_readings";
const char* TABLE_RAW      = "sensor_readings_raw";
const char* TABLE_STATUS   = "node_status";

const char* NODE_ID              = "821333d5-602d-478e-accc-12fbecb39203";
const char* PARAM_ID_TEMPERATURE = "1f2b5dea-ef75-4e4b-a334-0c7f1d9e845d";
const char* PARAM_ID_PH          = "b6bd99b4-953d-47f0-a6d6-0610721c0b50";
const char* PARAM_ID_TURBIDITY   = "c6fd92e3-1c5c-4c24-b9b3-5d430cd69155";
const char* PARAM_ID_TDS         = "98840521-246b-48a0-b8e4-53ae15b61bc9";

// ---------- Protocol ----------
#define START_BYTE        0x7E
#define ADDR_SENSOR       0x01
#define ADDR_CONTROLLER   0x02
#define MSG_DATA          0x03
#define MSG_DATA_ACK      0x04
#define DATA_MARKER       0xB1
#define PAYLOAD_LEN       33
#define FLAG_TEMP_BAD     0x01
#define FLAG_PH_SUSPECT   0x02
#define FLAG_TURB_SUSPECT 0x04
#define FLAG_TDS_SUSPECT  0x08
#define FLAG_RTC_BAD      0x10
#define FLAG_NOISY        0x20

// ---------- Timing ----------
#define QUIET_BEFORE_UPLOAD_MS 5000UL    // worker waits for this much radio silence before any HTTPS
#define UPLOAD_RETRY_MS        15000UL
#define WIFI_RETRY_MS          30000UL
#define RADIO_CHECK_MS         1000UL
#define STATUS_MS              60000UL
#define SD_RETRY_MS            300000UL
#define RAM_Q_SIZE             8
#define RECENT_KEYS            12
#define READING_QUEUE_LEN      16

// One reading, as passed LoRa task -> worker task (copied by value through the FreeRTOS queue)
struct Reading {
  char     ts[32];
  float    temp, ph, turb, tds;
  uint16_t rawTurb, rawPh, rawTds, supplyMv;
  uint8_t  resetFlags, qualityFlags, seq;
  int16_t  rssi;
  float    snr;
};

enum UpResult { UP_OK, UP_DROP, UP_RETRY };   // stored / permanently rejected (do not keep) / try again later

// ---------- Shared between the two tasks ----------
QueueHandle_t readingQ = NULL;
volatile unsigned long lastRadioActivity = 0;
volatile bool          radioReinitRequested = false;   // worker asks the LoRa task to re-init after WiFi/TLS bursts
volatile unsigned long lastSensorFrame = 0;
volatile bool          sensorEverSeen = false;
volatile int           lastLoraRssi = 0;
volatile float         lastLoraSnr = 0;
volatile uint16_t      lastSupplyMv = 0;
volatile uint8_t       lastResetFlags = 0;

// ---------- LoRa-task state ----------
unsigned long lastRadioCheck = 0;
uint8_t seqNum = 0;
uint8_t recentKeys[RECENT_KEYS][7];
uint8_t recentCount = 0, recentNext = 0;

// ---------- Worker-task state ----------
bool useUpsert = (USE_UPSERT != 0);
bool useRawTable = (RAW_TABLE_ENABLED != 0);
bool useRawUpsert = true;           // auto-switches to plain insert if RLS rejects the raw upsert
unsigned long lastWifiRetry = 0;
unsigned long lastStatus = 0;
unsigned long lastDiag = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastSdTry = 0;
unsigned long nextFlushAt = 0;
uint8_t flushFails = 0;
bool sdOk = false;
int  pendingLines = 0;               // lines currently in /pending.txt
Reading ramQ[RAM_Q_SIZE];            // fallback when the SD card is unavailable
uint8_t ramHead = 0, ramCount = 0;

// =====================================================================
void setup() {
  setCpuFrequencyMhz(160);
  Serial.begin(115200);
  delay(300);
  Serial.println(F("\n=== H2KNOW Controller Node v1.2 ==="));
  Serial.print(F("Reset reason code: ")); Serial.println((int)esp_reset_reason());

  // ---- LoRa on VSPI ----
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setSPI(SPI);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  while (!radioInit()) {
    Serial.println(F("LoRa init failed, retrying..."));
    delay(500);
  }
  LoRa.receive();

  // ---- SD on its own HSPI bus (the card itself is mounted by the worker task) ----
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  // ---- WiFi + NTP (non-blocking: the worker task watches the connection) ----
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  WiFi.setTxPower(WIFI_POWER_11dBm);              // lower WiFi peak current = less supply sag for the radio
  configTime(8 * 3600, 0, "pool.ntp.org", "time.google.com");   // UTC+8 (Philippines)

  lastHeartbeat = millis() - HEARTBEAT_MS + 60000UL;   // first heartbeat ~1 min after boot
  lastRadioActivity = millis();
  lastSdTry = millis();

#if USE_WATCHDOG
  wdtBegin();
#endif

  readingQ = xQueueCreate(READING_QUEUE_LEN, sizeof(Reading));
  if (!readingQ) {
    Serial.println(F("!! Cannot create reading queue - restarting"));
    delay(500);
    ESP.restart();
  }

  xTaskCreatePinnedToCore(loraTask,   "lora",   6144,  NULL, 3, NULL, 1);
  xTaskCreatePinnedToCore(workerTask, "worker", 16384, NULL, 2, NULL, 0);

  Serial.println(F("Controller ready. Listening for the Sensor Node..."));
}

void loop() {
  // All the work happens in loraTask and workerTask.
  vTaskDelay(pdMS_TO_TICKS(1000));
}

// =====================================================================
// Watchdog
// =====================================================================
#if USE_WATCHDOG
void wdtBegin() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  esp_task_wdt_config_t cfg;
  cfg.timeout_ms = WDT_TIMEOUT_S * 1000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  esp_task_wdt_deinit();
  esp_task_wdt_init(&cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  Serial.println(F("Watchdog enabled (LoRa task + worker task)"));
}
#endif

// =====================================================================
// LoRa task: radio only. No SD, no WiFi, no HTTP in here.
// =====================================================================
void loraTask(void *arg) {
  WDT_ADD_SELF();
  for (;;) {
    WDT_FEED();
    handleIncoming();
    radioHealthCheck(false);
    if (radioReinitRequested) {            // requested by the worker after a WiFi/TLS burst
      radioReinitRequested = false;
      radioHealthCheck(true);
      radioReinit();
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// =====================================================================
// Radio (direct register control with timeout) - used by the LoRa task only
// =====================================================================
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
  if (!LoRa.begin(LORA_FREQ)) return false;       // begin() pulses RST = full chip reset
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNC);
  LoRa.enableCrc();
  LoRa.setTxPower(LORA_TXPOWER);
  return true;
}

void radioReinit() {
  LoRa.sleep();
  delay(20);
  if (!radioInit()) Serial.println(F("!! Radio re-init FAILED (check RA-02 power)"));
  LoRa.receive();
}

void radioHealthCheck(bool force) {
  if (!force && millis() - lastRadioCheck < RADIO_CHECK_MS) return;
  lastRadioCheck = millis();
  uint8_t op  = loraReadReg(0x01);
  uint8_t ver = loraReadReg(0x42);
  if ((op & 0x80) == 0 || ver != 0x12) {
    Serial.print(F("!! Radio unhealthy: OpMode=0x")); Serial.print(op, HEX);
    Serial.print(F(" Ver=0x")); Serial.print(ver, HEX);
    Serial.println(F(" - re-initialising"));
    radioReinit();
  }
}

uint8_t calcChecksum(uint8_t *buf, uint8_t len) {
  uint8_t cs = 0;
  for (uint8_t i = 0; i < len; i++) cs ^= buf[i];
  return cs;
}

void sendPacket(uint8_t dest, uint8_t msgType, uint8_t *payload, uint8_t payloadLen) {
  uint8_t buf[64];
  uint8_t idx = 0;
  buf[idx++] = dest;
  buf[idx++] = ADDR_CONTROLLER;
  buf[idx++] = msgType;
  buf[idx++] = seqNum++;
  buf[idx++] = payloadLen;
  for (uint8_t i = 0; i < payloadLen; i++) buf[idx++] = payload[i];
  uint8_t cs = calcChecksum(buf, idx);

  radioHealthCheck(true);
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.write(START_BYTE);
  LoRa.write(buf, idx);
  LoRa.write(cs);

  loraWriteReg(0x12, 0xFF);                        // clear IRQ flags
  unsigned long t0 = millis();
  loraWriteReg(0x01, 0x83);                        // LoRa mode + TX
  while (!(loraReadReg(0x12) & 0x08) && (millis() - t0) < TX_TIMEOUT_MS) { delay(1); }
  bool done = loraReadReg(0x12) & 0x08;
  loraWriteReg(0x12, 0xFF);
  if (!done) {
    Serial.println(F("  !! TX TIMEOUT - re-initialising radio"));
    radioReinit();                                 // ends with LoRa.receive()
  }
  LoRa.receive();                                  // back to listening after every transmission
}

void handleIncoming() {
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;
  lastRadioActivity = millis();

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  uint8_t buf[64];
  uint8_t idx = 0;
  while (LoRa.available() && idx < sizeof(buf)) buf[idx++] = LoRa.read();

  Serial.print(F("LoRa RX len=")); Serial.print(idx);
  Serial.print(F(" RSSI=")); Serial.print(rssi);
  Serial.print(F(" SNR=")); Serial.println(snr);

  if (idx < 7) return;
  if (buf[0] != START_BYTE) return;

  uint8_t dest    = buf[1];
  uint8_t msgType = buf[3];
  uint8_t recvSeq = buf[4];
  uint8_t len     = buf[5];

  if (idx < (uint16_t)(6 + len + 1)) { Serial.println(F("Frame length mismatch, dropping")); return; }

  uint8_t *payload = &buf[6];
  uint8_t recvCs = buf[idx - 1];
  if (calcChecksum(&buf[1], idx - 2) != recvCs) { Serial.println(F("Checksum mismatch, dropping")); return; }
  if (dest != ADDR_CONTROLLER) return;

  if (msgType == MSG_DATA) {
    if (len >= PAYLOAD_LEN && payload[0] == DATA_MARKER) {
      uint8_t ack[1] = { recvSeq };
      sendPacket(ADDR_SENSOR, MSG_DATA_ACK, ack, 1);       // ACK first, everything else second
      lastRadioActivity = millis();

      Reading r;
      buildReading(payload, recvSeq, rssi, snr, r);

      lastSensorFrame = millis();
      sensorEverSeen = true;
      lastLoraRssi = rssi;
      lastLoraSnr = snr;
      lastSupplyMv = r.supplyMv;
      lastResetFlags = r.resetFlags;

      uint8_t key[7];
      memcpy(key, &payload[1], 6);
      key[6] = recvSeq;
      if (isDuplicate(key)) {
        Serial.println(F("Duplicate reading (Sensor retry) - ACKed again, not queued again"));
      } else {
        rememberKey(key);
        if (xQueueSend(readingQ, &r, 0) != pdTRUE) {         // queue full: drop the oldest, keep the newest
          Reading old;
          xQueueReceive(readingQ, &old, 0);
          xQueueSend(readingQ, &r, 0);
          Serial.println(F("!! Reading queue full - dropped the oldest queued reading"));
        }
        Serial.print(F("Reading queued for the worker. Queue depth: "));
        Serial.println((int)uxQueueMessagesWaiting(readingQ));
      }
    } else {
      Serial.println(F("Malformed DATA payload, ignored (Sensor will retry)"));
    }
  }
}

// =====================================================================
// Decode a DATA payload into a Reading
// =====================================================================
void buildReading(uint8_t *p, uint8_t seq, int rssi, float snr, Reading &r) {
  memset(&r, 0, sizeof(r));
  uint8_t i = 1;
  uint8_t year = p[i++], month = p[i++], day = p[i++], hour = p[i++], minute = p[i++], second = p[i++];
  memcpy(&r.temp, &p[i], 4); i += 4;
  memcpy(&r.ph,   &p[i], 4); i += 4;
  memcpy(&r.turb, &p[i], 4); i += 4;
  memcpy(&r.tds,  &p[i], 4); i += 4;
  memcpy(&r.rawTurb, &p[i], 2); i += 2;
  memcpy(&r.rawPh,   &p[i], 2); i += 2;
  memcpy(&r.rawTds,  &p[i], 2); i += 2;
  memcpy(&r.supplyMv, &p[i], 2); i += 2;
  r.resetFlags = p[i++];
  r.qualityFlags = p[i++];
  r.seq = seq;
  r.rssi = (int16_t)rssi;
  r.snr = snr;

  bool rtcBad = (year < 24) || (r.qualityFlags & FLAG_RTC_BAD);
  struct tm t;
  if (rtcBad && getLocalTime(&t, 0)) {
    snprintf(r.ts, sizeof(r.ts), "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
             t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
    Serial.println(F("Sensor RTC invalid - using controller NTP time for this reading"));
  } else {
    snprintf(r.ts, sizeof(r.ts), "20%02d-%02d-%02dT%02d:%02d:%02d+08:00", year, month, day, hour, minute, second);
  }
  Serial.print(F("Received -> ")); Serial.print(r.ts);
  Serial.print(F(" T:")); Serial.print(r.temp);
  Serial.print(F(" pH:")); Serial.print(r.ph);
  Serial.print(F(" Turb:")); Serial.print(r.turb);
  Serial.print(F(" TDS:")); Serial.print(r.tds);
  Serial.print(F(" supply=")); Serial.print(r.supplyMv);
  Serial.print(F("mV flags=0x")); Serial.println(r.qualityFlags, HEX);
}

bool isDuplicate(const uint8_t *key) {
  for (uint8_t i = 0; i < recentCount; i++)
    if (memcmp(recentKeys[i], key, 7) == 0) return true;
  return false;
}

void rememberKey(const uint8_t *key) {
  memcpy(recentKeys[recentNext], key, 7);
  recentNext = (recentNext + 1) % RECENT_KEYS;
  if (recentCount < RECENT_KEYS) recentCount++;
}

// =====================================================================
// Worker task: queue -> Supabase, with /pending.txt as the offline store
// =====================================================================
void workerTask(void *arg) {
  WDT_ADD_SELF();

  sdOk = sdInit();
  Serial.println(sdOk ? F("SD ready (HSPI)") : F("SD card NOT available - using RAM queue (readings lost on power cut)"));
  lastSdTry = millis();

  for (;;) {
    WDT_FEED();
    keepWifiAlive();
    trackWifi();

    Reading r;
    if (xQueueReceive(readingQ, &r, pdMS_TO_TICKS(500)) == pdTRUE) {
      handleLiveReading(r);
    } else {
      serviceBacklog();
      serviceHeartbeat();
    }
    sdRetryMaybe();
    printStatus();
  }
}

void waitRadioQuiet() {
  while (millis() - lastRadioActivity < QUIET_BEFORE_UPLOAD_MS) {
    WDT_FEED();
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

unsigned long backoffMs(uint8_t fails) {
  return (fails < 2) ? UPLOAD_RETRY_MS : (fails < 4 ? 60000UL : 300000UL);
}

void noteUploadFailure() {
  if (flushFails < 250) flushFails++;
  nextFlushAt = millis() + backoffMs(flushFails);
}

void noteUploadSuccess() {
  flushFails = 0;
  nextFlushAt = 0;
}

void handleLiveReading(const Reading &r) {
  bool keep = true;                                  // true = must be saved for later
  if (WiFi.status() == WL_CONNECTED) {
    waitRadioQuiet();
    UpResult u = uploadReading(r);
    radioReinitRequested = true;                     // WiFi/TLS bursts can upset the 3.3 V rail
    if (u == UP_RETRY) noteUploadFailure(); else { noteUploadSuccess(); keep = false; }
  } else {
    Serial.println(F("WiFi down - saving the reading for later"));
  }
  if (keep) saveForLater(r);
}

void saveForLater(const Reading &r) {
  if (appendPending(r)) {
    Serial.print(F("Saved to ")); Serial.print(PENDING_FILE);
    Serial.print(F(". Lines waiting: ")); Serial.println(pendingLines);
    return;
  }
  ramPush(r);
  Serial.print(F("SD unavailable - kept in RAM queue (")); Serial.print(ramCount); Serial.println(F(" waiting)"));
}

void ramPush(const Reading &r) {
  if (ramCount >= RAM_Q_SIZE) {
    Serial.println(F("RAM queue full - dropping the oldest reading"));
    ramHead = (ramHead + 1) % RAM_Q_SIZE;
    ramCount--;
  }
  ramQ[(ramHead + ramCount) % RAM_Q_SIZE] = r;
  ramCount++;
}

int backlogCount() {
  return (sdOk ? pendingLines : 0) + ramCount;
}

void serviceBacklog() {
  if (backlogCount() == 0) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if ((long)(millis() - nextFlushAt) < 0) return;
  flushBacklog();
}

// Upload everything that was saved while offline: /pending.txt first (older), then the RAM queue.
void flushBacklog() {
  Serial.print(F("Uploading backlog (")); Serial.print(backlogCount()); Serial.println(F(" waiting)..."));
  bool failed = false;

  // ---- 1. SD file, one line at a time; the file is closed again between lines ----
  if (sdOk && pendingLines > 0) {
    uint32_t offset = 0;
    bool eof = false;
    char line[320];
    for (;;) {
      WDT_FEED();
      if (uxQueueMessagesWaiting(readingQ) > 0) break;                 // live readings first
      uint32_t next = offset;
      int rc = pendingReadLine(offset, line, sizeof(line), next);
      if (rc == 0) { eof = true; break; }
      if (rc < 0) { Serial.println(F("!! Cannot read /pending.txt")); sdOk = false; lastSdTry = millis(); failed = true; break; }
      if (line[0] == 0) { offset = next; continue; }                   // blank line
      Reading r;
      if (!lineToReading(line, r)) {
        Serial.println(F("Corrupt line in /pending.txt - skipped"));
        offset = next;
        if (pendingLines > 0) pendingLines--;
        continue;
      }
      waitRadioQuiet();
      UpResult u = uploadReading(r);
      radioReinitRequested = true;
      if (u == UP_RETRY) { failed = true; break; }
      offset = next;
      if (pendingLines > 0) pendingLines--;
    }
    if (eof || (pendingLines <= 0 && !failed)) {
      removePendingFile();
      pendingLines = 0;
      Serial.println(F("/pending.txt fully uploaded and deleted"));
    } else if (offset > 0) {
      if (compactPending(offset)) Serial.println(F("/pending.txt trimmed to the lines not sent yet"));
      else Serial.println(F("!! Could not trim /pending.txt (already-sent lines may be re-uploaded, duplicates are ignored)"));
    }
  }

  // ---- 2. RAM fallback queue ----
  while (!failed && ramCount > 0) {
    WDT_FEED();
    if (uxQueueMessagesWaiting(readingQ) > 0) break;
    waitRadioQuiet();
    UpResult u = uploadReading(ramQ[ramHead]);
    radioReinitRequested = true;
    if (u == UP_RETRY) { failed = true; break; }
    ramHead = (ramHead + 1) % RAM_Q_SIZE;
    ramCount--;
  }

  if (failed) {
    noteUploadFailure();
    Serial.print(F("Backlog upload paused - retry in ")); Serial.print(backoffMs(flushFails) / 1000UL); Serial.println(F(" s"));
  } else {
    noteUploadSuccess();
  }
}

// =====================================================================
// SD card (HSPI): /pending.txt, one reading per line. Every operation is open -> work -> close.
// Line format: ts,temp,ph,turb,tds,rawTurb,rawPh,rawTds,supplyMv,resetFlags,qualityFlags,seq,rssi,snr
// =====================================================================
#define PENDING_FIELDS 14

bool sdInit() {
  const uint32_t speeds[2] = { 4000000UL, 1000000UL };
  bool ok = false;
  for (uint8_t k = 0; k < 2 && !ok; k++) {
    SD.end();
    ok = SD.begin(SD_CS, sdSPI, speeds[k]);
    Serial.print(F("SD.begin(CS=GPIO")); Serial.print(SD_CS);
    Serial.print(F(", HSPI, ")); Serial.print(speeds[k] / 1000UL);
    Serial.println(ok ? F(" kHz): ok") : F(" kHz): FAILED"));
  }
  if (!ok) {
    Serial.println(F("SD hint: check SCK25/MISO27/MOSI32/CS33 wiring, module VCC (many need 5 V), card FAT32."));
    return false;
  }
  uint8_t type = SD.cardType();
  if (type == CARD_NONE) { Serial.println(F("SD: no card detected")); return false; }
  Serial.print(F("SD card type=")); Serial.print(type);
  Serial.print(F(" size=")); Serial.print((unsigned long)(SD.cardSize() / (1024ULL * 1024ULL))); Serial.println(F(" MB"));

  // finish an interrupted trim (power cut between remove and rename)
  if (!SD.exists(PENDING_FILE) && SD.exists(PENDING_TMP)) SD.rename(PENDING_TMP, PENDING_FILE);
  pendingLines = countPendingLines();
  Serial.print(F("Lines waiting in ")); Serial.print(PENDING_FILE); Serial.print(F(": ")); Serial.println(pendingLines);
  return true;
}

void sdRetryMaybe() {
  if (sdOk) return;
  if (millis() - lastSdTry < SD_RETRY_MS) return;
  lastSdTry = millis();
  sdOk = sdInit();
  if (sdOk) Serial.println(F("SD card is back"));
}

int countPendingLines() {
  if (!SD.exists(PENDING_FILE)) return 0;
  File f = SD.open(PENDING_FILE, FILE_READ);
  if (!f) return 0;
  int n = 0;
  int c;
  bool inLine = false;
  while ((c = f.read()) >= 0) {
    if (c == '\n') { if (inLine) n++; inLine = false; }
    else if (c != '\r') inLine = true;
  }
  f.close();
  return n;
}

void readingToLine(const Reading &r, char *out, size_t n) {
  snprintf(out, n, "%s,%.3f,%.3f,%.3f,%.3f,%u,%u,%u,%u,%u,%u,%u,%d,%.2f",
           r.ts, r.temp, r.ph, r.turb, r.tds,
           (unsigned)r.rawTurb, (unsigned)r.rawPh, (unsigned)r.rawTds, (unsigned)r.supplyMv,
           (unsigned)r.resetFlags, (unsigned)r.qualityFlags, (unsigned)r.seq,
           (int)r.rssi, r.snr);
}

bool lineToReading(char *line, Reading &r) {
  char *tok[PENDING_FIELDS];
  int n = 0;
  char *save = NULL;
  for (char *p = strtok_r(line, ",", &save); p != NULL && n < PENDING_FIELDS; p = strtok_r(NULL, ",", &save)) tok[n++] = p;
  if (n != PENDING_FIELDS) return false;
  memset(&r, 0, sizeof(r));
  strncpy(r.ts, tok[0], sizeof(r.ts) - 1);
  if (strlen(r.ts) < 19) return false;
  r.temp = strtof(tok[1], NULL);
  r.ph   = strtof(tok[2], NULL);
  r.turb = strtof(tok[3], NULL);
  r.tds  = strtof(tok[4], NULL);
  r.rawTurb  = (uint16_t)atoi(tok[5]);
  r.rawPh    = (uint16_t)atoi(tok[6]);
  r.rawTds   = (uint16_t)atoi(tok[7]);
  r.supplyMv = (uint16_t)atoi(tok[8]);
  r.resetFlags   = (uint8_t)atoi(tok[9]);
  r.qualityFlags = (uint8_t)atoi(tok[10]);
  r.seq  = (uint8_t)atoi(tok[11]);
  r.rssi = (int16_t)atoi(tok[12]);
  r.snr  = strtof(tok[13], NULL);
  return true;
}

// open -> append one line -> close
bool appendPending(const Reading &r) {
  if (!sdOk) return false;
  char line[320];
  readingToLine(r, line, sizeof(line));
  File f = SD.open(PENDING_FILE, FILE_APPEND);
  if (!f) {
    Serial.println(F("!! Cannot open /pending.txt for append - SD marked unavailable"));
    sdOk = false; lastSdTry = millis();
    return false;
  }
  size_t want = strlen(line) + 1;
  size_t got = f.print(line);
  got += f.print('\n');
  f.close();
  if (got != want) {
    Serial.println(F("!! SD write failed - SD marked unavailable"));
    sdOk = false; lastSdTry = millis();
    return false;
  }
  pendingLines++;
  return true;
}

// open -> read ONE line starting at byte 'offset' -> close.
// returns 1 = got a line (next = offset of the following line), 0 = end of file, -1 = error
int pendingReadLine(uint32_t offset, char *buf, size_t n, uint32_t &next) {
  File f = SD.open(PENDING_FILE, FILE_READ);
  if (!f) return -1;
  if (offset > 0 && !f.seek(offset)) { f.close(); return -1; }
  size_t i = 0;
  uint32_t consumed = 0;
  int c;
  while ((c = f.read()) >= 0) {
    consumed++;
    if (c == '\n') break;
    if (i < n - 1) buf[i++] = (char)c;
  }
  f.close();
  buf[i] = 0;
  while (i > 0 && (buf[i - 1] == '\r' || buf[i - 1] == ' ')) buf[--i] = 0;
  next = offset + consumed;
  return consumed == 0 ? 0 : 1;
}

void removePendingFile() {
  if (SD.exists(PENDING_FILE)) SD.remove(PENDING_FILE);
  if (SD.exists(PENDING_TMP))  SD.remove(PENDING_TMP);
}

// Keep only the bytes from 'offset' onward (the lines that were not sent yet).
bool compactPending(uint32_t offset) {
  File src = SD.open(PENDING_FILE, FILE_READ);
  if (!src) return false;
  if (!src.seek(offset)) { src.close(); return false; }
  if (SD.exists(PENDING_TMP)) SD.remove(PENDING_TMP);
  File dst = SD.open(PENDING_TMP, FILE_WRITE);
  if (!dst) { src.close(); return false; }
  uint8_t chunk[128];
  bool ok = true;
  size_t n;
  while ((n = src.read(chunk, sizeof(chunk))) > 0) {
    if (dst.write(chunk, n) != n) { ok = false; break; }
  }
  src.close();
  dst.close();
  if (!ok) { SD.remove(PENDING_TMP); return false; }
  SD.remove(PENDING_FILE);
  SD.rename(PENDING_TMP, PENDING_FILE);
  return true;
}

// =====================================================================
// Supabase
// =====================================================================
// returns the HTTP code (<= 0 = network error). 'resp' is filled for errors.
int httpPost(const char *table, const char *query, const String &body, const char *prefer, String &resp) {
  WiFiClientSecure client;
  client.setInsecure();                            // bring-up only: skips TLS certificate validation
  HTTPClient http;
  http.setTimeout(8000);
  http.setConnectTimeout(4000);
  String url = String(SUPABASE_BASE) + table;
  if (query && query[0]) url += query;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", prefer);
  int code = http.POST(body);
  resp = "";
  if (code <= 0) resp = http.errorToString(code);
  else if (code >= 300) resp = http.getString();
  http.end();
  return code;
}

void addRow(String &body, const char *paramId, float value, const char *ts, bool &first) {
  if (isnan(value) || isinf(value)) return;
  if (!first) body += ",";
  first = false;
  body += String("{\"node_id\":\"") + NODE_ID + "\",\"parameter_id\":\"" + paramId +
          "\",\"value\":" + String(value, 3) + ",\"source\":\"live\",\"recorded_at\":\"" + ts + "\"}";
}

void postRaw(const Reading &r) {
  if (!useRawTable) return;
  String body = String("{\"node_id\":\"") + NODE_ID + "\",\"recorded_at\":\"" + r.ts +
                "\",\"raw_turbidity\":" + r.rawTurb + ",\"raw_ph\":" + r.rawPh + ",\"raw_tds\":" + r.rawTds +
                ",\"supply_mv\":" + r.supplyMv + ",\"reset_flags\":" + r.resetFlags +
                ",\"quality_flags\":" + r.qualityFlags + ",\"seq\":" + r.seq +
                ",\"lora_rssi\":" + r.rssi + ",\"lora_snr\":" + String(r.snr, 2) + "}";
  for (uint8_t attempt = 0; attempt < 2; attempt++) {
    String resp;
    int code = httpPost(TABLE_RAW, useRawUpsert ? "?on_conflict=node_id,recorded_at" : "", body,
                        useRawUpsert ? "resolution=ignore-duplicates,return=minimal" : "return=minimal", resp);
    Serial.print(F("Supabase raw POST -> ")); Serial.println(code);
    if (code == 404) {
      Serial.println(F("Table sensor_readings_raw not found - raw upload disabled until reboot"));
      useRawTable = false;
      return;
    }
    if (code == 401 && useRawUpsert && resp.indexOf("42501") >= 0) {
      Serial.println(F("RLS rejected the raw upsert - switching to plain insert"));
      useRawUpsert = false;
      continue;
    }
    if ((code <= 0 || code >= 300) && code != 409) Serial.println(resp);   // best effort only: never blocks the main reading
    return;
  }
}

// UP_OK = stored, UP_DROP = permanently rejected (retrying never helps), UP_RETRY = keep it and try later
UpResult uploadReading(const Reading &r) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println(F("No WiFi - upload postponed")); return UP_RETRY; }

  String body = "[";
  bool first = true;
  bool tempBad = (r.temp <= -998.0f) || (r.qualityFlags & FLAG_TEMP_BAD);
  if (!tempBad) addRow(body, PARAM_ID_TEMPERATURE, r.temp, r.ts, first);
  else Serial.println(F("Temperature invalid - skipping that row"));
  if (SKIP_SUSPECT_PARAMS && (r.qualityFlags & FLAG_PH_SUSPECT)) Serial.println(F("pH suspect - skipping row"));
  else addRow(body, PARAM_ID_PH, r.ph, r.ts, first);
  if (SKIP_SUSPECT_PARAMS && (r.qualityFlags & FLAG_TURB_SUSPECT)) Serial.println(F("Turbidity suspect - skipping row"));
  else addRow(body, PARAM_ID_TURBIDITY, r.turb, r.ts, first);
  if (SKIP_SUSPECT_PARAMS && (r.qualityFlags & FLAG_TDS_SUSPECT)) Serial.println(F("TDS suspect - skipping row"));
  else addRow(body, PARAM_ID_TDS, r.tds, r.ts, first);
  body += "]";
  if (first) { Serial.println(F("Nothing valid to upload for this reading - dropping")); return UP_DROP; }

  for (uint8_t attempt = 0; attempt < 2; attempt++) {
    String resp;
    int code = httpPost(TABLE_READINGS,
                        useUpsert ? "?on_conflict=node_id,parameter_id,recorded_at" : "",
                        body,
                        useUpsert ? "resolution=ignore-duplicates,return=minimal" : "return=minimal",
                        resp);
    Serial.print(F("Supabase POST (")); Serial.print(r.ts); Serial.print(F(") -> ")); Serial.println(code);

    if (code >= 200 && code < 300) {
      postRaw(r);
      return UP_OK;
    }
    if (code <= 0) {
      Serial.print(F("Upload failed: ")); Serial.println(resp);
      if (millis() - lastDiag > 60000UL) { lastDiag = millis(); diagnoseNetwork(); }
      return UP_RETRY;
    }
    Serial.println(resp);
    if (code == 400 && useUpsert && resp.indexOf("42P10") >= 0) {
      Serial.println(F("!! Unique index missing on sensor_readings - switching to plain inserts. Run the SQL to enable duplicate-safe uploads."));
      useUpsert = false;
      continue;                                    // retry the same reading right away, without upsert
    }
    if ((code == 401 || code == 403) && useUpsert && resp.indexOf("42501") >= 0) {
      Serial.println(F("!! RLS rejected the upsert - switching to plain inserts (unique index still blocks duplicates)"));
      useUpsert = false;
      continue;                                    // retry the same reading right away, as a plain insert
    }
    if (code == 409) {
      Serial.println(F("Duplicate (already stored) - dropping this copy"));
      return UP_DROP;
    }
    if (code == 400 || code == 422) {
      Serial.println(F("Permanent rejection (bad data) - dropping this reading"));
      return UP_DROP;
    }
    if (code == 401 || code == 403 || code == 404) {
      Serial.println(F("CONFIG PROBLEM (key / RLS policy / table name) - reading kept for later; fix Supabase settings"));
    }
    return UP_RETRY;
  }
  return UP_RETRY;
}

void serviceHeartbeat() {
#if HEARTBEAT_ENABLED
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastHeartbeat < HEARTBEAT_MS) return;
  if (millis() - lastRadioActivity < QUIET_BEFORE_UPLOAD_MS) return;
  lastHeartbeat = millis();                        // one attempt per interval, never retried in a burst

  long seenAgo = sensorEverSeen ? (long)((millis() - lastSensorFrame) / 1000UL) : -1;
  int depth = (int)uxQueueMessagesWaiting(readingQ) + backlogCount();
  String body = String("{\"node_id\":\"") + NODE_ID +
                "\",\"controller_uptime_s\":" + (unsigned long)(millis() / 1000UL) +
                ",\"wifi_rssi\":" + WiFi.RSSI() +
                ",\"queue_depth\":" + depth +
                ",\"sd_ok\":" + (sdOk ? "true" : "false") +
                ",\"last_lora_rssi\":" + (int)lastLoraRssi +
                ",\"last_lora_snr\":" + String((float)lastLoraSnr, 2) +
                ",\"sensor_last_seen_s\":" + seenAgo +
                ",\"sensor_supply_mv\":" + (unsigned int)lastSupplyMv +
                ",\"sensor_reset_flags\":" + (unsigned int)lastResetFlags +
                ",\"controller_reset_reason\":" + (int)esp_reset_reason() +
                ",\"free_heap\":" + (unsigned long)ESP.getFreeHeap() + "}";
  String resp;
  int code = httpPost(TABLE_STATUS, "", body, "return=minimal", resp);
  Serial.print(F("Heartbeat POST -> ")); Serial.println(code);
  if (code == 404) Serial.println(F("Table node_status not found - run the SQL to enable heartbeats"));
  else if (code <= 0 || code >= 300) Serial.println(resp);

  radioReinitRequested = true;
#endif
}

// =====================================================================
// WiFi + diagnostics (worker task)
// =====================================================================
void keepWifiAlive() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiRetry < WIFI_RETRY_MS) return;
  Serial.println(F("WiFi disconnected, resetting radio and retrying..."));
  WiFi.disconnect(true, false);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  WiFi.setTxPower(WIFI_POWER_11dBm);
  lastWifiRetry = millis();
}

void trackWifi() {
  static bool wasUp = false;
  static bool firstDiagDone = false;
  bool up = (WiFi.status() == WL_CONNECTED);
  if (up && !wasUp) {
    Serial.print(F("WiFi connected, RSSI ")); Serial.print(WiFi.RSSI()); Serial.println(F(" dBm"));
    nextFlushAt = 0;                               // WiFi is back: upload the backlog right away
    flushFails = 0;
    if (!firstDiagDone) {
      firstDiagDone = true;
      struct tm t;
      Serial.println(getLocalTime(&t, 5000) ? F("NTP time synced") : F("NTP not synced yet"));
      diagnoseNetwork();
    }
  } else if (!up && wasUp) {
    Serial.println(F("WiFi lost - new readings will be saved to /pending.txt"));
  }
  wasUp = up;
}

void diagnoseNetwork() {
  Serial.println(F("--- network diagnostic ---"));
  Serial.print(F("WiFi: ")); Serial.print(WiFi.status() == WL_CONNECTED ? F("connected") : F("NOT connected"));
  Serial.print(F("  RSSI: ")); Serial.print(WiFi.RSSI()); Serial.print(F(" dBm  IP: ")); Serial.println(WiFi.localIP());
  IPAddress ip;
  if (WiFi.hostByName(SUPABASE_HOST, ip)) { Serial.print(F("DNS ok: ")); Serial.println(ip); }
  else Serial.println(F("DNS FAILED (check SUPABASE_BASE / WiFi internet access)"));
  Serial.println(F("--------------------------"));
}

void printStatus() {
  if (millis() - lastStatus < STATUS_MS) return;
  lastStatus = millis();
  Serial.print(F("[status] WiFi=")); Serial.print(WiFi.status() == WL_CONNECTED ? F("ok") : F("DOWN"));
  Serial.print(F(" RSSI=")); Serial.print(WiFi.RSSI());
  Serial.print(F(" queue=")); Serial.print((int)uxQueueMessagesWaiting(readingQ));
  Serial.print(F(" pending=")); Serial.print(sdOk ? pendingLines : 0);
  Serial.print(F(" ram=")); Serial.print(ramCount);
  Serial.print(F(" sd=")); Serial.print(sdOk ? F("ok") : F("no"));
  Serial.print(F(" upsert=")); Serial.print(useUpsert ? F("on") : F("off"));
  Serial.print(F(" sensorSeen=")); Serial.print(sensorEverSeen ? (long)((millis() - lastSensorFrame) / 1000UL) : -1);
  Serial.println(F("s ago"));
}
