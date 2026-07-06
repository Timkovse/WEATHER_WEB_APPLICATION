// Vse nastavitve spletne aplikacije so na enem mestu.
// Write API Key NE sodi v spletno aplikacijo; ostane samo na ESP32.
window.APP_CONFIG = Object.freeze({
  locationName: "Kidričevo",
  latitude: 46.405014,
  longitude: 15.794723,
  timezone: "Europe/Ljubljana",
  knownAltitudeM: 239,
  stationStartDate: "2026-07-06",

  thingSpeakChannelId: "3422725",
  thingSpeakReadApiKey: "",

  refreshIntervalMs: 60 * 1000,
  trendWindowMinutes: 180,

  arso: Object.freeze({
    rainLatest: "https://www.meteo.si/uploads/probase/www/observ/radar/si0-rm.gif",
    rainAnimation: "https://www.meteo.si/uploads/probase/www/observ/radar/si0-rm-anim.gif",
    rainPage: "https://www.meteo.si/met/sl/weather/observ/radar/",
    hailLatest: "https://www.meteo.si/uploads/probase/www/warning/graphic/warning_hp_pda_latest.gif",
    hailAnimation: "https://www.meteo.si/uploads/probase/www/warning/graphic/warning_hp_pda_anim.gif",
    hailPage: "https://www.meteo.si/pda/warning/hail/hpanim/"
  })
});
