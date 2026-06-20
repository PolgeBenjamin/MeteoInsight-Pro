const express = require('express');
const path = require('path');
const http = require('http');
const fetch = require('node-fetch');
const fs = require('fs');

const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Memory cache for Home Assistant data to optimize performance and prevent API rate-limiting/surcharge
const memoryCache = {
  weather: null,
  weatherTime: 0,
  forecasts: { data: null, time: 0 },
  presence: null,
  presenceTime: 0,
  heat: null,
  heatTime: 0,
  biasModel: null,
  biasModelTime: 0
};

// Helper to fetch JSON from Home Assistant
function fetchHAStates() {
  return new Promise((resolve, reject) => {
    const url = `${config.HA_URL}/api/states`;
    const headers = {
      'Authorization': `Bearer ${config.HA_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse JSON response from Home Assistant'));
          }
        } else {
          reject(new Error(`Home Assistant API returned status code ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request to Home Assistant timed out'));
    });
  });
}

// Helper to fetch JSON from Home Assistant config
function fetchHAConfig() {
  return new Promise((resolve, reject) => {
    const url = `${config.HA_URL}/api/config`;
    const headers = {
      'Authorization': `Bearer ${config.HA_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse JSON response from Home Assistant config'));
          }
        } else {
          reject(new Error(`Home Assistant API returned status code ${res.statusCode} for config`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request to Home Assistant config timed out'));
    });
  });
}

// Map helper to safely extract state values as floats or null
function parseState(stateObj) {
  if (!stateObj || stateObj.state === 'unavailable' || stateObj.state === 'unknown') {
    return null;
  }
  const val = parseFloat(stateObj.state);
  return isNaN(val) ? stateObj.state : val;
}

// Endpoint to get current weather data
app.get('/api/weather', async (req, res) => {
  const now = Date.now();
  if (memoryCache.weather && (now - memoryCache.weatherTime < 5000)) {
    return res.json(memoryCache.weather);
  }

  try {
    const states = await fetchHAStates();
    
    // Create lookup dictionary for efficiency
    const stateMap = {};
    states.forEach(s => {
      stateMap[s.entity_id] = s;
    });

    // Dynamically build alexa rooms from config
    const alexaRooms = config.rooms
      .filter(r => r.tempEntity || r.lightEntity || r.motionEntity)
      .map(r => ({
        id: r.id,
        label: `${r.label} (Echo)`,
        temp: parseState(stateMap[r.tempEntity]),
        light: parseState(stateMap[r.lightEntity]),
        motion: parseState(stateMap[r.motionEntity])
      }));

    const responseData = {
      timestamp: new Date().toISOString(),
      outdoor: {
        name: "Extérieur",
        temp: parseState(stateMap[config.entities.outdoor_temp]),
        humidity: parseState(stateMap[config.entities.outdoor_humidity])
      },
      mobile: {
        name: "Capteur Mobile (Meter Pro)",
        temp: parseState(stateMap[config.entities.mobile_temp]),
        humidity: parseState(stateMap[config.entities.mobile_humidity])
      },
      netatmo: {
        name: "Salon (Netatmo)",
        temp: parseState(stateMap[config.entities.netatmo_temp]),
        humidity: parseState(stateMap[config.entities.netatmo_humidity]),
        co2: parseState(stateMap[config.entities.netatmo_co2]),
        noise: parseState(stateMap[config.entities.netatmo_noise]),
        pressure: parseState(stateMap[config.entities.netatmo_pressure])
      },
      alexa: alexaRooms,
      air_purifier: {
        pm25: parseState(stateMap[config.entities.purifier_pm25]),
        quality: parseState(stateMap[config.entities.purifier_quality])
      },
      presence: {
        benjamin: parseState(stateMap[config.entities.presence_person]),
        iphone_battery: parseState(stateMap[config.entities.iphone_battery])
      },
      ephemeris: {
        sun_state: stateMap[config.entities.sun] ? stateMap[config.entities.sun].state : null,
        next_rising: stateMap[config.entities.sun_next_rising] ? stateMap[config.entities.sun_next_rising].state : null,
        next_setting: stateMap[config.entities.sun_next_setting] ? stateMap[config.entities.sun_next_setting].state : null
      },
      roborock: {
        state: stateMap[config.entities.roborock_vacuum] ? stateMap[config.entities.roborock_vacuum].state : null,
        battery: parseState(stateMap[config.entities.roborock_battery]),
        room: stateMap[config.entities.roborock_room] ? stateMap[config.entities.roborock_room].state : null,
        status: stateMap[config.entities.roborock_status] ? stateMap[config.entities.roborock_status].state : null
      },
      dining_ac: {
        state: stateMap[config.entities.dining_ac] ? stateMap[config.entities.dining_ac].state : (memoryCache.dining_ac_state || 'off'),
        temp: memoryCache.dining_ac_temp || 21,
        mode: memoryCache.dining_ac_mode || 'cool',
        fan: memoryCache.dining_ac_fan || 'auto'
      }
    };

    memoryCache.weather = responseData;
    memoryCache.weatherTime = now;
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching weather data:', error);
    if (memoryCache.weather) {
      console.warn('Returning stale cached weather data due to HA connection error');
      return res.json({ ...memoryCache.weather, stale: true });
    }
    res.status(500).json({ error: error.message || 'Failed to fetch weather data' });
  }
});

// Endpoint for statistical (M2) and ML (M3) predictions -> NOW replaced by AROME and ARPEGE Météo-France forecasts
app.get('/api/forecasts', async (req, res) => {
  const nowTime = Date.now();
  
  if (memoryCache.forecasts.data && (nowTime - memoryCache.forecasts.time < 15 * 60 * 1000)) {
    return res.json(memoryCache.forecasts.data);
  }

  try {
    let lat = 48.8540661;
    let lon = 2.7863045;
    let timezone = 'Europe/Paris';

    try {
      const haConfig = await fetchHAConfig();
      if (haConfig.latitude && haConfig.longitude) {
        lat = haConfig.latitude;
        lon = haConfig.longitude;
      }
      if (haConfig.time_zone) {
        timezone = haConfig.time_zone;
      }
    } catch (e) {
      console.warn('Failed to fetch config from Home Assistant, using defaults:', e.message);
    }

    // Load or train AROME bias model coefficients
    const biasCoeffs = await getBiasModelCoefficients(lat, lon, timezone);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,weather_code,pressure_msl,cloud_cover,wind_speed_10m,wind_gusts_10m,precipitation,wind_direction_10m,direct_radiation,diffuse_radiation&models=meteofrance_arome_france_hd,meteofrance_arpege_europe&timezone=${encodeURIComponent(timezone)}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo API returned status ${response.status}`);
    const data = await response.json();

    const hourly = data.hourly;
    if (!hourly || !hourly.time) {
      throw new Error('Malformed hourly data in Open-Meteo response');
    }

    const mapWeather = (code) => {
      if (code === 0) return { label: 'Ensoleillé', icon: 'sun' };
      if (code === 1) return { label: 'Principalement dégagé', icon: 'cloud-sun' };
      if (code === 2) return { label: 'Partiellement nuageux', icon: 'cloud-sun' };
      if (code === 3) return { label: 'Couvert', icon: 'cloud' };
      if (code === 45 || code === 48) return { label: 'Brouillard', icon: 'cloud-fog' };
      if (code === 51 || code === 53 || code === 55) return { label: 'Bruine', icon: 'cloud-drizzle' };
      if (code === 56 || code === 57) return { label: 'Bruine verglaçante', icon: 'cloud-drizzle' };
      if (code === 61) return { label: 'Pluie faible', icon: 'cloud-rain' };
      if (code === 63) return { label: 'Pluie modérée', icon: 'cloud-rain' };
      if (code === 65) return { label: 'Forte pluie', icon: 'cloud-rain' };
      if (code === 66 || code === 67) return { label: 'Pluie verglaçante', icon: 'cloud-rain' };
      if (code === 71 || code === 73 || code === 75) return { label: 'Chutes de neige', icon: 'snowflake' };
      if (code === 77) return { label: 'Grains de neige', icon: 'snowflake' };
      if (code === 80 || code === 81 || code === 82) return { label: 'Averses de pluie', icon: 'cloud-rain' };
      if (code === 85 || code === 86) return { label: 'Averses de neige', icon: 'snowflake' };
      if (code === 95) return { label: 'Orageux', icon: 'cloud-lightning' };
      if (code === 96 || code === 99) return { label: 'Orage avec grêle', icon: 'cloud-lightning' };
      return { label: 'Indéterminé', icon: 'help-circle' };
    };

    const extractModelData = (suffix) => {
      const tempKey = `temperature_2m_${suffix}`;
      const humKey = `relative_humidity_2m_${suffix}`;
      const presKey = `pressure_msl_${suffix}`;
      const cloudKey = `cloud_cover_${suffix}`;
      const precKey = `precipitation_${suffix}`;
      const speedKey = `wind_speed_10m_${suffix}`;
      const gustKey = `wind_gusts_10m_${suffix}`;
      const dirKey = `wind_direction_10m_${suffix}`;
      const codeKey = `weather_code_${suffix}`;
      const directKey = `direct_radiation_${suffix}`;
      const diffuseKey = `diffuse_radiation_${suffix}`;

      const tList = hourly[tempKey] || [];

      const result = [];
      for (let i = 0; i < tList.length; i++) {
        if (tList[i] === null || tList[i] === undefined) continue;

        const timeStr = hourly.time[i];
        const date = new Date(timeStr);
        
        // Filter out past hours (keep current hour if it's less than 30 minutes in the past)
        if (date.getTime() < nowTime - 30 * 60 * 1000) {
          continue;
        }
        
        let rawCode = hourly[codeKey]?.[i];
        if (rawCode === null || rawCode === undefined) {
          const fallbackSuffix = suffix.includes('arome') ? 'meteofrance_arpege_europe' : 'meteofrance_arome_france_hd';
          rawCode = hourly[`weather_code_${fallbackSuffix}`]?.[i];
        }
        
        if (rawCode === null || rawCode === undefined) {
          rawCode = 0;
        }

        const wInfo = mapWeather(rawCode);

        const fHour = date.getHours();
        const solarProxy = Math.max(0, Math.cos(((fHour - 13) / 12) * Math.PI));
        const rawTemp = tList[i];
        const tempAdjusted = rawTemp + biasCoeffs.beta0 + biasCoeffs.beta1 * rawTemp + biasCoeffs.beta2 * solarProxy;

        result.push({
          time: timeStr,
          hourLabel: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          dayLabel: date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
          temp: tList[i],
          tempAdjusted: Math.round(tempAdjusted * 10) / 10,
          humidity: hourly[humKey]?.[i] ?? null,
          pressure: hourly[presKey]?.[i] ?? null,
          cloudCover: hourly[cloudKey]?.[i] ?? null,
          precipitation: hourly[precKey]?.[i] ?? null,
          windSpeed: hourly[speedKey]?.[i] ?? null,
          windGusts: hourly[gustKey]?.[i] ?? null,
          windDirection: hourly[dirKey]?.[i] ?? null,
          directRadiation: hourly[directKey]?.[i] ?? 0.0,
          diffuseRadiation: hourly[diffuseKey]?.[i] ?? 0.0,
          weatherCode: rawCode,
          weatherLabel: wInfo.label,
          weatherIcon: wInfo.icon
        });
      }
      return result;
    };

    const aromeForecasts = extractModelData('meteofrance_arome_france_hd');
    const arpegeForecasts = extractModelData('meteofrance_arpege_europe');

    const responseData = {
      timestamp: new Date().toISOString(),
      location: {
        latitude: lat,
        longitude: lon,
        timezone: timezone
      },
      arome: aromeForecasts,
      arpege: arpegeForecasts
    };

    memoryCache.forecasts = {
      time: nowTime,
      data: responseData
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching/computing weather forecasts:', error);
    if (memoryCache.forecasts.data) {
      console.warn('Returning stale cached forecasts data due to Open-Meteo connection error');
      return res.json({ ...memoryCache.forecasts.data, stale: true });
    }
    res.status(500).json({ error: error.message || 'Failed to fetch forecasts' });
  }
});

// Endpoint for presence predictions based on motion history
app.get('/api/presence-prediction', async (req, res) => {
  const nowTime = Date.now();
  if (memoryCache.presence && (nowTime - memoryCache.presenceTime < 60 * 60 * 1000)) {
    return res.json(memoryCache.presence);
  }

  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    const startStr = startTime.toISOString();
    const endStr = now.toISOString();

    const fetchHistory = async (entityId) => {
      const url = `${config.HA_URL}/api/history/period/${startStr}?filter_entity_id=${entityId}&end_time=${endStr}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.HA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error(`HA API returned ${response.status} for ${entityId}`);
      const data = await response.json();
      return data[0] || [];
    };

    // Extract dynamic rooms with motion sensors
    const activeRooms = config.rooms.filter(r => r.motionEntity).map(r => r.id);
    const entities = {};
    config.rooms.forEach(r => {
      if (r.motionEntity) {
        entities[r.id] = r.motionEntity;
      }
    });

    const fetchPromises = activeRooms.map(room => fetchHistory(entities[room]));
    const histories = await Promise.all(fetchPromises);

    const roomHistories = {};
    activeRooms.forEach((room, idx) => {
      roomHistories[room] = histories[idx];
    });

    const getStateAt = (history, targetTime) => {
      let activeState = null;
      for (const item of history) {
        const itemTime = new Date(item.last_changed || item.last_updated);
        if (itemTime <= targetTime) {
          activeState = item.state;
        } else {
          break;
        }
      }
      return activeState;
    };

    const predictionData = {};
    const statsData = {};

    activeRooms.forEach(room => {
      const history = roomHistories[room];
      const totalHours = 30 * 24;
      const hourlyOcc = Array(totalHours).fill(0);

      let dataStart = startTime;
      if (history.length > 0) {
        const firstEventTime = new Date(history[0].last_changed || history[0].last_updated);
        if (firstEventTime > startTime) {
          dataStart = firstEventTime;
        }
      }

      for (let i = 0; i < totalHours; i++) {
        const hourStart = new Date(startTime.getTime() + i * 60 * 60 * 1000);
        const hourEnd = new Date(startTime.getTime() + (i + 1) * 60 * 60 * 1000);

        if (hourStart < dataStart) {
          hourlyOcc[i] = -1;
          continue;
        }

        const startState = getStateAt(history, hourStart);
        let hasMotion = (startState === 'on');

        if (!hasMotion) {
          for (const item of history) {
            const itemTime = new Date(item.last_changed || item.last_updated);
            if (itemTime >= hourStart && itemTime <= hourEnd && item.state === 'on') {
              hasMotion = true;
              break;
            }
          }
        }
        hourlyOcc[i] = hasMotion ? 1 : 0;
      }

      const hourlyProb = Array.from({ length: 7 }, () => Array(24).fill(0));
      const hourCounts = Array.from({ length: 7 }, () => Array(24).fill(0));

      for (let i = 0; i < totalHours; i++) {
        if (hourlyOcc[i] === -1) continue;
        
        const hourTime = new Date(startTime.getTime() + i * 60 * 60 * 1000);
        const frenchDay = (hourTime.getDay() + 6) % 7;
        const hOfDay = hourTime.getHours();
        
        hourlyProb[frenchDay][hOfDay] += hourlyOcc[i];
        hourCounts[frenchDay][hOfDay]++;
      }

      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const rawProb = hourCounts[d][h] > 0 ? (hourlyProb[d][h] / hourCounts[d][h]) * 100 : 0;
          hourlyProb[d][h] = Math.round(rawProb);
        }
      }

      const smoothedProb = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const prev = hourlyProb[d][(h - 1 + 24) % 24];
          const curr = hourlyProb[d][h];
          const next = hourlyProb[d][(h + 1) % 24];
          smoothedProb[d][h] = Math.round((prev + 2 * curr + next) / 4);
        }
      }

      predictionData[room] = smoothedProb;

      const roomStats = [];
      const formatTimeSlot = (h) => {
        const start = h.toString().padStart(2, '0');
        const end = ((h + 1) % 24).toString().padStart(2, '0');
        return `${start}h00 - ${end}h00`;
      };

      for (let d = 0; d < 7; d++) {
        let maxVal = -1;
        let maxHour = 0;
        let minVal = 101;
        let minHour = 0;

        for (let h = 0; h < 24; h++) {
          const val = smoothedProb[d][h];
          if (val > maxVal) {
            maxVal = val;
            maxHour = h;
          }
          if (val < minVal) {
            minVal = val;
            minHour = h;
          }
        }

        roomStats.push({
          most_used_slot: formatTimeSlot(maxHour),
          most_used_pct: maxVal,
          least_used_slot: formatTimeSlot(minHour),
          least_used_pct: minVal,
          simulated: false
        });
      }

      statsData[room] = roomStats;
    });

    const responseData = {
      timestamp: new Date().toISOString(),
      rooms: predictionData,
      stats: statsData
    };

    memoryCache.presence = responseData;
    memoryCache.presenceTime = nowTime;
    res.json(responseData);
  } catch (error) {
    console.error('Error computing presence predictions:', error);
    if (memoryCache.presence) {
      console.warn('Returning stale cached presence data due to HA connection error');
      return res.json({ ...memoryCache.presence, stale: true });
    }
    res.status(500).json({ error: error.message || 'Failed to compute presence predictions' });
  }
});

// Ridge Regression solver for Y = beta0 + beta1 * X1 + beta2 * X2
function solveRidgeRegression(samples, lambda = 0.5) {
  let xtx = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  let xty = [0, 0, 0];

  for (const s of samples) {
    const r = [1, s.x1, s.x2];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        xtx[i][j] += r[i] * r[j];
      }
      xty[i] += r[i] * s.y;
    }
  }

  // Add Ridge regularization parameter (lambda) on diagonal for stability (except intercept)
  xtx[0][0] += lambda * 0.01;
  xtx[1][1] += lambda;
  xtx[2][2] += lambda;

  const a00 = xtx[0][0], a01 = xtx[0][1], a02 = xtx[0][2];
  const a10 = xtx[1][0], a11 = xtx[1][1], a12 = xtx[1][2];
  const a20 = xtx[2][0], a21 = xtx[2][1], a22 = xtx[2][2];

  const det = a00 * (a11 * a22 - a12 * a21) -
              a01 * (a10 * a22 - a12 * a20) +
              a02 * (a10 * a21 - a11 * a20);

  if (Math.abs(det) < 1e-6) {
    return { beta0: 0.007, beta1: -0.005, beta2: 0.02 };
  }

  const inv = [
    [
      (a11 * a22 - a12 * a21) / det,
      -(a01 * a22 - a02 * a21) / det,
      (a01 * a12 - a02 * a11) / det
    ],
    [
      -(a10 * a22 - a12 * a20) / det,
      (a00 * a22 - a02 * a20) / det,
      -(a00 * a12 - a02 * a10) / det
    ],
    [
      (a10 * a21 - a11 * a20) / det,
      -(a00 * a21 - a01 * a20) / det,
      (a00 * a11 - a01 * a10) / det
    ]
  ];

  const beta0 = inv[0][0] * xty[0] + inv[0][1] * xty[1] + inv[0][2] * xty[2];
  const beta1 = inv[1][0] * xty[0] + inv[1][1] * xty[1] + inv[1][2] * xty[2];
  const beta2 = inv[2][0] * xty[0] + inv[2][1] * xty[1] + inv[2][2] * xty[2];

  return { beta0, beta1, beta2 };
}

// Helper to fetch and fit AROME bias model against local outdoor temperature history (30 days)
async function getBiasModelCoefficients(lat, lon, timezone) {
  const nowTime = Date.now();
  // Cache for 6 hours
  if (memoryCache.biasModel && (nowTime - memoryCache.biasModelTime < 6 * 60 * 60 * 1000)) {
    return memoryCache.biasModel;
  }

  try {
    const now = new Date();
    const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const formatDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(now);

    // Fetch Home Assistant outdoor temp history
    const fetchHAHistory = async (entityId) => {
      const startStr = startDate.toISOString();
      const endStr = now.toISOString();
      const url = `${config.HA_URL}/api/history/period/${startStr}?filter_entity_id=${entityId}&end_time=${endStr}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.HA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error(`HA API returned ${response.status} for ${entityId}`);
      const data = await response.json();
      return data[0] || [];
    };

    // Fetch Open-Meteo archive history
    const fetchOMArchive = async () => {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDateStr}&end_date=${endDateStr}&hourly=temperature_2m&timezone=${encodeURIComponent(timezone)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Open-Meteo Archive returned status ${response.status}`);
      return await response.json();
    };

    const [haHistory, omArchive] = await Promise.all([
      fetchHAHistory(config.entities.outdoor_temp),
      fetchOMArchive()
    ]);

    const getStateAt = (history, targetTime) => {
      let activeState = null;
      let found = false;
      for (const item of history) {
        const itemTime = new Date(item.last_changed || item.last_updated);
        if (itemTime <= targetTime) {
          activeState = item.state;
          found = true;
        } else {
          break;
        }
      }
      return found ? activeState : null;
    };

    const archiveHourly = omArchive.hourly;
    const samples = [];

    if (archiveHourly && archiveHourly.time) {
      for (let i = 0; i < archiveHourly.time.length; i++) {
        const tStr = archiveHourly.time[i];
        const tTime = new Date(tStr);
        const modelTemp = archiveHourly.temperature_2m[i];
        
        const localState = getStateAt(haHistory, tTime);
        const localTemp = parseFloat(localState);

        if (tTime.getTime() <= nowTime && modelTemp !== null && modelTemp !== undefined && !isNaN(localTemp)) {
          const h = tTime.getHours();
          const solarProxy = Math.max(0, Math.cos(((h - 13) / 12) * Math.PI));
          samples.push({
            x1: modelTemp,
            x2: solarProxy,
            y: localTemp - modelTemp // bias
          });
        }
      }
    }

    let beta0 = 0.0, beta1 = 0.0, beta2 = 0.0;
    if (samples.length > 10) {
      // Fit Y = beta0 + beta1 * X1 + beta2 * X2 (X1 = modelTemp, X2 = solarProxy, Y = bias)
      const fit = solveRidgeRegression(samples, 1.0);
      beta0 = fit.beta0;
      beta1 = fit.beta1;
      beta2 = fit.beta2;
    }

    const result = { beta0, beta1, beta2 };
    memoryCache.biasModel = result;
    memoryCache.biasModelTime = nowTime;
    return result;
  } catch (error) {
    console.error('Error training bias model:', error);
    // Return default (no correction) if training fails
    return { beta0: 0.0, beta1: 0.0, beta2: 0.0 };
  }
}

// Endpoint for heat management advice and ML projection
app.get('/api/heat-management', async (req, res) => {
  const nowTime = Date.now();
  if (memoryCache.heat && (nowTime - memoryCache.heatTime < 10 * 60 * 1000)) {
    return res.json(memoryCache.heat);
  }

  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    const startStr = startTime.toISOString();
    const endStr = now.toISOString();

    // Map dynamic rooms configs
    const roomsConf = {};
    config.rooms.forEach(r => {
      if (r.tempEntity) {
        roomsConf[r.id] = {
          label: r.label,
          tempEntity: r.tempEntity,
          humEntity: r.humEntity || config.entities.netatmo_humidity,
          windowOrientation: r.windowOrientation !== undefined ? r.windowOrientation : null
        };
      }
    });

    const fetchHistory = async (entityId) => {
      const url = `${config.HA_URL}/api/history/period/${startStr}?filter_entity_id=${entityId}&end_time=${endStr}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.HA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error(`HA API returned ${response.status} for ${entityId}`);
      const data = await response.json();
      return data[0] || [];
    };

    // Parallel fetch for all entities
    const entitiesToFetch = [
      config.entities.outdoor_temp,
      config.entities.outdoor_humidity
    ];
    if (config.entities.dining_ac && !entitiesToFetch.includes(config.entities.dining_ac)) {
      entitiesToFetch.push(config.entities.dining_ac);
    }
    config.rooms.forEach(r => {
      if (r.tempEntity && !entitiesToFetch.includes(r.tempEntity)) {
        entitiesToFetch.push(r.tempEntity);
      }
      if (r.humEntity && !entitiesToFetch.includes(r.humEntity)) {
        entitiesToFetch.push(r.humEntity);
      }
    });

    const historyMap = {};
    const fetchPromises = entitiesToFetch.map(async (entityId) => {
      try {
        historyMap[entityId] = await fetchHistory(entityId);
      } catch (e) {
        console.warn(`Failed to fetch history for ${entityId}, using empty history.`, e.message);
        historyMap[entityId] = [];
      }
    });

    const results = await Promise.all([
      ...fetchPromises,
      fetchHAStates()
    ]);
    const currentStates = results[results.length - 1];

    const stateMap = {};
    currentStates.forEach(s => {
      stateMap[s.entity_id] = s;
    });

    const getVal = (entityId) => {
      const sObj = stateMap[entityId];
      if (!sObj || sObj.state === 'unavailable' || sObj.state === 'unknown') return null;
      const v = parseFloat(sObj.state);
      return isNaN(v) ? null : v;
    };

    const curTout = getVal(config.entities.outdoor_temp) || 20.0;
    const curHout = getVal(config.entities.outdoor_humidity) || 60.0;
    const curWeather = stateMap[config.entities.weather_forecast]?.state || 'unknown';
    const weatherState = stateMap[config.entities.weather_forecast];
    const curWindSpeed = (weatherState && weatherState.attributes) ? (weatherState.attributes.wind_speed || 0.0) : 0.0;
    const curWindBearing = (weatherState && weatherState.attributes) ? (weatherState.attributes.wind_bearing || 0.0) : 0.0;

    const curAcState = stateMap[config.entities.dining_ac] ? stateMap[config.entities.dining_ac].state : (memoryCache.dining_ac_state || 'off');
    const isCurAcOn = curAcState === 'on';

    const getStateAt = (history, targetTime) => {
      let activeState = null;
      let found = false;
      for (const item of history) {
        const itemTime = new Date(item.last_changed || item.last_updated);
        if (itemTime <= targetTime) {
          activeState = item.state;
          found = true;
        } else {
          break;
        }
      }
      return found ? activeState : null;
    };

    // Fetch forecasts
    let lat = 48.8540661;
    let lon = 2.7863045;
    let timezone = 'Europe/Paris';

    try {
      const haConfig = await fetchHAConfig();
      if (haConfig.latitude && haConfig.longitude) {
        lat = haConfig.latitude;
        lon = haConfig.longitude;
      }
      if (haConfig.time_zone) {
        timezone = haConfig.time_zone;
      }
    } catch (e) {
      console.warn('Failed to fetch config from Home Assistant, using defaults:', e.message);
    }

    // Load or train AROME bias model coefficients
    const biasCoeffs = await getBiasModelCoefficients(lat, lon, timezone);

    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,direct_radiation,diffuse_radiation&models=meteofrance_arome_france_hd,meteofrance_arpege_europe&timezone=${encodeURIComponent(timezone)}`;
    
    let forecastList = [];
    try {
      const omResponse = await fetch(openMeteoUrl);
      if (!omResponse.ok) throw new Error(`Open-Meteo returned status ${omResponse.status}`);
      const omData = await omResponse.json();
      const omHourly = omData.hourly;

      if (omHourly && omHourly.time) {
        const mapWeatherCodeToHACondition = (code) => {
          if (code === 0) return 'sunny';
          if (code === 1 || code === 2) return 'partlycloudy';
          if (code === 3) return 'cloudy';
          if ([45, 48].includes(code)) return 'fog';
          if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rainy';
          if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snowy';
          if ([95, 96, 99].includes(code)) return 'lightning';
          return 'unknown';
        };

        const extractOMModelData = (suffix) => {
          const tempKey = `temperature_2m_${suffix}`;
          const humKey = `relative_humidity_2m_${suffix}`;
          const speedKey = `wind_speed_10m_${suffix}`;
          const dirKey = `wind_direction_10m_${suffix}`;
          const cloudKey = `cloud_cover_${suffix}`;
          const codeKey = `weather_code_${suffix}`;
          const directKey = `direct_radiation_${suffix}`;
          const diffuseKey = `diffuse_radiation_${suffix}`;

          const tList = omHourly[tempKey] || [];
          const result = [];
          for (let i = 0; i < tList.length; i++) {
            if (omHourly.time[i] === null || omHourly.time[i] === undefined) continue;
            if (tList[i] === null || tList[i] === undefined) continue;
            const timeStr = omHourly.time[i];
            
            let rawCode = omHourly[codeKey]?.[i];
            if (rawCode === null || rawCode === undefined) {
              const fallbackSuffix = suffix.includes('arome') ? 'meteofrance_arpege_europe' : 'meteofrance_arome_france_hd';
              rawCode = omHourly[`weather_code_${fallbackSuffix}`]?.[i];
            }

            result.push({
              datetime: timeStr,
              temperature: tList[i],
              humidity: omHourly[humKey]?.[i] ?? 50.0,
              condition: mapWeatherCodeToHACondition(rawCode),
              wind_speed: omHourly[speedKey]?.[i] ?? 0.0,
              wind_bearing: omHourly[dirKey]?.[i] ?? 0.0,
              cloud_coverage: omHourly[cloudKey]?.[i] ?? 50.0,
              directRadiation: omHourly[directKey]?.[i] ?? 0.0,
              diffuseRadiation: omHourly[diffuseKey]?.[i] ?? 0.0
            });
          }
          return result;
        };

        const aromeForecasts = extractOMModelData('meteofrance_arome_france_hd');
        const arpegeForecasts = extractOMModelData('meteofrance_arpege_europe');
        forecastList = aromeForecasts.length > 0 ? aromeForecasts : arpegeForecasts;
      }
    } catch (err) {
      console.warn('Failed to fetch forecasts from Open-Meteo, falling back to Home Assistant forecasts:', err.message);
      // Fallback to Home Assistant weather entity forecast
      const forecastResponse = await fetch(`${config.HA_URL}/api/services/weather/get_forecasts?return_response=true`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.HA_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          entity_id: config.entities.weather_forecast,
          type: 'hourly'
        })
      });
      if (forecastResponse.ok) {
        const forecastData = await forecastResponse.json();
        const rawForecastList = forecastData.service_response?.[config.entities.weather_forecast]?.forecast || [];
        forecastList = rawForecastList.map(f => ({
          datetime: f.datetime,
          temperature: f.temperature,
          humidity: f.humidity,
          condition: f.condition,
          wind_speed: f.wind_speed,
          wind_bearing: f.wind_bearing,
          cloud_coverage: f.cloud_coverage,
          directRadiation: 0.0,
          diffuseRadiation: 0.0
        }));
      }
    }

    const calculateAH = (temp, rh) => {
      if (temp === null || rh === null) return null;
      const saturationVaporPressure = 6.112 * Math.exp((17.67 * temp) / (temp + 243.5));
      const vaporPressure = (saturationVaporPressure * rh) / 100;
      const ah = (vaporPressure * 100 * 18.016) / (8.3144 * (273.15 + temp));
      return Math.round(ah * 10) / 10;
    };

    const calculateRHFromAH = (ah, temp) => {
      if (ah === null || temp === null) return null;
      const saturationVaporPressure = 6.112 * Math.exp((17.67 * temp) / (temp + 243.5));
      const rh = (ah * (273.15 + temp)) / (2.1674 * saturationVaporPressure);
      return Math.min(100, Math.max(0, Math.round(rh)));
    };

    const curToutAH = calculateAH(curTout, curHout);
    const roomResults = {};

    for (const [roomId, roomConf] of Object.entries(roomsConf)) {
      const tHist = historyMap[roomConf.tempEntity] || [];
      const hHist = historyMap[roomConf.humEntity] || [];
      const outTHist = historyMap[config.entities.outdoor_temp] || [];
      const outHHist = historyMap[config.entities.outdoor_humidity] || [];
      const acHist = (roomId === 'salle_a_manger') ? (historyMap[config.entities.dining_ac] || []) : [];

      const dataset = [];
      const hourlyPoints = 30 * 24; // 30 days of history
      for (let i = 0; i <= hourlyPoints; i++) {
        const targetTime = new Date(startTime.getTime() + i * 60 * 60 * 1000);
        const tin = parseFloat(getStateAt(tHist, targetTime));
        const tout = parseFloat(getStateAt(outTHist, targetTime));
        const hin = parseFloat(getStateAt(hHist, targetTime));
        const chartHout = parseFloat(getStateAt(outHHist, targetTime));
        const acState = (roomId === 'salle_a_manger') ? getStateAt(acHist, targetTime) : 'off';
        const isAcOn = acState === 'on';

        dataset.push({
          time: targetTime,
          tin: isNaN(tin) ? null : tin,
          tout: isNaN(tout) ? null : tout,
          hin: isNaN(hin) ? null : hin,
          hout: isNaN(chartHout) ? null : chartHout,
          isAcOn: isAcOn
        });
      }

      // Compute 24h rolling average of Tout for wall thermal inertia
      for (let i = 0; i < dataset.length; i++) {
        let sumTout = 0;
        let countTout = 0;
        const startIdx = Math.max(0, i - 24);
        for (let k = startIdx; k <= i; k++) {
          if (dataset[k].tout !== null) {
            sumTout += dataset[k].tout;
            countTout++;
          }
        }
        dataset[i].tout24h = countTout > 0 ? (sumTout / countTout) : (dataset[i].tout || 20.0);
      }

      const getRoomSolarProxy = (h, orientation) => {
        if (orientation === null || orientation === undefined) {
          return 0.0;
        }
        const sunAzimuth = 90 + (h - 6) * 15;
        const diffAngle = Math.abs(sunAzimuth - orientation) % 360;
        const absDiff = diffAngle > 180 ? 360 - diffAngle : diffAngle;
        
        let solarElevationRad = 0.0;
        if (h >= 6 && h <= 20) {
          const maxElevation = 60 * Math.PI / 180;
          solarElevationRad = maxElevation * Math.cos(((h - 13) / 7) * Math.PI / 2);
        }
        
        const cosIncidence = Math.max(0, Math.cos(solarElevationRad) * Math.cos(absDiff * Math.PI / 180));
        return (h >= 6 && h <= 20) ? cosIncidence : 0.0;
      };

      const samples = [];
      for (let i = 0; i < dataset.length - 1; i++) {
        const curr = dataset[i];
        const next = dataset[i + 1];
        if (curr.tin !== null && curr.tout !== null && curr.tout24h !== null && next.tin !== null && !curr.isAcOn) {
          const h = curr.time.getHours();
          const solarProxy = getRoomSolarProxy(h, roomConf.windowOrientation);
          
          // Effective outdoor temp is 70% current Tout and 30% Tout 24h average
          const toutEffective = 0.7 * curr.tout + 0.3 * curr.tout24h;
          
          samples.push({
            x1: curr.tin - toutEffective,
            x2: solarProxy,
            y: next.tin - curr.tin
          });
        }
      }

      let slope = -0.005;
      let solarCoeff = 0.02;
      let intercept = 0.007;

      if (samples.length > 10) {
        const fit = solveRidgeRegression(samples, 0.5);
        slope = fit.beta1;
        solarCoeff = fit.beta2;
        intercept = fit.beta0;
      }

      // Clamp coefficients to physical bounds
      if (slope >= 0) {
        slope = -0.005;
      }
      if (solarCoeff < 0) {
        solarCoeff = 0.0;
      } else if (solarCoeff > 0.1) {
        solarCoeff = 0.1;
      }
      if (intercept < 0) {
        intercept = 0.005;
      } else if (intercept > 0.05) {
        intercept = 0.05;
      }

      let curRoomTin = getVal(roomConf.tempEntity);
      let curRoomHin = getVal(roomConf.humEntity);

      if (curRoomTin === null) {
        curRoomTin = getVal(config.entities.mobile_temp) || 21.0;
      }
      if (curRoomHin === null) {
        curRoomHin = getVal(config.entities.netatmo_humidity) || 50.0;
      }

      const curTinAH = calculateAH(curRoomTin, curRoomHin);

      // Check if there is an opposite room in the config for cross ventilation (45° tolerance)
      const oppositeOrientation = (roomConf.windowOrientation !== null) ? (roomConf.windowOrientation + 180) % 360 : null;
      const hasOppositeRoom = config.rooms.some(r => {
        if (r.id === roomId || !r.tempEntity || r.windowOrientation === null || oppositeOrientation === null) return false;
        const diff = Math.abs(r.windowOrientation - oppositeOrientation) % 360;
        const absDiff = diff > 180 ? 360 - diff : diff;
        return absDiff <= 45;
      });

      let curWindAlignment = 1.0;
      let curCrossVentilationActive = false;
      if (roomConf.windowOrientation !== null) {
        const diffAngle = Math.abs(curWindBearing - roomConf.windowOrientation) % 360;
        const absDiff = diffAngle > 180 ? 360 - diffAngle : diffAngle;
        curWindAlignment = Math.max(0, Math.cos(absDiff * Math.PI / 180));

        if (hasOppositeRoom) {
          const axisAlignment = Math.abs(Math.cos(absDiff * Math.PI / 180));
          if (axisAlignment > 0.707) { // within 45 degrees of the window axis
            curCrossVentilationActive = true;
          }
        }
      }

      const isAcOnInRoom = (roomId === 'salle_a_manger') && isCurAcOn;
      const curIsHumidityFavorable = curRoomHin > 60 ? (curToutAH < curTinAH) : (curToutAH < 13.0);
      let curIsFavorable = (roomConf.windowOrientation !== null) && curTout < curRoomTin && !['rainy', 'snowy', 'hail', 'lightning', 'pouring'].includes(curWeather) && curHout < 85 && curIsHumidityFavorable;
      if (isAcOnInRoom) {
        curIsFavorable = false;
      }

      const timeline = [];
      timeline.push({
        time: now.toISOString(),
        hourLabel: "Actuel",
        tout: curTout,
        hout: curHout,
        tin: curRoomTin,
        hin: curRoomHin,
        toutAH: curToutAH,
        tinAH: curTinAH,
        condition: curWeather,
        isFavorable: curIsFavorable
      });

      // Initialize recent Tout history with last 24 hours of data for wall thermal inertia
      const recentToutHistory = [];
      const historyStartIdx = Math.max(0, dataset.length - 24);
      for (let k = historyStartIdx; k < dataset.length; k++) {
        if (dataset[k].tout !== null) {
          recentToutHistory.push(dataset[k].tout);
        }
      }
      while (recentToutHistory.length < 24) {
        recentToutHistory.unshift(curTout);
      }

      let runningTin = curRoomTin;
      let runningTinAH = curTinAH;
      let lastTime = now;

      const projectionLength = Math.min(24, forecastList.length);
      for (let i = 0; i < projectionLength; i++) {
        const f = forecastList[i];
        const fTime = new Date(f.datetime);
        if (fTime <= now) continue;

        const rawfTout = f.temperature;
        const fHour = fTime.getHours();
        const solarProxy = Math.max(0, Math.cos(((fHour - 13) / 12) * Math.PI));
        const fTout = rawfTout + biasCoeffs.beta0 + biasCoeffs.beta1 * rawfTout + biasCoeffs.beta2 * solarProxy;
        const fHout = f.humidity || 50.0;
        const fCondition = f.condition || 'unknown';
        const fWind = f.wind_speed || 0.0;
        const fWindBearing = f.wind_bearing || 0.0;
        const fCloud = f.cloud_coverage !== undefined ? f.cloud_coverage : 50.0;

        const dt = (fTime - lastTime) / (1000 * 60 * 60);
        lastTime = fTime;

        // Calculate rolling 24h average for wall inertia
        const fTout24h = recentToutHistory.reduce((sum, v) => sum + v, 0) / recentToutHistory.length;
        
        // Update recent Tout history for the next steps
        recentToutHistory.push(fTout);
        if (recentToutHistory.length > 24) {
          recentToutHistory.shift();
        }
        
        // Effective outdoor temp is 70% current Tout and 30% Tout 24h average
        const toutEffective = 0.7 * fTout + 0.3 * fTout24h;

        // Calculate wind-alignment factor
        let windAlignment = 1.0;
        let crossVentilationActive = false;
        if (roomConf.windowOrientation !== null) {
          const diffAngle = Math.abs(fWindBearing - roomConf.windowOrientation) % 360;
          const absDiff = diffAngle > 180 ? 360 - diffAngle : diffAngle;
          windAlignment = Math.max(0, Math.cos(absDiff * Math.PI / 180));

          if (hasOppositeRoom) {
            const axisAlignment = Math.abs(Math.cos(absDiff * Math.PI / 180));
            if (axisAlignment > 0.707) { // within 45 degrees of the window axis
              crossVentilationActive = true;
            }
          }
        }

        // Slope acceleration based on wind speed (sub-linear square-root scaling), wind orientation, and cross-ventilation (1.5x)
        const crossMultiplier = crossVentilationActive ? 1.5 : 1.0;
        const effectiveSlope = slope * (1 + 0.04 * Math.sqrt(fWind) * (0.4 + 0.6 * windAlignment) * crossMultiplier);

        const fDirectRadiation = f.directRadiation || 0.0;
        const fDiffuseRadiation = f.diffuseRadiation || 0.0;

        // Sun azimuth and elevation estimation
        const sunAzimuth = 90 + (fHour - 6) * 15;
        let cosIncidence = 0.0;
        if (roomConf.windowOrientation !== null) {
          const diffAngle = Math.abs(sunAzimuth - roomConf.windowOrientation) % 360;
          const absDiff = diffAngle > 180 ? 360 - diffAngle : diffAngle;
          
          let solarElevationRad = 0.0;
          if (fHour >= 6 && fHour <= 20) {
            const maxElevation = 60 * Math.PI / 180;
            solarElevationRad = maxElevation * Math.cos(((fHour - 13) / 7) * Math.PI / 2);
          }
          
          // Direct light cosine incidence on vertical window
          cosIncidence = Math.max(0, Math.cos(solarElevationRad) * Math.cos(absDiff * Math.PI / 180));
        }

        // Calculate solar irradiance on window in W/m² (direct + diffuse sky visibility)
        const solarIrradiance = (roomConf.windowOrientation !== null) ? (fDirectRadiation * cosIncidence + fDiffuseRadiation * 0.5) : 0.0;
        
        // Solar gain is actual irradiance normalized (divided by 1000 W/m²) and scaled by the fitted solarCoeff
        const solarGain = solarCoeff * (solarIrradiance / 1000.0);
        const effectiveIntercept = intercept + solarGain;

        const nextTin = runningTin + dt * (effectiveSlope * (runningTin - toutEffective) + effectiveIntercept);
        
        const fToutAH = calculateAH(fTout, fHout);
        const nextTinAH = runningTinAH + dt * 0.02 * (fToutAH - runningTinAH);
        const nextHin = calculateRHFromAH(nextTinAH, nextTin);

        const hourLabel = fTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        
        const isHumidityFavorable = nextHin > 60 ? (fToutAH < nextTinAH) : (fToutAH < 13.0);
        let isFavorable = (roomConf.windowOrientation !== null) && fTout < nextTin && !['rainy', 'snowy', 'hail', 'lightning', 'pouring'].includes(fCondition) && fHout < 85 && isHumidityFavorable;
        if (isAcOnInRoom) {
          isFavorable = false;
        }

        timeline.push({
          time: f.datetime,
          hourLabel: hourLabel,
          tout: fTout,
          hout: fHout,
          tin: Math.round(nextTin * 10) / 10,
          hin: nextHin,
          toutAH: fToutAH,
          tinAH: Math.round(nextTinAH * 10) / 10,
          condition: fCondition,
          isFavorable: isFavorable
        });

        runningTin = nextTin;
        runningTinAH = nextTinAH;
      }

      let nextCrossing = null;
      for (let i = 1; i < timeline.length; i++) {
        const prev = timeline[i-1];
        const curr = timeline[i];
        
        const prevD = prev.tin - prev.tout;
        const currD = curr.tin - curr.tout;
        
        if (prevD <= 0 && currD > 0) {
          const frac = -prevD / (currD - prevD);
          const prevTime = new Date(prev.time);
          const currTime = new Date(curr.time);
          const crossedTime = new Date(prevTime.getTime() + frac * (currTime.getTime() - prevTime.getTime()));
          
          const diffMs = crossedTime - now;
          let countdown = "maintenant";
          if (diffMs > 0) {
            const totalMins = Math.floor(diffMs / 60000);
            const hours = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            countdown = hours > 0 ? `dans ${hours}h ${mins}m` : `dans ${mins} min`;
          }

          nextCrossing = {
            type: 'open',
            time: crossedTime.toISOString(),
            timeLabel: crossedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            countdown: countdown,
            tempAtCrossing: Math.round((prev.tin + frac * (curr.tin - prev.tin)) * 10) / 10
          };
          break;
        } else if (prevD > 0 && currD <= 0) {
          const frac = prevD / (prevD - currD);
          const prevTime = new Date(prev.time);
          const currTime = new Date(curr.time);
          const crossedTime = new Date(prevTime.getTime() + frac * (currTime.getTime() - prevTime.getTime()));
          
          const diffMs = crossedTime - now;
          let countdown = "maintenant";
          if (diffMs > 0) {
            const totalMins = Math.floor(diffMs / 60000);
            const hours = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            countdown = hours > 0 ? `dans ${hours}h ${mins}m` : `dans ${mins} min`;
          }

          nextCrossing = {
            type: 'close',
            time: crossedTime.toISOString(),
            timeLabel: crossedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            countdown: countdown,
            tempAtCrossing: Math.round((prev.tin + frac * (curr.tin - prev.tin)) * 10) / 10
          };
          break;
        }
      }

      const isWet = ['rainy', 'snowy', 'hail', 'lightning', 'pouring'].includes(curWeather);
      
      let shouldOpen = false;
      let shouldClose = false;
      let advice = "";

      if (isWet) {
        advice = `Gardez les fenêtres fermées dans le ${roomConf.label} car il pleut actuellement dehors.`;
        shouldOpen = false;
        shouldClose = true;
      } else if (curTout >= curRoomTin) {
        advice = `Gardez les fenêtres fermées. Il fait plus chaud dehors (${curTout.toFixed(1)}°C) qu'à l'intérieur du ${roomConf.label} (${curRoomTin.toFixed(1)}°C).`;
        shouldOpen = false;
        shouldClose = true;
      } else if (!curIsHumidityFavorable) {
        advice = `Gardez les fenêtres fermées dans le ${roomConf.label}. Bien qu'il fasse plus frais dehors (${curTout.toFixed(1)}°C vs ${curRoomTin.toFixed(1)}°C), l'air extérieur est trop humide (Humidité absolue : ${curToutAH.toFixed(1)} g/m³ vs ${curTinAH.toFixed(1)} g/m³).`;
        shouldOpen = false;
        shouldClose = true;
      } else {
        advice = `C'est le moment idéal d'ouvrir la fenêtre du ${roomConf.label} ! Il fait plus frais dehors (${curTout.toFixed(1)}°C vs ${curRoomTin.toFixed(1)}°C) et l'air est sain et sec (${curToutAH.toFixed(1)} g/m³ d'humidité absolue).`;
        shouldOpen = true;
        shouldClose = false;

        if (curCrossVentilationActive) {
          advice += ` Le vent de direction ${curWindBearing}° est aligné, favorisant une ventilation croisée efficace !`;
        }
      }

      if (roomConf.windowOrientation === null) {
        advice = `Cette pièce ne dispose pas de fenêtre donnant sur l'extérieur.`;
        shouldOpen = false;
        shouldClose = false;
        nextCrossing = null;
      }

      roomResults[roomId] = {
        label: roomConf.label,
        hasWindow: roomConf.windowOrientation !== null,
        windowOrientation: roomConf.windowOrientation,
        current: {
          indoorTemp: Math.round(curRoomTin * 10) / 10,
          indoorHum: curRoomHin,
          outdoorTemp: curTout,
          outdoorHum: curHout,
          indoorAH: curTinAH,
          outdoorAH: curToutAH,
          weatherCondition: curWeather,
          shouldOpen: shouldOpen,
          shouldClose: shouldClose,
          isHumidityFavorable: curIsHumidityFavorable,
          advice: advice
        },
        regression: {
          slope: Math.round(slope * 10000) / 10000,
          solarCoeff: Math.round(solarCoeff * 10000) / 10000,
          intercept: Math.round(intercept * 10000) / 10000
        },
        projection: timeline,
        nextCrossing: nextCrossing
      };
    }

    const responseData = {
      timestamp: now.toISOString(),
      rooms: roomResults
    };

    memoryCache.heat = responseData;
    memoryCache.heatTime = nowTime;
    res.json(responseData);
  } catch (error) {
    console.error('Error computing heat management data:', error);
    if (memoryCache.heat) {
      console.warn('Returning stale cached heat management data due to HA connection error');
      return res.json({ ...memoryCache.heat, stale: true });
    }
    res.status(500).json({ error: error.message || 'Failed to compute heat management data' });
  }
});

// Endpoint to trigger vacuum actions
app.post('/api/vacuum/action', express.json(), async (req, res) => {
  try {
    const { action } = req.body;
    if (!['start', 'return_to_base'].includes(action)) {
      return res.status(400).json({ error: 'Invalid vacuum action' });
    }

    const url = `${config.HA_URL}/api/services/vacuum/${action}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.HA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        entity_id: config.entities.roborock_vacuum
      })
    });

    if (!response.ok) {
      throw new Error(`Home Assistant API returned status code ${response.status}`);
    }

    memoryCache.weatherTime = 0;
    res.json({ success: true, message: `Vacuum action ${action} triggered successfully` });
  } catch (error) {
    console.error('Error triggering vacuum action:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger vacuum action' });
  }
});

// Endpoint to control climatisation settings (state, temp, mode, fan speed)
app.post('/api/clim/control', express.json(), async (req, res) => {
  try {
    const { action, value } = req.body;
    const entityId = config.entities.dining_ac || 'switch.clim';
    
    // Default virtual values if not initialized
    if (memoryCache.dining_ac_state === undefined) memoryCache.dining_ac_state = 'off';
    if (memoryCache.dining_ac_temp === undefined) memoryCache.dining_ac_temp = 21;
    if (memoryCache.dining_ac_mode === undefined) memoryCache.dining_ac_mode = 'cool';
    if (memoryCache.dining_ac_fan === undefined) memoryCache.dining_ac_fan = 'auto';
    
    // Check if the entity exists in HA
    const states = await fetchHAStates();
    const hasHAEntity = states.some(s => s.entity_id === entityId);
    
    let newState = memoryCache.dining_ac_state;
    let isVirtual = true;
    let commandText = null;
    let alexaDeviceId = '98c4635e6b0a5e6ceeba0a37414274a0';
    let details = {};
    
    if (hasHAEntity && action === 'toggle') {
      // Toggle it in Home Assistant
      const url = `${config.HA_URL}/api/services/homeassistant/toggle`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.HA_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          entity_id: entityId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Home Assistant API returned status code ${response.status}`);
      }
      
      // Fetch the updated state
      const stateUrl = `${config.HA_URL}/api/states/${entityId}`;
      const stateRes = await fetch(stateUrl, {
        headers: {
          'Authorization': `Bearer ${config.HA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        newState = stateData.state;
        memoryCache.dining_ac_state = newState;
      }
      isVirtual = false;
    } else {
      // Handle direct Alexa commands
      if (action === 'toggle') {
        newState = (memoryCache.dining_ac_state === 'on') ? 'off' : 'on';
        commandText = (newState === 'on') ? 'Allume clim' : 'Eteindre clim';
        memoryCache.dining_ac_state = newState;
      } else if (action === 'set_temp') {
        const tempVal = parseInt(value, 10);
        if (isNaN(tempVal) || tempVal < 16 || tempVal > 30) {
          return res.status(400).json({ error: 'Invalid temperature value (must be 16-30)' });
        }
        commandText = `Met clim à ${tempVal} degrés`;
        memoryCache.dining_ac_temp = tempVal;
        memoryCache.dining_ac_state = 'on';
        newState = 'on';
      } else if (action === 'set_mode') {
        const allowedModes = ['cool', 'heat', 'fan', 'dry', 'auto'];
        if (!allowedModes.includes(value)) {
          return res.status(400).json({ error: 'Invalid mode' });
        }
        
        const modeCommands = {
          cool: 'Met clim en mode climatisation',
          heat: 'Met clim en mode chauffage',
          fan: 'Met clim en mode ventilation',
          dry: 'Met clim en mode déshumidification',
          auto: 'Met clim en mode automatique'
        };
        commandText = modeCommands[value];
        memoryCache.dining_ac_mode = value;
        memoryCache.dining_ac_state = 'on';
        newState = 'on';
      } else if (action === 'set_fan') {
        const allowedFans = ['auto', 'low', 'medium', 'high'];
        if (!allowedFans.includes(value)) {
          return res.status(400).json({ error: 'Invalid fan speed' });
        }
        
        const fanCommands = {
          auto: 'Met la vitesse de la clim sur automatique',
          low: 'Met la vitesse de la clim sur minimum',
          medium: 'Met la vitesse de la clim sur moyen',
          high: 'Met la vitesse de la clim sur maximum'
        };
        commandText = fanCommands[value];
        memoryCache.dining_ac_fan = value;
        memoryCache.dining_ac_state = 'on';
        newState = 'on';
      } else {
        return res.status(400).json({ error: 'Invalid action' });
      }
      
      if (commandText) {
        const url = `${config.HA_URL}/api/services/alexa_devices/send_text_command`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.HA_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            device_id: alexaDeviceId,
            text_command: commandText
          })
        });
        
        if (!response.ok) {
          throw new Error(`Home Assistant API returned status code ${response.status} when sending Alexa command`);
        }
      }
      
      isVirtual = false;
      details = { alexaDevice: alexaDeviceId, command: commandText };
    }
    
    memoryCache.weatherTime = 0; // force refresh
    memoryCache.heatTime = 0; // force refresh heat management cache
    res.json({
      success: true,
      state: newState,
      temp: memoryCache.dining_ac_temp,
      mode: memoryCache.dining_ac_mode,
      fan: memoryCache.dining_ac_fan,
      isVirtual: isVirtual,
      ...details
    });
  } catch (error) {
    console.error('Error controlling AC:', error);
    res.status(500).json({ error: error.message || 'Failed to control AC' });
  }
});

// Endpoint to get config (with token masked for security)
app.get('/api/config', (req, res) => {
  const safeConfig = { ...config };
  if (safeConfig.HA_TOKEN) {
    safeConfig.HA_TOKEN = safeConfig.HA_TOKEN.substring(0, 10) + '...' + safeConfig.HA_TOKEN.substring(safeConfig.HA_TOKEN.length - 10);
  }
  res.json(safeConfig);
});

// Endpoint to update config
app.post('/api/config', express.json(), (req, res) => {
  try {
    const { HA_URL, HA_TOKEN, rooms, entities } = req.body;
    if (!HA_URL) {
      return res.status(400).json({ error: 'HA_URL requis' });
    }

    const newConfig = { ...config, HA_URL };
    if (HA_TOKEN && !HA_TOKEN.includes('...')) {
      newConfig.HA_TOKEN = HA_TOKEN;
    }
    if (rooms) {
      newConfig.rooms = rooms;
    }
    if (entities) {
      newConfig.entities = entities;
    }

    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    config = newConfig;

    memoryCache.weatherTime = 0;
    memoryCache.forecasts = {};
    memoryCache.presenceTime = 0;
    memoryCache.heatTime = 0;

    res.json({ success: true, message: 'Configuration mise à jour avec succès' });
  } catch (error) {
    console.error('Error saving configuration:', error);
    res.status(500).json({ error: error.message || 'Échec de la sauvegarde de la configuration' });
  }
});

app.listen(PORT, () => {
  console.log(`Aether Connected Weather server running at http://localhost:${PORT}`);
});
