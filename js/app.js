(() => {
  "use strict";

  const CONFIG = window.APP_CONFIG;
  const Calc = window.WeatherCalc;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    activeTab: "current",
    local: null,
    portal: null,
    forecast: null,
    trend: null,
    radarType: "rain",
    radarMode: "animation",
    historyRange: 1,
    historyMetric: "temperature",
    historyData: [],
    historyCache: new Map(),
    yearData: null,
    loading: false
  };

  const HISTORY_RANGES = {
    1: { average: 10, label: "Zadnjih 24 ur", note: "10-minutna povprečja" },
    7: { average: 60, label: "Zadnjih 7 dni", note: "Urna povprečja" },
    31: { average: 240, label: "Zadnjih 31 dni", note: "4-urna povprečja" }
  };

  const METRICS = {
    temperature: { label: "Temperatura", key: "temperature", unit: "°C", decimals: 1 },
    humidity: { label: "Vlaga", key: "humidity", unit: "%", decimals: 0 },
    pressure: { label: "Tlak na morski gladini", key: "pressure", unit: "hPa", decimals: 0 }
  };

  const TREND_TEXT = {
    improving: ["Vreme se izboljšuje", "Tlak v zadnjih treh urah narašča."],
    stable: ["Stabilno vreme", "Tlak se bistveno ne spreminja."],
    unsettled: ["Možne padavine", "Tlak pada; vreme lahko postane bolj nestanovitno."],
    stormy: ["Hitro poslabšanje", "Tlak hitro pada; možen je prehod fronte."],
    unknown: ["Zbiram podatke …", "Za trend so potrebne najmanj tri meritve skozi daljše obdobje."]
  };

  const WEATHER_CODES = {
    0: ["Jasno", "☀️"],
    1: ["Pretežno jasno", "🌤️"],
    2: ["Delno oblačno", "⛅"],
    3: ["Oblačno", "☁️"],
    45: ["Megla", "🌫️"],
    48: ["Megla z ivjem", "🌫️"],
    51: ["Rahlo rosenje", "🌦️"],
    53: ["Rosenje", "🌦️"],
    55: ["Močno rosenje", "🌧️"],
    56: ["Rahlo poledeno rosenje", "🌧️"],
    57: ["Poledeno rosenje", "🌧️"],
    61: ["Rahel dež", "🌦️"],
    63: ["Dež", "🌧️"],
    65: ["Močan dež", "🌧️"],
    66: ["Rahel poleden dež", "🌧️"],
    67: ["Poleden dež", "🌧️"],
    71: ["Rahlo sneženje", "🌨️"],
    73: ["Sneženje", "🌨️"],
    75: ["Močno sneženje", "❄️"],
    77: ["Snežna zrna", "🌨️"],
    80: ["Rahle plohe", "🌦️"],
    81: ["Plohe", "🌧️"],
    82: ["Močne plohe", "⛈️"],
    85: ["Rahle snežne plohe", "🌨️"],
    86: ["Močne snežne plohe", "🌨️"],
    95: ["Nevihta", "⛈️"],
    96: ["Nevihta z manjšo točo", "⛈️"],
    99: ["Nevihta z močno točo", "⛈️"]
  };

  function weatherInfo(code) {
    return WEATHER_CODES[Number(code)] || ["Neznano", "—"];
  }

  function finite(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value, decimals = 1) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function formatNumber(value, decimals = 1) {
    if (!Number.isFinite(value)) return "--";
    return value.toLocaleString("sl-SI", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatSigned(value, unit, decimals = 1) {
    if (!Number.isFinite(value)) return "--";
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatNumber(value, decimals)} ${unit}`;
  }

  function formatDate(date, options = {}) {
    return new Intl.DateTimeFormat("sl-SI", {
      timeZone: CONFIG.timezone,
      ...options
    }).format(date);
  }

  function dateKey(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CONFIG.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function showBanner(message, autoHide = true) {
    const banner = $("#status-banner");
    banner.textContent = message;
    banner.hidden = false;
    if (autoHide) {
      window.clearTimeout(showBanner.timer);
      showBanner.timer = window.setTimeout(() => { banner.hidden = true; }, 6500);
    }
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  async function fetchJson(url, timeoutMs = 16000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function thingSpeakUrl(params = {}) {
    const url = new URL(`https://api.thingspeak.com/channels/${CONFIG.thingSpeakChannelId}/feeds.json`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    if (CONFIG.thingSpeakReadApiKey) url.searchParams.set("api_key", CONFIG.thingSpeakReadApiKey);
    return url.toString();
  }

  function parseThingSpeakFeed(feed) {
    const temperature = finite(feed.field1);
    const humidity = finite(feed.field2);
    const stationPressure = finite(feed.field3);
    const timestamp = new Date(feed.created_at);
    if (!Number.isFinite(timestamp.getTime()) || temperature === null || humidity === null || stationPressure === null) return null;
    return {
      timestamp,
      entryId: Number(feed.entry_id) || null,
      temperature,
      humidity,
      stationPressure,
      pressure: Calc.seaLevelPressure(stationPressure, CONFIG.knownAltitudeM)
    };
  }

  async function fetchLatestLocal() {
    const data = await fetchJson(thingSpeakUrl({ results: 1 }));
    const reading = data.feeds?.length ? parseThingSpeakFeed(data.feeds[0]) : null;
    if (!reading) throw new Error("ThingSpeak kanal nima veljavne meritve.");
    return reading;
  }

  async function fetchTrend() {
    const data = await fetchJson(thingSpeakUrl({ minutes: CONFIG.trendWindowMinutes }));
    const samples = (data.feeds || [])
      .map(parseThingSpeakFeed)
      .filter(Boolean)
      .map((item) => ({ timestamp: item.timestamp, pressure: item.pressure }));
    return Calc.pressureTrend(samples);
  }

  function openMeteoUrl() {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", CONFIG.latitude);
    url.searchParams.set("longitude", CONFIG.longitude);
    url.searchParams.set("timezone", CONFIG.timezone);
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("current", [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m"
    ].join(","));
    url.searchParams.set("hourly", [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_gusts_10m"
    ].join(","));
    url.searchParams.set("daily", [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "sunrise",
      "sunset",
      "uv_index_max",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max"
    ].join(","));
    return url.toString();
  }

  async function fetchOpenMeteo() {
    const data = await fetchJson(openMeteoUrl());
    if (!data.current || !data.daily || !data.hourly) throw new Error("Open-Meteo ni vrnil popolnih podatkov.");
    return data;
  }

  function setStationFreshness(timestamp) {
    const ageMinutes = Math.max(0, (Date.now() - timestamp.getTime()) / 60000);
    const pill = $("#local-freshness");
    const dot = $("#station-dot");
    pill.className = "status-pill";
    dot.className = "live-dot";
    if (ageMinutes <= 10) {
      pill.textContent = "V živo";
      pill.classList.add("ok");
      dot.classList.add("online");
      setText("#station-status", "Postaja pošilja meritve");
    } else if (ageMinutes <= 60) {
      pill.textContent = `${Math.round(ageMinutes)} min nazaj`;
      pill.classList.add("warn");
      dot.classList.add("stale");
      setText("#station-status", "Meritev ni sveža");
    } else {
      pill.textContent = "Brez svežih podatkov";
      pill.classList.add("error");
      dot.classList.add("offline");
      setText("#station-status", "Postaja je morda brez povezave");
    }
  }

  function renderCurrent() {
    const local = state.local;
    const portal = state.portal?.current;

    if (local) {
      const dewPoint = Calc.dewPoint(local.temperature, local.humidity);
      const feels = Calc.feelsLike(local.temperature, local.humidity);
      setText("#local-temp", formatNumber(local.temperature, 1));
      setText("#local-humidity", formatNumber(local.humidity, 0));
      setText("#local-pressure", formatNumber(local.pressure, 0));
      setText("#local-dewpoint", formatNumber(dewPoint, 1));
      setText("#local-feels", formatNumber(feels, 1));
      setText("#local-time", formatDate(local.timestamp, { hour: "2-digit", minute: "2-digit" }));
      setStationFreshness(local.timestamp);
    }

    if (portal) {
      const [condition, symbol] = weatherInfo(portal.weather_code);
      setText("#portal-temp", formatNumber(finite(portal.temperature_2m), 1));
      setText("#portal-feels", formatNumber(finite(portal.apparent_temperature), 1));
      setText("#portal-humidity", formatNumber(finite(portal.relative_humidity_2m), 0));
      setText("#portal-pressure", formatNumber(finite(portal.pressure_msl), 0));
      setText("#portal-wind", formatNumber(finite(portal.wind_speed_10m), 0));
      setText("#portal-gust", formatNumber(finite(portal.wind_gusts_10m), 0));
      setText("#portal-rain", formatNumber(finite(portal.precipitation), 1));
      setText("#portal-cloud", formatNumber(finite(portal.cloud_cover), 0));
      setText("#portal-condition", condition);
      setText("#portal-weather-icon", symbol);
    }

    if (local && portal) {
      const portalTemp = finite(portal.temperature_2m);
      const portalHumidity = finite(portal.relative_humidity_2m);
      const portalPressure = finite(portal.pressure_msl);
      setText("#diff-temp", portalTemp === null ? "--" : formatSigned(local.temperature - portalTemp, "°C", 1));
      setText("#diff-humidity", portalHumidity === null ? "--" : formatSigned(local.humidity - portalHumidity, "%", 0));
      setText("#diff-pressure", portalPressure === null ? "--" : formatSigned(local.pressure - portalPressure, "hPa", 0));
    }

    if (state.trend) {
      const texts = TREND_TEXT[state.trend.forecast] || TREND_TEXT.unknown;
      setText("#trend-label", texts[0]);
      const rate = state.trend.forecast === "unknown" ? "" : ` Sprememba: ${formatSigned(state.trend.rate3h, "hPa / 3 h", 1)}.`;
      setText("#trend-detail", `${texts[1]}${rate}`);
      const angle = (Math.max(-6, Math.min(6, state.trend.rate3h)) / 6) * 70;
      $("#barometer-needle").style.transform = `rotate(${angle}deg)`;
    }

    const newest = [local?.timestamp, portal?.time ? new Date(portal.time) : null]
      .filter((date) => date && Number.isFinite(date.getTime()))
      .sort((a, b) => b - a)[0];
    if (newest) {
      setText("#current-updated", `Posodobljeno ${formatDate(newest, { hour: "2-digit", minute: "2-digit" })}`);
    }
  }

  function renderForecast() {
    const daily = state.forecast?.daily;
    if (!daily?.time?.length) return;
    const container = $("#forecast-days");
    container.innerHTML = daily.time.map((dateString, index) => {
      const date = new Date(`${dateString}T12:00:00`);
      const [condition, symbol] = weatherInfo(daily.weather_code[index]);
      const dayName = index === 0 ? "Danes" : formatDate(date, { weekday: "short" });
      const rainChance = finite(daily.precipitation_probability_max[index]);
      return `
        <button class="forecast-day${index === 0 ? " active" : ""}" type="button" data-forecast-index="${index}" aria-label="${dayName}: ${condition}">
          <p class="forecast-day-name">${dayName}</p>
          <p class="forecast-date">${formatDate(date, { day: "numeric", month: "short" })}</p>
          <div class="forecast-icon" aria-hidden="true">${symbol}</div>
          <div class="forecast-temp"><strong>${formatNumber(finite(daily.temperature_2m_max[index]), 0)}°</strong><span>${formatNumber(finite(daily.temperature_2m_min[index]), 0)}°</span></div>
          <div class="forecast-rain">💧 ${formatNumber(rainChance, 0)}% · ${formatNumber(finite(daily.precipitation_sum[index]), 1)} mm</div>
        </button>`;
    }).join("");

    $$("[data-forecast-index]", container).forEach((button) => {
      button.addEventListener("click", () => selectForecastDay(Number(button.dataset.forecastIndex)));
    });
    selectForecastDay(0);
  }

  function selectForecastDay(index) {
    const daily = state.forecast?.daily;
    const hourly = state.forecast?.hourly;
    if (!daily || !hourly || !daily.time[index]) return;

    $$("[data-forecast-index]").forEach((button) => button.classList.toggle("active", Number(button.dataset.forecastIndex) === index));
    const dateString = daily.time[index];
    const date = new Date(`${dateString}T12:00:00`);
    const [condition] = weatherInfo(daily.weather_code[index]);
    setText("#forecast-detail-title", `${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}`);
    setText("#forecast-detail-summary", `${condition} · sunki do ${formatNumber(finite(daily.wind_gusts_10m_max[index]), 0)} km/h · UV ${formatNumber(finite(daily.uv_index_max[index]), 1)}`);

    const items = hourly.time.map((time, hourlyIndex) => ({
      time,
      temperature: finite(hourly.temperature_2m[hourlyIndex]),
      feels: finite(hourly.apparent_temperature[hourlyIndex]),
      rainChance: finite(hourly.precipitation_probability[hourlyIndex]),
      rain: finite(hourly.precipitation[hourlyIndex]),
      weatherCode: hourly.weather_code[hourlyIndex],
      wind: finite(hourly.wind_speed_10m[hourlyIndex]),
      gust: finite(hourly.wind_gusts_10m[hourlyIndex])
    })).filter((item) => item.time.startsWith(dateString) && Number(item.time.slice(11, 13)) % 3 === 0);

    $("#hourly-forecast").innerHTML = items.map((item) => {
      const [label, symbol] = weatherInfo(item.weatherCode);
      return `
        <article class="hour-card" title="${label}; občutek ${formatNumber(item.feels, 1)} °C">
          <time>${item.time.slice(11, 16)}</time>
          <div class="hour-icon" aria-hidden="true">${symbol}</div>
          <div class="hour-temp">${formatNumber(item.temperature, 1)}°C</div>
          <div class="hour-rain">💧 ${formatNumber(item.rainChance, 0)}% · ${formatNumber(item.rain, 1)} mm</div>
          <div class="hour-wind">Veter ${formatNumber(item.wind, 0)} · sunki ${formatNumber(item.gust, 0)} km/h</div>
        </article>`;
    }).join("") || '<p class="empty-state">Urna napoved za ta dan ni na voljo.</p>';
  }

  async function refreshCurrentAndForecast(showError = true) {
    if (state.loading) return;
    state.loading = true;
    $("#refresh-button").classList.add("loading");
    const results = await Promise.allSettled([fetchLatestLocal(), fetchTrend(), fetchOpenMeteo()]);

    if (results[0].status === "fulfilled") state.local = results[0].value;
    else {
      $("#station-dot").className = "live-dot offline";
      setText("#station-status", "Postaja ni dosegljiva");
      const pill = $("#local-freshness");
      pill.className = "status-pill error";
      pill.textContent = "Ni povezave";
      if (showError) showBanner(`Lokalnih meritev ni mogoče naložiti: ${results[0].reason.message}`);
    }

    if (results[1].status === "fulfilled") state.trend = results[1].value;
    else state.trend = { rate3h: 0, forecast: "unknown" };

    if (results[2].status === "fulfilled") {
      state.portal = results[2].value;
      state.forecast = results[2].value;
      renderForecast();
    } else if (showError) {
      showBanner(`Napovedi ni mogoče naložiti: ${results[2].reason.message}`);
    }

    renderCurrent();
    state.loading = false;
    $("#refresh-button").classList.remove("loading");
  }

  function updateRadar() {
    const type = state.radarType;
    const mode = state.radarMode;
    const image = $("#radar-image");
    const loader = $("#radar-loader");
    const arso = CONFIG.arso;
    const key = `${type}${mode === "latest" ? "Latest" : "Animation"}`;
    const baseUrl = arso[key];

    loader.hidden = false;
    image.alt = type === "rain" ? "ARSO radarska slika padavin" : "ARSO prikaz verjetnosti toče";
    image.onload = () => { loader.hidden = true; };
    image.onerror = () => {
      loader.hidden = false;
      loader.textContent = "Slike trenutno ni mogoče prikazati. Odpri jo neposredno pri ARSO.";
    };
    image.src = `${baseUrl}?v=${Date.now()}`;

    const isRain = type === "rain";
    setText("#radar-title", isRain ? "PADAVINSKI RADAR" : "VERJETNOST TOČE");
    setText("#radar-description", mode === "animation"
      ? (isRain ? "Animacija zadnjih 90 minut." : "Animacija trenutnega razvoja verjetnosti toče.")
      : (isRain ? "Najnovejša sestavljena radarska slika." : "Najnovejši prikaz verjetnosti toče."));
    const source = $("#radar-source-link");
    source.href = isRain ? arso.rainPage : arso.hailPage;

    const legend = $("#radar-legend");
    if (isRain) {
      legend.className = "radar-legend rain-legend";
      legend.innerHTML = '<span><i class="legend-blue"></i>Rahlo</span><span><i class="legend-green"></i>Zmerno</span><span><i class="legend-yellow"></i>Močno</span><span><i class="legend-red"></i>Zelo močno</span><span><i class="legend-purple"></i>Verjetna toča</span>';
    } else {
      legend.className = "radar-legend hail-legend";
      legend.innerHTML = '<span><i></i>Majhna verjetnost</span><span><i></i>Srednja verjetnost</span><span><i></i>Velika verjetnost</span>';
    }
  }

  async function fetchHistory(days) {
    if (state.historyCache.has(days)) return state.historyCache.get(days);
    const range = HISTORY_RANGES[days];
    const data = await fetchJson(thingSpeakUrl({ days, average: range.average, round: 2 }));
    const parsed = (data.feeds || []).map(parseThingSpeakFeed).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
    state.historyCache.set(days, parsed);
    return parsed;
  }

  function formatChartTime(date, rangeDays) {
    if (rangeDays === 1) return formatDate(date, { hour: "2-digit", minute: "2-digit" });
    if (rangeDays === 7) return formatDate(date, { weekday: "short", hour: "2-digit" });
    return formatDate(date, { day: "numeric", month: "short" });
  }

  function renderHistory() {
    const metric = METRICS[state.historyMetric];
    const range = HISTORY_RANGES[state.historyRange];
    const data = state.historyData;
    setText("#history-chart-kicker", metric.label.toUpperCase());
    setText("#history-chart-title", range.label);
    setText("#history-chart-unit", metric.unit);
    setText("#history-note", `${range.note}. Tlak je preračunan na morsko gladino.`);

    const values = data.map((item) => item[metric.key]).filter(Number.isFinite);
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const avg = mean(values);
    setText("#history-min", min === null ? "--" : `${formatNumber(min, metric.decimals)} ${metric.unit}`);
    setText("#history-avg", avg === null ? "--" : `${formatNumber(avg, metric.decimals)} ${metric.unit}`);
    setText("#history-max", max === null ? "--" : `${formatNumber(max, metric.decimals)} ${metric.unit}`);
    setText("#history-count", String(values.length));
    renderLineChart(data, metric);
    $("#download-csv").disabled = data.length === 0;
  }

  function renderLineChart(data, metric) {
    const host = $("#history-chart");
    const points = data
      .map((item) => ({ timestamp: item.timestamp, value: item[metric.key] }))
      .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.timestamp.getTime()));

    if (!points.length) {
      host.innerHTML = '<p class="empty-state">Za izbrano obdobje še ni shranjenih meritev.</p>';
      return;
    }

    const W = 1000, H = 350;
    const margin = { top: 20, right: 24, bottom: 48, left: 68 };
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;
    let minY = Math.min(...points.map((p) => p.value));
    let maxY = Math.max(...points.map((p) => p.value));
    const span = Math.max(maxY - minY, metric.key === "pressure" ? 2 : 1);
    minY -= span * 0.12;
    maxY += span * 0.12;
    const minT = points[0].timestamp.getTime();
    const maxT = points[points.length - 1].timestamp.getTime();
    const timeSpan = Math.max(maxT - minT, 1);
    const x = (timestamp) => margin.left + ((timestamp.getTime() - minT) / timeSpan) * plotW;
    const y = (value) => margin.top + ((maxY - value) / (maxY - minY)) * plotH;
    const coordinates = points.map((point) => ({ ...point, px: x(point.timestamp), py: y(point.value) }));
    const linePath = coordinates.map((point, index) => `${index ? "L" : "M"}${point.px.toFixed(2)},${point.py.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L${coordinates.at(-1).px.toFixed(2)},${margin.top + plotH} L${coordinates[0].px.toFixed(2)},${margin.top + plotH} Z`;

    const yTicks = Array.from({ length: 5 }, (_, index) => maxY - (index / 4) * (maxY - minY));
    const xTickIndexes = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1])];

    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Graf: ${metric.label}">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#5bc9ef" stop-opacity="0.24"/>
            <stop offset="1" stop-color="#5bc9ef" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${yTicks.map((tick) => `<line class="chart-grid" x1="${margin.left}" y1="${y(tick)}" x2="${W - margin.right}" y2="${y(tick)}"/><text class="chart-axis-label" x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${formatNumber(tick, metric.decimals)}</text>`).join("")}
        ${xTickIndexes.map((index) => `<text class="chart-axis-label" x="${coordinates[index].px}" y="${H - 15}" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}">${formatChartTime(points[index].timestamp, state.historyRange)}</text>`).join("")}
        <path class="chart-area" d="${areaPath}"/>
        <path class="chart-line" d="${linePath}"/>
        <circle class="chart-last-dot" cx="${coordinates.at(-1).px}" cy="${coordinates.at(-1).py}" r="5"/>
        <g id="chart-tooltip" visibility="hidden">
          <line class="chart-tooltip-line" id="chart-tooltip-line" y1="${margin.top}" y2="${margin.top + plotH}"/>
          <circle class="chart-tooltip-dot" id="chart-tooltip-dot" r="5"/>
          <rect class="chart-tooltip-box" id="chart-tooltip-box" width="190" height="48" rx="8"/>
          <text class="chart-tooltip-text" id="chart-tooltip-value"></text>
          <text class="chart-axis-label" id="chart-tooltip-time"></text>
        </g>
        <rect class="chart-hit-area" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"/>
      </svg>`;

    const svg = $("svg", host);
    const tooltip = $("#chart-tooltip", svg);
    const hitArea = $(".chart-hit-area", svg);
    const line = $("#chart-tooltip-line", svg);
    const dot = $("#chart-tooltip-dot", svg);
    const box = $("#chart-tooltip-box", svg);
    const valueText = $("#chart-tooltip-value", svg);
    const timeText = $("#chart-tooltip-time", svg);

    const updateTooltip = (event) => {
      const rect = svg.getBoundingClientRect();
      const clientX = event.touches?.[0]?.clientX ?? event.clientX;
      const svgX = ((clientX - rect.left) / rect.width) * W;
      let nearest = coordinates[0];
      for (const point of coordinates) if (Math.abs(point.px - svgX) < Math.abs(nearest.px - svgX)) nearest = point;
      const boxX = nearest.px > W - 230 ? nearest.px - 202 : nearest.px + 12;
      const boxY = Math.max(8, Math.min(H - 58, nearest.py - 56));
      tooltip.setAttribute("visibility", "visible");
      line.setAttribute("x1", nearest.px); line.setAttribute("x2", nearest.px);
      dot.setAttribute("cx", nearest.px); dot.setAttribute("cy", nearest.py);
      box.setAttribute("x", boxX); box.setAttribute("y", boxY);
      valueText.setAttribute("x", boxX + 11); valueText.setAttribute("y", boxY + 20);
      valueText.textContent = `${formatNumber(nearest.value, metric.decimals)} ${metric.unit}`;
      timeText.setAttribute("x", boxX + 11); timeText.setAttribute("y", boxY + 38);
      timeText.textContent = formatDate(nearest.timestamp, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    };
    hitArea.addEventListener("pointermove", updateTooltip);
    hitArea.addEventListener("pointerleave", () => tooltip.setAttribute("visibility", "hidden"));
    hitArea.addEventListener("touchstart", updateTooltip, { passive: true });
  }

  async function loadHistory(force = false) {
    const host = $("#history-chart");
    host.innerHTML = '<div class="chart-loading">Nalagam zgodovino …</div>';
    try {
      if (force) state.historyCache.delete(state.historyRange);
      state.historyData = await fetchHistory(state.historyRange);
      renderHistory();
    } catch (error) {
      host.innerHTML = `<p class="empty-state">Zgodovine ni mogoče naložiti: ${error.message}</p>`;
      showBanner("ThingSpeak zgodovine trenutno ni mogoče naložiti.");
    }
  }

  function downloadHistoryCsv() {
    if (!state.historyData.length) return;
    const rows = [
      ["cas", "temperatura_C", "vlaga_pct", "tlak_postaja_hPa", "tlak_morska_gladina_hPa"],
      ...state.historyData.map((item) => [
        item.timestamp.toISOString(),
        item.temperature.toFixed(2),
        item.humidity.toFixed(2),
        item.stationPressure.toFixed(2),
        item.pressure.toFixed(2)
      ])
    ];
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `vremenska-postaja-${state.historyRange}dni.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function fetchYearData(force = false) {
    if (state.yearData && !force) return state.yearData;
    let data;
    try {
      data = await fetchJson(thingSpeakUrl({ days: 365, average: "daily", round: 2 }));
    } catch (error) {
      data = await fetchJson(thingSpeakUrl({ days: 365, average: 1440, round: 2 }));
    }
    state.yearData = (data.feeds || []).map(parseThingSpeakFeed).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
    return state.yearData;
  }

  function heatLevel(temp) {
    if (!Number.isFinite(temp)) return 0;
    if (temp < 0) return 1;
    if (temp < 10) return 2;
    if (temp < 20) return 3;
    if (temp < 27) return 4;
    return 5;
  }

  function dayDifference(start, end) {
    const oneDay = 86_400_000;
    const a = new Date(start); a.setHours(12, 0, 0, 0);
    const b = new Date(end); b.setHours(12, 0, 0, 0);
    return Math.round((b - a) / oneDay);
  }

  function renderYear() {
    const data = state.yearData || [];
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 364);
    setText("#year-period", `${formatDate(start, { day: "numeric", month: "short", year: "numeric" })}–${formatDate(today, { day: "numeric", month: "short", year: "numeric" })}`);

    const byDate = new Map();
    data.forEach((item) => byDate.set(dateKey(item.timestamp), item));
    const measuredDays = [...byDate.keys()].filter((key) => key >= dateKey(start) && key <= dateKey(today)).length;
    const completeness = Math.round((measuredDays / 365) * 100);
    setText("#year-completeness", String(completeness));
    setText("#year-days-count", `${measuredDays} / 365`);
    $("#year-progress").style.width = `${completeness}%`;

    const stationStart = new Date(`${CONFIG.stationStartDate}T12:00:00`);
    const stationAge = Math.max(1, dayDifference(stationStart, today) + 1);
    setText("#year-availability-note", `Postaja meri od ${formatDate(stationStart, { day: "numeric", month: "long", year: "numeric" })}. Trenutno je možnih največ ${Math.min(365, stationAge)} dni lastnih podatkov.`);

    const heatmap = $("#year-heatmap");
    heatmap.innerHTML = "";
    const mondayIndex = (start.getDay() + 6) % 7;
    for (let i = 0; i < mondayIndex; i++) {
      const blank = document.createElement("span");
      blank.className = "heat-cell heat-0";
      blank.setAttribute("aria-hidden", "true");
      heatmap.appendChild(blank);
    }
    for (let i = 0; i < 365; i++) {
      const date = new Date(start); date.setDate(start.getDate() + i);
      const reading = byDate.get(dateKey(date));
      const cell = document.createElement("span");
      cell.className = `heat-cell heat-${heatLevel(reading?.temperature)}`;
      cell.title = reading
        ? `${formatDate(date, { day: "numeric", month: "long", year: "numeric" })}: ${formatNumber(reading.temperature, 1)} °C`
        : `${formatDate(date, { day: "numeric", month: "long", year: "numeric" })}: ni podatka`;
      heatmap.appendChild(cell);
    }

    const validTemp = data.filter((item) => Number.isFinite(item.temperature));
    const validHumidity = data.filter((item) => Number.isFinite(item.humidity));
    const validPressure = data.filter((item) => Number.isFinite(item.pressure));
    const warmest = validTemp.reduce((best, item) => !best || item.temperature > best.temperature ? item : best, null);
    const coldest = validTemp.reduce((best, item) => !best || item.temperature < best.temperature ? item : best, null);
    const humid = validHumidity.reduce((best, item) => !best || item.humidity > best.humidity ? item : best, null);
    const pressure = validPressure.reduce((best, item) => !best || item.pressure < best.pressure ? item : best, null);
    renderRecord("warmest", warmest, "temperature", "°C", 1);
    renderRecord("coldest", coldest, "temperature", "°C", 1);
    renderRecord("humid", humid, "humidity", "%", 0);
    renderRecord("pressure", pressure, "pressure", "hPa", 0);
    renderMonthlySummary(data, start, today);
  }

  function renderRecord(id, reading, key, unit, decimals) {
    setText(`#record-${id}`, reading ? `${formatNumber(reading[key], decimals)} ${unit}` : "--");
    setText(`#record-${id}-date`, reading ? formatDate(reading.timestamp, { day: "numeric", month: "long", year: "numeric" }) : "Ni podatkov");
  }

  function renderMonthlySummary(data, start, today) {
    const months = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
    const endMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    while (cursor <= endMonth) {
      months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const html = months.map((month) => {
      const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      const items = data.filter((item) => dateKey(item.timestamp).startsWith(monthKey));
      const temp = mean(items.map((item) => item.temperature));
      const humidity = mean(items.map((item) => item.humidity));
      const pressure = mean(items.map((item) => item.pressure));
      return `
        <article class="month-card${items.length ? "" : " no-data"}">
          <h4>${formatDate(month, { month: "short", year: "2-digit" })}</h4>
          <dl>
            <div><dt>Temp.</dt><dd>${temp === null ? "--" : `${formatNumber(temp, 1)}°`}</dd></div>
            <div><dt>Vlaga</dt><dd>${humidity === null ? "--" : `${formatNumber(humidity, 0)}%`}</dd></div>
            <div><dt>Tlak</dt><dd>${pressure === null ? "--" : `${formatNumber(pressure, 0)}`}</dd></div>
            <div><dt>Dni</dt><dd>${items.length}</dd></div>
          </dl>
        </article>`;
    }).join("");
    $("#monthly-summary").innerHTML = html || '<p class="empty-state">Mesečni podatki še niso na voljo.</p>';
  }

  async function loadYear(force = false) {
    $("#year-heatmap").innerHTML = '<p class="empty-state">Nalagam letne podatke …</p>';
    try {
      await fetchYearData(force);
      renderYear();
    } catch (error) {
      $("#year-heatmap").innerHTML = `<p class="empty-state">Letnega arhiva ni mogoče naložiti: ${error.message}</p>`;
      showBanner("Letnega arhiva trenutno ni mogoče naložiti.");
    }
  }

  function switchTab(tabName, updateHash = true) {
    if (!$( `[data-panel="${tabName}"]`)) return;
    state.activeTab = tabName;
    $$("[data-panel]").forEach((panel) => {
      const active = panel.dataset.panel === tabName;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    $$("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
    if (updateHash) history.replaceState(null, "", `#${tabName}`);
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (tabName === "radar") updateRadar();
    if (tabName === "history" && !state.historyData.length) loadHistory();
    if (tabName === "year" && !state.yearData) loadYear();
    if (tabName === "forecast" && state.forecast) renderForecast();
  }

  function bindEvents() {
    $$("[data-tab]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
    $("#refresh-button").addEventListener("click", async () => {
      await refreshCurrentAndForecast();
      if (state.activeTab === "history") await loadHistory(true);
      if (state.activeTab === "year") await loadYear(true);
      if (state.activeTab === "radar") updateRadar();
    });

    $$("[data-radar-type]").forEach((button) => button.addEventListener("click", () => {
      state.radarType = button.dataset.radarType;
      $$("[data-radar-type]").forEach((item) => item.classList.toggle("active", item === button));
      updateRadar();
    }));
    $$("[data-radar-mode]").forEach((button) => button.addEventListener("click", () => {
      state.radarMode = button.dataset.radarMode;
      $$("[data-radar-mode]").forEach((item) => item.classList.toggle("active", item === button));
      updateRadar();
    }));
    $("#radar-refresh").addEventListener("click", updateRadar);

    $$("[data-history-range]").forEach((button) => button.addEventListener("click", async () => {
      state.historyRange = Number(button.dataset.historyRange);
      $$("[data-history-range]").forEach((item) => item.classList.toggle("active", item === button));
      await loadHistory();
    }));
    $$("[data-history-metric]").forEach((button) => button.addEventListener("click", () => {
      state.historyMetric = button.dataset.historyMetric;
      $$("[data-history-metric]").forEach((item) => item.classList.toggle("active", item === button));
      renderHistory();
    }));
    $("#download-csv").addEventListener("click", downloadHistoryCsv);

    window.addEventListener("online", () => {
      showBanner("Povezava je ponovno vzpostavljena.");
      refreshCurrentAndForecast(false);
    });
    window.addEventListener("offline", () => showBanner("Ni internetne povezave. Prikazani podatki se ne bodo osveževali.", false));
  }

  async function init() {
    if (!CONFIG?.thingSpeakChannelId) {
      showBanner("V js/config.js manjka ThingSpeak Channel ID.", false);
      return;
    }
    bindEvents();
    const initialTab = location.hash.slice(1);
    switchTab(["current", "radar", "forecast", "history", "year"].includes(initialTab) ? initialTab : "current", false);
    await refreshCurrentAndForecast();
    window.setInterval(() => refreshCurrentAndForecast(false), CONFIG.refreshIntervalMs);

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker:", error));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
