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
  thingSpeakReadApiKey: "LNUPSJO0L6AHYDAX",

  refreshIntervalMs: 60 * 1000,
  trendWindowMinutes: 180,

  arso: Object.freeze({
    rainLatest: "https://meteo.arso.gov.si/uploads/probase/www/observ/radar/si0-rm.gif",
    rainAnimation: "https://meteo.arso.gov.si/uploads/probase/www/observ/radar/si0-rm-anim.gif",
    rainPage: "https://meteo.arso.gov.si/met/sl/weather/observ/radar/",
    hailLatest: "https://meteo.arso.gov.si/uploads/probase/www/warning/graphic/warning_hp_pda_latest.gif",
    hailAnimation: "https://meteo.arso.gov.si/uploads/probase/www/warning/graphic/warning_hp_pda_anim.gif",
    hailPage: "https://meteo.arso.gov.si/pda/warning/hail/hpanim/"
  })
});
