/*
  gsr_stream: Grove GSR v1.2 + onboard IMU -> USB serial, for Seeed XIAO nRF52840 (Sense).

  Board package: "Seeed nRF52 Boards" (Seeeduino:nrf52, the non-mbed core).
  Wiring: Grove GSR SIG -> A5 (P0.05 / AIN3), VCC -> 3V3 (not 5 V: nRF52840 pins are 3.3 V only).

  Every 100 ms it prints one GSR line:

      <millis>,<mean counts>,<std counts>

  These are the mean and standard deviation of 50 conversions taken every 2 ms. A 100 ms boxcar
  has nulls at every multiple of 10 Hz, so both 50 Hz and 60 Hz mains hum and their harmonics
  cancel. The sensor already has a 1.6 Hz RC filter on its output, so 10 Hz is plenty.

  The ADC is referenced to VDD (AR_VDD4). The GSR board is powered from the same 3.3 V rail
  and its output is ratiometric to it, so counts / 16384 is the sensor output as a fraction
  of its supply, independent of the exact supply voltage.

  On the Sense variant it also streams the LSM6DS3TR-C IMU at 104 Hz:

      I,<micros>,<ax>,<ay>,<az>,<gx>,<gy>,<gz>

  These are raw int16 readings; the scale factors are in the header (accel_g_per_lsb,
  gyro_dps_per_lsb). The IMU is polled between ADC conversions, so GSR timing is unaffected.

  Lines starting with '#' are metadata. Send 'i' to print the header again.
*/

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>  // provides Serial (USB CDC) on this core
#include <Wire.h>

static const uint8_t GSR_PIN = A5;
static const uint32_t SUB_PERIOD_US = 2000;   // 500 Hz conversions
static const uint16_t SUBS_PER_SAMPLE = 50;   // -> 10 Hz output, 100 ms boxcar
static const uint8_t ADC_BITS = 14;
static const uint32_t FULL_SCALE = 1UL << ADC_BITS;
static const char *FW_VERSION = "1.1";

// LSM6DS3TR-C on the internal I2C bus (Wire1), powered from a GPIO.
static const uint8_t IMU_ADDR = 0x6A;
static const uint8_t REG_WHO_AM_I = 0x0F, REG_CTRL1_XL = 0x10, REG_CTRL2_G = 0x11, REG_CTRL3_C = 0x12;
static const uint8_t REG_STATUS = 0x1E, REG_OUTX_L_G = 0x22;
static const uint8_t CTRL_104HZ_4G = 0x48;     // ODR 104 Hz, +-4 g
static const uint8_t CTRL_104HZ_1000DPS = 0x48;  // ODR 104 Hz, +-1000 dps
static const char *ACCEL_G_PER_LSB = "0.000122";
static const char *GYRO_DPS_PER_LSB = "0.035";

static uint32_t nextSubUs;
static uint16_t nSubs;
static uint32_t sum;
static uint64_t sumSq;
static uint32_t dropped, imuDropped;
static bool hostConnected, imuPresent;

static bool imuWrite(uint8_t reg, uint8_t val) {
  Wire1.beginTransmission(IMU_ADDR);
  Wire1.write(reg);
  Wire1.write(val);
  return Wire1.endTransmission() == 0;
}

static bool imuRead(uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire1.beginTransmission(IMU_ADDR);
  Wire1.write(reg);
  if (Wire1.endTransmission(false) != 0) return false;
  if (Wire1.requestFrom(IMU_ADDR, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire1.read();
  return true;
}

static void imuBegin() {
  // The IMU's supply comes from P1.08, which needs high-drive mode to power it.
  uint32_t p = g_ADigitalPinMap[PIN_LSM6DS3TR_C_POWER];
  NRF_GPIO_Type *port = p >= 32 ? NRF_P1 : NRF_P0;
  port->PIN_CNF[p & 31] = (GPIO_PIN_CNF_DIR_Output << GPIO_PIN_CNF_DIR_Pos)
                        | (GPIO_PIN_CNF_INPUT_Disconnect << GPIO_PIN_CNF_INPUT_Pos)
                        | (GPIO_PIN_CNF_PULL_Disabled << GPIO_PIN_CNF_PULL_Pos)
                        | (GPIO_PIN_CNF_DRIVE_H0H1 << GPIO_PIN_CNF_DRIVE_Pos)
                        | (GPIO_PIN_CNF_SENSE_Disabled << GPIO_PIN_CNF_SENSE_Pos);
  digitalWrite(PIN_LSM6DS3TR_C_POWER, HIGH);
  delay(20);
  Wire1.begin();
  Wire1.setClock(400000);
  uint8_t who = 0;
  imuPresent = imuRead(REG_WHO_AM_I, &who, 1) && who == 0x6A;
  if (!imuPresent) return;
  imuWrite(REG_CTRL3_C, 0x01);  // software reset
  delay(20);
  imuWrite(REG_CTRL3_C, 0x44);  // block data update + register auto-increment
  imuWrite(REG_CTRL1_XL, CTRL_104HZ_4G);
  imuWrite(REG_CTRL2_G, CTRL_104HZ_1000DPS);
}

static void pollImu() {
  uint8_t st;
  if (!imuRead(REG_STATUS, &st, 1) || (st & 0x03) != 0x03) return;  // wait for both accel and gyro
  uint8_t b[12];
  if (!imuRead(REG_OUTX_L_G, b, sizeof b)) return;
  if (!hostConnected) return;
  if (Serial.availableForWrite() < 56) {
    imuDropped++;
    return;
  }
  int16_t v[6];
  for (uint8_t i = 0; i < 6; i++) v[i] = (int16_t)(b[2 * i] | (b[2 * i + 1] << 8));
  // Registers are gyro XYZ then accel XYZ; send accel first.
  Serial.print("I,");
  Serial.print(micros());
  for (uint8_t i = 3; i < 6; i++) { Serial.print(','); Serial.print(v[i]); }
  for (uint8_t i = 0; i < 3; i++) { Serial.print(','); Serial.print(v[i]); }
  Serial.println();
}

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
  Serial.print(dropped);
  if (imuPresent) {
    Serial.print(" imu=lsm6ds3trc imu_odr_hz=104 accel_g_per_lsb=");
    Serial.print(ACCEL_G_PER_LSB);
    Serial.print(" gyro_dps_per_lsb=");
    Serial.print(GYRO_DPS_PER_LSB);
    Serial.print(" imu_dropped=");
    Serial.println(imuDropped);
  } else {
    Serial.println(" imu=none");
  }
  Serial.println("#cols=t_ms,counts,counts_sd");
  if (imuPresent) Serial.println("#cols_imu=I,t_us,ax,ay,az,gx,gy,gz");
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

  imuBegin();

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
  // Poll the IMU right after a conversion: the ~0.5 ms I2C read fits well inside the 2 ms gap.
  if (imuPresent) pollImu();
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
