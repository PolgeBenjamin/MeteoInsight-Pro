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
  forecasts: {}, // keyed by horizon
  presence: null,
  presenceTime: 0,
  heat: null,
  heatTime: 0
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

// Endpoint for statistical (M2) and ML (M3) predictions
app.get('/api/forecasts', async (req, res) => {
  const horizon = Math.min(24, Math.max(1, parseInt(req.query.horizon) || 3));
  const nowTime = Date.now();
  const cacheKey = horizon;

  if (memoryCache.forecasts[cacheKey] && (nowTime - memoryCache.forecasts[cacheKey].time < 10 * 60 * 1000)) {
    return res.json(memoryCache.forecasts[cacheKey].data);
  }

  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    
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

    const [pressHistory, humHistory, tempHistory, weatherHistory] = await Promise.all([
      fetchHistory(config.entities.netatmo_pressure),
      fetchHistory(config.entities.outdoor_humidity),
      fetchHistory(config.entities.outdoor_temp),
      fetchHistory(config.entities.weather_forecast)
    ]);

    // Align data hourly (168 points)
    const dataset = [];
    const hourlyPoints = 168;

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
      if (activeState === null && history.length > 0) {
        activeState = history[0].state;
      }
      return activeState;
    };

    for (let i = 0; i <= hourlyPoints; i++) {
      const targetTime = new Date(startTime.getTime() + i * 60 * 60 * 1000);
      
      const p = parseFloat(getStateAt(pressHistory, targetTime));
      const h = parseFloat(getStateAt(humHistory, targetTime));
      const t = parseFloat(getStateAt(tempHistory, targetTime));
      const w = getStateAt(weatherHistory, targetTime);

      dataset.push({
        time: targetTime,
        p: isNaN(p) ? null : p,
        h: isNaN(h) ? null : h,
        t: isNaN(t) ? null : t,
        w: w
      });
    }

    for (let i = horizon; i < dataset.length; i++) {
      if (dataset[i].p !== null && dataset[i-horizon].p !== null) {
        dataset[i].dp = dataset[i].p - dataset[i-horizon].p;
      } else {
        dataset[i].dp = 0;
      }
      if (dataset[i].h !== null && dataset[i-horizon].h !== null) {
        dataset[i].dh = dataset[i].h - dataset[i-horizon].h;
      } else {
        dataset[i].dh = 0;
      }
    }

    const trainingSamples = [];
    for (let i = horizon; i < dataset.length - horizon; i++) {
      const current = dataset[i];
      const future = dataset[i + horizon];
      
      if (current.p !== null && current.h !== null && current.t !== null && future.w && future.w !== 'unknown' && future.w !== 'unavailable') {
        trainingSamples.push({
          features: [current.p, current.h, current.t, current.dp, current.dh],
          label: future.w
        });
      }
    }

    const currentIdx = dataset.length - 1;
    const currentP = dataset[currentIdx].p;
    const currentH = dataset[currentIdx].h;
    const currentT = dataset[currentIdx].t;
    const currentDP = dataset[currentIdx].dp || 0;
    const currentDH = dataset[currentIdx].dh || 0;
    
    let m2Forecast = {
      state: 'stable',
      label: 'Stable',
      description: 'Temps stationnaire et calme.',
      icon: 'cloud-sun'
    };

    if (currentP !== null) {
      const scaleFactor = horizon / 3;
      const pTrend = currentDP < (-1.0 * scaleFactor) ? 'falling' : (currentDP > (1.0 * scaleFactor) ? 'rising' : 'stable');
      const hTrend = currentDH < (-3.0 * scaleFactor) ? 'falling' : (currentDH > (3.0 * scaleFactor) ? 'rising' : 'stable');

      if (pTrend === 'falling' && hTrend === 'rising') {
        m2Forecast = { state: 'rainy', label: 'Pluie / Orage', description: 'Chute de pression et hausse d’humidité. Risque fort de précipitations.', icon: 'cloud-lightning' };
      } else if (pTrend === 'falling') {
        m2Forecast = { state: 'cloudy', label: 'Averses / Perturbation', description: 'La pression baisse. Ciel couvert et risque d’averses.', icon: 'cloud-drizzle' };
      } else if (pTrend === 'rising' && hTrend === 'falling') {
        m2Forecast = { state: 'sunny', label: 'Amélioration / Beau temps', description: 'La pression remonte et l’air s’assèche. Retour du soleil.', icon: 'sun' };
      } else if (pTrend === 'rising') {
        m2Forecast = { state: 'cloudy', label: 'Éclaircies', description: 'L’anticyclone se renforce mais de l’humidité persiste. Beau ciel d’éclaircies.', icon: 'cloud-sun' };
      } else {
        if (hTrend === 'rising') {
          m2Forecast = { state: 'cloudy', label: 'Ciel couvert', description: 'Le temps se couvre légèrement sans pluie immédiate.', icon: 'cloud' };
        } else if (hTrend === 'falling') {
          m2Forecast = { state: 'sunny', label: 'Temps Sec', description: 'Ciel dégagé et sec.', icon: 'sun' };
        }
      }
    }

    let m3Forecast = {
      state: 'unknown',
      label: 'Indéterminé',
      confidence: 0,
      trainingSize: trainingSamples.length,
      icon: 'help-circle'
    };

    if (trainingSamples.length > 0 && currentP !== null) {
      const scales = [15, 60, 25, 4, 20];

      const nSamples = trainingSamples.length;
      for (let j = 0; j < 5; j++) {
        let sum = 0;
        trainingSamples.forEach(sample => sum += sample.features[j]);
        const mean = sum / nSamples;
        let sumSq = 0;
        trainingSamples.forEach(sample => sumSq += Math.pow(sample.features[j] - mean, 2));
        const stdDev = Math.sqrt(sumSq / nSamples);
        if (stdDev > 0.01) {
          scales[j] = stdDev;
        }
      }

      const distances = trainingSamples.map(sample => {
        let sumSq = 0;
        for (let j = 0; j < 5; j++) {
          const diff = (sample.features[j] - [currentP, currentH, currentT, currentDP, currentDH][j]) / scales[j];
          sumSq += diff * diff;
        }
        return {
          distance: Math.sqrt(sumSq),
          label: sample.label
        };
      });

      distances.sort((a, b) => a.distance - b.distance);

      const K = Math.min(5, distances.length);
      const neighbors = distances.slice(0, K);

      const votes = {};
      neighbors.forEach(n => {
        votes[n.label] = (votes[n.label] || 0) + 1;
      });

      let predictedLabel = 'unknown';
      let maxVotes = 0;
      for (const label in votes) {
        if (votes[label] > maxVotes) {
          maxVotes = votes[label];
          predictedLabel = label;
        }
      }

      const confidence = Math.round((maxVotes / K) * 100);

      const translations = {
        'sunny': { label: 'Ensoleillé', icon: 'sun' },
        'partlycloudy': { label: 'Éclaircies', icon: 'cloud-sun' },
        'cloudy': { label: 'Couvert', icon: 'cloud' },
        'rainy': { label: 'Pluvieux', icon: 'cloud-rain' },
        'snowy': { label: 'Neigeux', icon: 'snowflake' },
        'clear-night': { label: 'Nuit claire', icon: 'moon' },
        'hail': { label: 'Grêle', icon: 'cloud-hail' },
        'lightning': { label: 'Orageux', icon: 'cloud-lightning' },
        'fog': { label: 'Brumeux', icon: 'cloud-fog' },
        'windy': { label: 'Venteux', icon: 'wind' }
      };

      const trans = translations[predictedLabel] || { label: predictedLabel, icon: 'cloud-sun' };

      m3Forecast = {
        state: predictedLabel,
        label: trans.label,
        confidence: confidence,
        trainingSize: trainingSamples.length,
        icon: trans.icon
      };
    }

    const chartSeries = dataset.slice(-24).map(d => ({
      time: d.time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      p: d.p,
      h: d.h
    }));

    const responseData = {
      timestamp: new Date().toISOString(),
      horizon: horizon,
      current: {
        pressure: currentP,
        humidity: currentH,
        temp: currentT,
        dp: currentDP,
        dh: currentDH
      },
      m2: m2Forecast,
      m3: m3Forecast,
      chart: chartSeries
    };

    memoryCache.forecasts[cacheKey] = {
      time: nowTime,
      data: responseData
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error computing weather forecasts:', error);
    if (memoryCache.forecasts[cacheKey]) {
      console.warn('Returning stale cached forecasts data due to HA connection error');
      return res.json({ ...memoryCache.forecasts[cacheKey].data, stale: true });
    }
    res.status(500).json({ error: error.message || 'Failed to compute forecasts' });
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

// Endpoint for heat management advice and ML projection
app.get('/api/heat-management', async (req, res) => {
  const nowTime = Date.now();
  if (memoryCache.heat && (nowTime - memoryCache.heatTime < 10 * 60 * 1000)) {
    return res.json(memoryCache.heat);
  }

  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    
    const startStr = startTime.toISOString();
    const endStr = now.toISOString();

    // Map dynamic rooms configs
    const roomsConf = {};
    config.rooms.forEach(r => {
      if (r.tempEntity) {
        roomsConf[r.id] = {
          label: r.label,
          tempEntity: r.tempEntity,
          humEntity: r.humEntity || config.entities.netatmo_humidity
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
      if (activeState === null && history.length > 0) {
        activeState = history[0].state;
      }
      return activeState;
    };

    // Fetch forecasts
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

    if (!forecastResponse.ok) throw new Error(`HA API returned ${forecastResponse.status} for weather forecasts`);
    const forecastData = await forecastResponse.json();
    const forecastList = forecastData.service_response?.[config.entities.weather_forecast]?.forecast || [];

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

      const dataset = [];
      const hourlyPoints = 168;
      for (let i = 0; i <= hourlyPoints; i++) {
        const targetTime = new Date(startTime.getTime() + i * 60 * 60 * 1000);
        const tin = parseFloat(getStateAt(tHist, targetTime));
        const tout = parseFloat(getStateAt(outTHist, targetTime));
        const hin = parseFloat(getStateAt(hHist, targetTime));
        const hout = parseFloat(getStateAt(outHHist, targetTime));

        dataset.push({
          tin: isNaN(tin) ? null : tin,
          tout: isNaN(tout) ? null : tout,
          hin: isNaN(hin) ? null : hin,
          hout: isNaN(hout) ? null : hout
        });
      }

      const samples = [];
      for (let i = 0; i < dataset.length - 1; i++) {
        const curr = dataset[i];
        const next = dataset[i + 1];
        if (curr.tin !== null && curr.tout !== null && next.tin !== null) {
          samples.push({
            x: curr.tin - curr.tout,
            y: next.tin - curr.tin
          });
        }
      }

      let slope = -0.005;
      let intercept = 0.007;
      if (samples.length > 10) {
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const n = samples.length;
        for (const s of samples) {
          sumX += s.x;
          sumY += s.y;
          sumXY += s.x * s.y;
          sumXX += s.x * s.x;
        }

        const denom = n * sumXX - sumX * sumX;
        if (denom !== 0) {
          slope = (n * sumXY - sumX * sumY) / denom;
          intercept = (sumY - slope * sumX) / n;
        }
      }

      if (slope >= 0) {
        slope = -0.005;
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
        isFavorable: curTout < curRoomTin && !['rainy', 'snowy', 'hail', 'lightning', 'pouring'].includes(curWeather) && curHout < 85
      });

      let runningTin = curRoomTin;
      let runningTinAH = curTinAH;
      let lastTime = now;

      const projectionLength = Math.min(24, forecastList.length);
      for (let i = 0; i < projectionLength; i++) {
        const f = forecastList[i];
        const fTime = new Date(f.datetime);
        if (fTime <= now) continue;

        const fTout = f.temperature;
        const fHout = f.humidity || 50.0;
        const fCondition = f.condition || 'unknown';
        const fWind = f.wind_speed || 0.0;
        const fCloud = f.cloud_coverage !== undefined ? f.cloud_coverage : 50.0;

        const dt = (fTime - lastTime) / (1000 * 60 * 60);
        lastTime = fTime;

        const effectiveSlope = slope * (1 + 0.01 * fWind);

        const fHour = fTime.getHours();
        const solarIntensity = Math.max(0, Math.cos(((fHour - 13) / 12) * Math.PI));
        const solarGain = 0.04 * (1 - fCloud / 100) * solarIntensity;
        const effectiveIntercept = intercept + solarGain;

        const nextTin = runningTin + dt * (effectiveSlope * (runningTin - fTout) + effectiveIntercept);
        
        const fToutAH = calculateAH(fTout, fHout);
        const nextTinAH = runningTinAH + dt * 0.02 * (fToutAH - runningTinAH);
        const nextHin = calculateRHFromAH(nextTinAH, nextTin);

        const hourLabel = fTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const isFavorable = fTout < nextTin && !['rainy', 'snowy', 'hail', 'lightning', 'pouring'].includes(fCondition) && fHout < 85;

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
      const isFavorableNow = curTout < curRoomTin && !isWet && curHout < 85;

      let shouldOpen = isFavorableNow;
      let shouldClose = !isFavorableNow && curTout > curRoomTin;

      let advice = "";
      if (isWet) {
        advice = `Gardez les fenêtres fermées dans le ${roomConf.label} car il pleut actuellement dehors.`;
        shouldOpen = false;
      } else if (curTout >= curRoomTin) {
        advice = `Gardez les fenêtres fermées. Il fait plus chaud dehors (${curTout.toFixed(1)}°C) qu'à l'intérieur du ${roomConf.label} (${curRoomTin.toFixed(1)}°C).`;
      } else {
        advice = `C'est le moment idéal d'ouvrir la fenêtre du ${roomConf.label} ! Température extérieure : ${curTout.toFixed(1)}°C, ${roomConf.label} : ${curRoomTin.toFixed(1)}°C.`;
        if (curToutAH < curTinAH) {
          advice += ` L'aération permettra d'assécher l'air intérieur (${curHout}% d'humidité dehors).`;
        } else {
          advice += ` Note : l'air extérieur est humide (${curHout}%), cela augmentera légèrement l'humidité.`;
        }
      }

      roomResults[roomId] = {
        label: roomConf.label,
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
          advice: advice
        },
        regression: {
          slope: Math.round(slope * 10000) / 10000,
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
