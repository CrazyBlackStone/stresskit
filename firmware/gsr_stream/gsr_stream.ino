/*
  gsr_stream: Grove GSR v1.2 -> USB serial, for Seeed XIAO nRF52840 (Sense).

  Board package: "Seeed nRF52 Boards" (Seeeduino:nrf52, the non-mbed core).
  Wiring: Grove GSR SIG -> A5 (P0.05 / AIN3), VCC -> 3V3 (not 5 V: nRF52840 pins are 3.3 V only).

  Every 100 ms it prints one line:

      <millis>,<mean counts>,<std counts>

  These are the mean and standard deviation of 50 conversions taken every 2 ms. A 100 ms boxcar
  has nulls at every multiple of 10 Hz, so both 50 Hz and 60 Hz mains hum and their harmonics
  cancel. The sensor already has a 1.6 Hz RC filter on its output, so 10 Hz is plenty.

  The ADC is referenced to VDD (AR_VDD4). The GSR board is powered from the same 3.3 V rail
  and its output is ratiometric to it, so counts / 16384 is the sensor output as a fraction
  of its supply, independent of the exact supply voltage.

  Lines starting with '#' are metadata. Send 'i' to print the header again.
*/

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>  // provides Serial (USB CDC) on this core

static const uint8_t GSR_PIN = A5;
static const uint32_t SUB_PERIOD_US = 2000;   // 500 Hz conversions
static const uint16_t SUBS_PER_SAMPLE = 50;   // -> 10 Hz output, 100 ms boxcar
static const uint8_t ADC_BITS = 14;
static const uint32_t FULL_SCALE = 1UL << ADC_BITS;
static const char *FW_VERSION = "1.0";

static uint32_t nextSubUs;
static uint16_t nSubs;
static uint32_t sum;
static uint64_t sumSq;
static uint32_t dropped;
static bool hostConnected;

static void printHeader() {
  Serial.print("#gsr_stream v");
  Serial.print(FW_VERSION);
  Serial.print(" board=xiao_nrf52840 pin=A5 fs_hz=");
  Serial.print(1000000UL / (SUB_PERIOD_US * SUBS_PER_SAMPLE));
  Serial.print(" adc_bits=");
  Serial.print(ADC_BITS);
  Serial.print(" full_scale=");
  Serial.print(FULL_SCALE);
  Serial.print(" ref=vdd sub_samples=");
  Serial.print(SUBS_PER_SAMPLE);
  Serial.print(" dropped=");
  Serial.println(dropped);
  Serial.println("#cols=t_ms,counts,counts_sd");
}

void setup() {
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  digitalWrite(LED_RED, HIGH);   // the XIAO's RGB LED is active-low: HIGH = off
  digitalWrite(LED_BLUE, HIGH);
  digitalWrite(LED_GREEN, LOW);  // brief green flash at boot
  delay(150);
  digitalWrite(LED_GREEN, HIGH);

  Serial.begin(115200);

  analogReference(AR_VDD4);
  analogReadResolution(ADC_BITS);
  analogOversampling(4);         // 4x hardware averaging per conversion (burst mode)
  analogSampleTime(40);          // long acquisition: SIG has a 1 MOhm source resistance
  analogCalibrateOffset();

  nextSubUs = micros();
}

void loop() {
  // LED: steady green while a host has the port open, off otherwise. It changes only on
  // connect/disconnect so it never injects switching noise into the measurement.
  bool connected = (bool)Serial;
  if (connected != hostConnected) {
    hostConnected = connected;
    digitalWrite(LED_GREEN, connected ? LOW : HIGH);
    if (connected) printHeader();
  }

  while (Serial.available()) {
    int c = Serial.read();
    if (c == 'i' || c == 'I') printHeader();
  }

  uint32_t now = micros();
  if ((int32_t)(now - nextSubUs) < 0) return;
  // If we fell far behind (e.g. a long USB stall), resynchronise instead of bursting.
  if ((int32_t)(now - nextSubUs) > (int32_t)(10 * SUB_PERIOD_US)) nextSubUs = now;
  nextSubUs += SUB_PERIOD_US;

  uint32_t v = analogRead(GSR_PIN);
  sum += v;
  sumSq += (uint64_t)v * v;
  if (++nSubs < SUBS_PER_SAMPLE) return;

  double n = nSubs;
  double mean = sum / n;
  double var = ((double)sumSq - (double)sum * (double)sum / n) / (n - 1.0);
  double sd = var > 0 ? sqrt(var) : 0.0;
  nSubs = 0;
  sum = 0;
  sumSq = 0;

  if (!hostConnected) return;
  // Never block sampling on a slow host: drop the line if the USB buffer is full.
  if (Serial.availableForWrite() < 32) {
    dropped++;
    return;
  }
  Serial.print(millis());
  Serial.print(',');
  Serial.print(mean, 2);
  Serial.print(',');
  Serial.println(sd, 2);
}
