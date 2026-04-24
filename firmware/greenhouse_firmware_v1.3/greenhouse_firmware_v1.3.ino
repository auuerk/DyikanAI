// ============================================================
// AgriControl — Smart Greenhouse Firmware
// Version:  1.3
// Date:     2026-03-24
// Hardware: Arduino Mega 2560 + W5100 Ethernet Shield
//
// MQTT Topics:
//   Publishes: greenhouse/mega1/telemetry  (JSON)
//   Subscribes: greenhouse/mega1/command   (JSON)
//
// Pin Summary:
//   DHT11        → D42
//   DS18B20      → D48
//   Soil sensor  → A12
//   Light sensor → A13
//   Relay Pump   → D45
//   Relay Lamp   → D47
//   Relay Heater → D41
//   Relay Fan    → D43
//
// Relay logic: HIGH = ON, LOW = OFF
// Pump safety: auto-off after 10 seconds
//
// Calibration:
//   DHT11 temp    — reference offset -0.3°C (Report #6, 2026-03-03)
//   Soil moisture — 4-point piecewise linear, Sensor 1, peat soil (Report #5, 2026-02-22)
//   DS18B20       — within factory spec ±0.5°C, no correction applied (Report #6)
//   Light         — no absolute calibration, raw ADC reported
// ============================================================

#include <SPI.h>
#include <Ethernet.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <string.h>

// ===================== PIN DEFINITIONS =====================
#define DHTPIN        42
#define DHTTYPE       DHT11
#define SOIL_PIN      A12
#define LIGHT_PIN     A13
#define DS18B20_PIN   48
#define RELAY_PUMP    45
#define RELAY_LAMP    47
#define RELAY_HEATER  41
#define RELAY_FAN     43

// ===================== NETWORK =====================
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01 };
IPAddress megaIP   (192, 168, 1, 102);
IPAddress gateway  (192, 168, 1,   1);
IPAddress dns      (192, 168, 1,   1);
IPAddress subnet   (255, 255, 255, 0);
IPAddress mqttServer(192, 168, 1, 101);

EthernetClient ethClient;
PubSubClient   mqttClient(ethClient);

const char* MQTT_TOPIC_TELE = "greenhouse/mega1/telemetry";
const char* MQTT_TOPIC_CMD  = "greenhouse/mega1/command";

// ===================== CALIBRATION =====================
// DHT11 temperature offset (Report #6)
// Sensor reads +0.3°C high — subtract to correct.
// Raw value is not stored or published — offset is fixed and documented.
// Humidity uncorrected — within factory ±5% RH tolerance.
#define DHT11_TEMP_OFFSET  -0.3f

// Soil moisture — Sensor 1, peat soil (Report #5)
// 4-point piecewise linear calibration.
// ADC decreases as moisture increases (capacitive sensor behaviour).
// Max output is 60% — empirically determined saturation point for this soil.
const int SOIL_ADC[4] = { 427, 402, 313, 199 };
const int SOIL_PCT[4] = {   0,  20,  40,  60 };

// ===================== TIMING =====================
const unsigned long PUMP_TIMEOUT_MS    = 10000;  // 10 s pump auto-off
const unsigned long RECONNECT_INTERVAL =  5000;  // 5 s between MQTT attempts

// Sensor read intervals
const unsigned long INTERVAL_AIR_MS   = 30000;  // DHT11 — 30 s
const unsigned long INTERVAL_SLOW_MS  = 60000;  // DS18B20 + soil — 60 s
const unsigned long INTERVAL_LIGHT_MS = 30000;  // light — 30 s

// Telemetry publish intervals
const unsigned long TELE_SENSOR_MS   = 30000;  // sensor data — 30 s
const unsigned long TELE_ACTUATOR_MS =  2000;  // actuator states — 2 s

// Timers
unsigned long pumpStartTime        = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastAirRead          = 0;
unsigned long lastSlowRead         = 0;
unsigned long lastLightRead        = 0;
unsigned long lastTeleSensor       = 0;
unsigned long lastTeleActuator     = 0;

bool isPumpRunning = false;

// ===================== SENSOR STATE =====================
// Last known good values — updated only when read succeeds.
// air_temp_c is stored already corrected; raw DHT11 value is not retained.
float lastAirTemp  = NAN;   // DHT11, offset-corrected
float lastAirHum   = NAN;   // DHT11 humidity, uncorrected
float lastSoilTemp = NAN;   // DS18B20, no correction needed
int   lastSoilRaw  = 0;     // soil ADC average
float lastSoilPct  = -1.0;  // soil moisture, calibrated %
int   lastLightRaw = 0;     // light ADC average

// ===================== SENSORS =====================
DHT dht(DHTPIN, DHTTYPE);
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

// ===================== ANALOG AVERAGING =====================
// Returns average of 10 rapid ADC samples to reduce ADC jitter.
// Used for analog sensors only (soil moisture, light).
// DHT11 and DS18B20 are digital and handle their own conversion internally.
int readAnalogAvg(int pin) {
  long sum = 0;
  for (int i = 0; i < 10; i++) sum += analogRead(pin);
  return (int)(sum / 10);
}

// ===================== SOIL MOISTURE CALIBRATION =====================
// Piecewise linear interpolation between 4 calibration points.
// More accurate than map() for the non-linear peat soil response.
// Returns moisture percentage (0.0 – 60.0).
// Values outside calibration range are clamped to endpoints.
float soilADCtoPct(int adc) {
  if (adc >= SOIL_ADC[0]) return 0.0;
  if (adc <= SOIL_ADC[3]) return 60.0;
  for (int i = 0; i < 3; i++) {
    if (adc <= SOIL_ADC[i] && adc >= SOIL_ADC[i + 1]) {
      float slope = (float)(SOIL_PCT[i + 1] - SOIL_PCT[i])
                  / (float)(SOIL_ADC[i + 1] - SOIL_ADC[i]);
      return SOIL_PCT[i] + slope * (adc - SOIL_ADC[i]);
    }
  }
  return -1.0;
}

// ===================== RELAY HELPERS =====================
void relayOn (uint8_t pin) { digitalWrite(pin, HIGH); }
void relayOff(uint8_t pin) { digitalWrite(pin, LOW);  }

void stopPump() {
  relayOff(RELAY_PUMP);
  isPumpRunning = false;
  Serial.println("PUMP: OFF");
}

void setLamp  (bool on) { on ? relayOn(RELAY_LAMP)   : relayOff(RELAY_LAMP);   Serial.println(on ? "LAMP: ON"   : "LAMP: OFF");   }
void setHeater(bool on) { on ? relayOn(RELAY_HEATER) : relayOff(RELAY_HEATER); Serial.println(on ? "HEATER: ON" : "HEATER: OFF"); }
void setFan   (bool on) { on ? relayOn(RELAY_FAN)    : relayOff(RELAY_FAN);    Serial.println(on ? "FAN: ON"    : "FAN: OFF");    }

// ===================== COMMAND PARSING =====================
// Finds integer value for a key in a flat JSON string.
// Boundary check prevents substring false matches e.g. "fan" vs "fan_speed".
bool jsonFindInt(const char* json, const char* key, int &out) {
  char pattern[32];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* p = strstr(json, pattern);
  if (!p) return false;
  const char* after = p + strlen(pattern);
  while (*after == ' ' || *after == '\t') after++;
  if (*after != ':') return false;
  after++;
  while (*after == ' ' || *after == '\t') after++;
  out = atoi(after);
  return true;
}

void handleCommand(const char* json) {
  // Command format: {"actuator": "pump", "state": 1, "source": "...", "timestamp": "..."}
  // Extract actuator name and state value
  char actuator[16] = "";
  int  state        = -1;

  // Find "actuator" string value
  const char* a = strstr(json, "\"actuator\"");
  if (a) {
    a = strchr(a, ':');
    if (a) {
      while (*a == ':' || *a == ' ' || *a == '"') a++;
      int i = 0;
      while (*a && *a != '"' && i < 15) actuator[i++] = *a++;
      actuator[i] = '\0';
    }
  }

  // Find "state" integer value
  int stateVal;
  if (jsonFindInt(json, "state", stateVal)) state = stateVal;

  if (strlen(actuator) == 0 || state == -1) return;

  if      (strcmp(actuator, "pump")   == 0) {
    if (state == 1) {
      relayOn(RELAY_PUMP);
      isPumpRunning = true;
      pumpStartTime = millis();
      Serial.println("PUMP: ON");
    } else { stopPump(); }
  }
  else if (strcmp(actuator, "lamp")   == 0) setLamp  (state == 1);
  else if (strcmp(actuator, "heater") == 0) setHeater(state == 1);
  else if (strcmp(actuator, "fan")    == 0) setFan   (state == 1);
}

// ===================== MQTT =====================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  static char msg[256];
  if (length >= sizeof(msg)) length = sizeof(msg) - 1;
  memcpy(msg, payload, length);
  msg[length] = '\0';
  if (strcmp(topic, MQTT_TOPIC_CMD) == 0) {
    Serial.print("[CMD] ");
    Serial.println(msg);
    handleCommand(msg);
  }
}

void reconnectMQTT() {
  unsigned long now = millis();
  if (now - lastReconnectAttempt < RECONNECT_INTERVAL) return;
  lastReconnectAttempt = now;
  Serial.print("[MQTT] connecting... ");
  if (mqttClient.connect("MegaGreenhouse01", "mqttuser", "greenhouse2026")) {
    Serial.println("connected");
    mqttClient.subscribe(MQTT_TOPIC_CMD);
  } else {
    Serial.print("failed, rc=");
    Serial.print(mqttClient.state());
    Serial.println(" — will retry in 5s");
  }
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(9600);
  delay(1000);

  pinMode(53, OUTPUT); digitalWrite(53, HIGH);
  pinMode( 4, OUTPUT); digitalWrite( 4, HIGH);
  pinMode(10, OUTPUT); digitalWrite(10, HIGH);

  pinMode(RELAY_PUMP,   OUTPUT); relayOff(RELAY_PUMP);
  pinMode(RELAY_LAMP,   OUTPUT); relayOff(RELAY_LAMP);
  pinMode(RELAY_HEATER, OUTPUT); relayOff(RELAY_HEATER);
  pinMode(RELAY_FAN,    OUTPUT); relayOff(RELAY_FAN);

  dht.begin();
  ds18b20.begin();

  Ethernet.begin(mac, megaIP, dns, gateway, subnet);
  delay(1500);
  Serial.print("[NET] IP: ");
  Serial.println(Ethernet.localIP());

  mqttClient.setServer(mqttServer, 1883);
  mqttClient.setCallback(onMqttMessage);

  Serial.println("[SYS] AgriControl v1.3 ready");
}

// ===================== LOOP =====================
void loop() {
  unsigned long now = millis();

  // 1. MQTT keepalive / reconnect (non-blocking)
  if (!mqttClient.connected()) reconnectMQTT();
  mqttClient.loop();

  // 2. Pump safety shutoff
  if (isPumpRunning && (now - pumpStartTime >= PUMP_TIMEOUT_MS)) {
    Serial.println("[SAFETY] Pump 10s limit — auto-off");
    stopPump();
  }

  // 3. Sensor reads — each on its own interval

  // Air temp + humidity (DHT11 — every 30s)
  if (now - lastAirRead >= INTERVAL_AIR_MS) {
    lastAirRead = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) lastAirTemp = t + DHT11_TEMP_OFFSET;
    if (!isnan(h)) lastAirHum  = h;
  }

  // Soil moisture + soil temp (every 60s)
  if (now - lastSlowRead >= INTERVAL_SLOW_MS) {
    lastSlowRead = now;
    ds18b20.requestTemperatures();
    float st = ds18b20.getTempCByIndex(0);
    if (st > -100.0) lastSoilTemp = st;
    lastSoilRaw = readAnalogAvg(SOIL_PIN);
    lastSoilPct = soilADCtoPct(lastSoilRaw);
  }

  // Light (every 30s)
  if (now - lastLightRead >= INTERVAL_LIGHT_MS) {
    lastLightRead = now;
    lastLightRaw = readAnalogAvg(LIGHT_PIN);
  }

  // 4. Sensor telemetry publish (every 30s)
  if (now - lastTeleSensor >= TELE_SENSOR_MS) {
    lastTeleSensor = now;

    char airTempStr[10], airHumStr[10], soilTempStr[10], soilPctStr[10];

    if (!isnan(lastAirTemp))    dtostrf(lastAirTemp,  0, 2, airTempStr);
    else strcpy(airTempStr,  "null");

    if (!isnan(lastAirHum))     dtostrf(lastAirHum,   0, 1, airHumStr);
    else strcpy(airHumStr,   "null");

    if (lastSoilTemp > -100.0)  dtostrf(lastSoilTemp, 0, 2, soilTempStr);
    else strcpy(soilTempStr, "null");

    if (lastSoilPct >= 0.0)     dtostrf(lastSoilPct,  0, 1, soilPctStr);
    else strcpy(soilPctStr,  "null");

    char payload[256];
    snprintf(payload, sizeof(payload),
      "{"
        "\"air_temp_c\":%s,"
        "\"air_humidity_pct\":%s,"
        "\"soil_moisture_raw\":%d,"
        "\"soil_moisture_pct\":%s,"
        "\"soil_temp_c\":%s,"
        "\"light_raw\":%d"
      "}",
      airTempStr, airHumStr,
      lastSoilRaw, soilPctStr, soilTempStr,
      lastLightRaw
    );

    mqttClient.publish(MQTT_TOPIC_TELE, payload);
    Serial.print("[TELE:sensor] ");
    Serial.println(payload);
  }

  // 5. Actuator state publish (every 2s)
  if (now - lastTeleActuator >= TELE_ACTUATOR_MS) {
    lastTeleActuator = now;

    char payload[128];
    snprintf(payload, sizeof(payload),
      "{"
        "\"pump\":%d,"
        "\"lamp\":%d,"
        "\"heater\":%d,"
        "\"fan\":%d"
      "}",
      (digitalRead(RELAY_PUMP)   == HIGH),
      (digitalRead(RELAY_LAMP)   == HIGH),
      (digitalRead(RELAY_HEATER) == HIGH),
      (digitalRead(RELAY_FAN)    == HIGH)
    );

    mqttClient.publish(MQTT_TOPIC_TELE, payload);
    Serial.print("[TELE:actuator] ");
    Serial.println(payload);
  }
}
