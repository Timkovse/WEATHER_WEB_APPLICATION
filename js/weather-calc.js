window.WeatherCalc = Object.freeze({
  dewPoint(tempC, humidityPct) {
    const a = 17.62;
    const b = 243.12;
    const rh = Math.min(100, Math.max(0.1, humidityPct));
    const gamma = (a * tempC) / (b + tempC) + Math.log(rh / 100);
    return (b * gamma) / (a - gamma);
  },

  heatIndex(tempC, humidityPct) {
    if (tempC < 26.7) return tempC;
    const T = (tempC * 9) / 5 + 32;
    const R = humidityPct;
    const HI =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;
    return ((HI - 32) * 5) / 9;
  },

  windChill(tempC, windKmh) {
    if (tempC > 10 || windKmh <= 4.8) return tempC;
    return 13.12 + 0.6215 * tempC - 11.37 * Math.pow(windKmh, 0.16) +
      0.3965 * tempC * Math.pow(windKmh, 0.16);
  },

  feelsLike(tempC, humidityPct, windKmh = 0) {
    if (tempC >= 26.7) return this.heatIndex(tempC, humidityPct);
    if (tempC <= 10 && windKmh > 4.8) return this.windChill(tempC, windKmh);
    return tempC;
  },

  seaLevelPressure(measuredPressureHPa, altitudeM) {
    return measuredPressureHPa / Math.pow(1 - altitudeM / 44330, 5.255);
  },

  pressureTrend(samples) {
    if (samples.length < 3) {
      return { rate3h: 0, trend: "unknown", forecast: "unknown" };
    }

    const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];
    const hours = (newest.timestamp - oldest.timestamp) / 3_600_000;
    if (hours <= 0) return { rate3h: 0, trend: "unknown", forecast: "unknown" };

    const rate3h = ((newest.pressure - oldest.pressure) / hours) * 3;
    let trend;
    if (rate3h >= 3) trend = "rising_fast";
    else if (rate3h >= 1) trend = "rising";
    else if (rate3h <= -3) trend = "falling_fast";
    else if (rate3h <= -1) trend = "falling";
    else trend = "steady";

    const forecastMap = {
      rising_fast: "improving",
      rising: "improving",
      steady: "stable",
      falling: "unsettled",
      falling_fast: "stormy"
    };
    return { rate3h, trend, forecast: forecastMap[trend] };
  }
});
