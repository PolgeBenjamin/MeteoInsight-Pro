// MeteoInsight-Pro - Frontend Dashboard Logic

// Constants
const REFRESH_INTERVAL_SEC = 10;
let refreshTimer = null;
let countdownVal = REFRESH_INTERVAL_SEC;
let lastFetchedData = null;
let roomLayoutList = []; // Loaded dynamically from config

// DOM Elements
const elements = {
  // Header / Controls
  connectionStatus: document.getElementById('connection-status'),
  liveTime: document.getElementById('live-time'),
  liveDate: document.getElementById('live-date'),
  countdown: document.getElementById('countdown'),
  progressBar: document.getElementById('progress-bar'),
  refreshBtn: document.getElementById('refresh-btn'),
  
  // Outdoor Card
  outdoorTemp: document.getElementById('outdoor-temp'),
  outdoorHumidity: document.getElementById('outdoor-humidity'),
  outdoorLastUpdate: document.getElementById('outdoor-last-update'),
  weatherTip: document.getElementById('weather-tip'),
  
  // Mobile Card
  mobileTemp: document.getElementById('mobile-temp'),
  mobileHumidity: document.getElementById('mobile-humidity'),
  
  // Netatmo Card
  netatmoTemp: document.getElementById('netatmo-temp'),
  netatmoHumidity: document.getElementById('netatmo-humidity'),
  netatmoCo2: document.getElementById('netatmo-co2'),
  netatmoNoise: document.getElementById('netatmo-noise'),
  netatmoPressure: document.getElementById('netatmo-pressure'),
  co2Card: document.getElementById('co2-card'),
  co2Status: document.getElementById('co2-status'),
  noiseStatus: document.getElementById('noise-status'),
  pressureStatus: document.getElementById('pressure-status'),
  
  // Rooms (Alexa Grid)
  alexaGrid: document.getElementById('alexa-rooms-grid'),
  
  // Floor Plan Container
  floorPlanContainer: document.getElementById('floor-plan-container'),

  // Air Purifier
  purifierPm25: document.getElementById('purifier-pm25'),
  purifierStatus: document.getElementById('purifier-status'),
  airCard: document.getElementById('air-card'),

  // Ephemeris & Presence
  valSun: document.getElementById('val-sun'),
  valSunrise: document.getElementById('val-sunrise'),
  valSunset: document.getElementById('val-sunset'),
  valPresence: document.getElementById('val-presence'),
  valIphoneBattery: document.getElementById('val-iphone-battery'),

  // Roborock Card Controls
  vacuumBadgeState: document.getElementById('vacuum-badge-state'),
  vacuumRoom: document.getElementById('vacuum-room'),
  vacuumBattery: document.getElementById('vacuum-battery'),
  btnVacuumStart: document.getElementById('btn-vacuum-start'),
  btnVacuumDock: document.getElementById('btn-vacuum-dock'),

  // AC Card Controls
  acBadgeState: document.getElementById('ac-badge-state'),
  btnAcToggle: document.getElementById('btn-ac-toggle')
};

// Map Alexa Rooms to Lucide Icons
const roomIcons = {
  salon: 'tv',
  cuisine: 'utensils',
  bureau: 'laptop',
  salle_de_bain: 'bath',
  chambre: 'bed',
  salle_a_manger: 'glass-water'
};

// Initialize app
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  
  // Initial fetch (load config first, then build SVG, then weather)
  fetchConfigAndBuildSVG();
  
  // Set up click handler for manual refresh
  elements.refreshBtn.addEventListener('click', () => {
    resetCountdown();
    fetchWeatherData();
  });
  
  // Set up the countdown interval (runs every second)
  setInterval(runCountdown, 1000);

  // Set up layer switcher event listeners
  setupLayerSwitcher();

  // Set up vacuum controls event listeners
  setupVacuumControls();

  // Set up AC controls event listeners
  setupACControls();
}

// Fetch configuration from server to draw SVG floor plan dynamically
async function fetchConfigAndBuildSVG() {
  setConnectionStatus('loading');
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error('Failed to fetch config');
    const data = await res.json();
    roomLayoutList = data.rooms || [];
    
    // Dynamically draw rooms onto floor plan SVG
    drawRoomsSVG(roomLayoutList);
    
    // Fetch current weather data
    fetchWeatherData();
  } catch (err) {
    console.error('Error loading config:', err);
    setConnectionStatus('error');
  }
}

// Draw rooms dynamically on the blueprint SVG
function drawRoomsSVG(rooms) {
  const group = document.getElementById('svg-rooms-group');
  if (!group) return;
  group.innerHTML = ''; // clear

  rooms.forEach(room => {
    const roomG = document.createElementNS("http://www.w3.org/2000/svg", "g");
    roomG.id = `svg-room-${room.id}`;
    roomG.setAttribute('class', 'svg-room');
    roomG.setAttribute('data-room-id', room.id);
    
    const addRect = (cls, fillAttr) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute('x', room.x);
      rect.setAttribute('y', room.y);
      rect.setAttribute('width', room.w);
      rect.setAttribute('height', room.h);
      rect.setAttribute('rx', 14);
      rect.setAttribute('class', cls);
      if (fillAttr) rect.setAttribute('fill', fillAttr);
      roomG.appendChild(rect);
    };

    addRect('room-rect');
    addRect('room-overlay thermal-overlay');
    addRect('room-overlay light-overlay', 'url(#light-grad)');
    addRect('room-overlay humidity-overlay', 'url(#humidity-grad)');
    addRect('room-overlay motion-overlay');

    // Salon features like co2 overlay and soundwaves
    if (room.id === 'salon') {
      const co2 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      co2.setAttribute('x', room.x);
      co2.setAttribute('y', room.y);
      co2.setAttribute('width', room.w);
      co2.setAttribute('height', room.h);
      co2.setAttribute('rx', 14);
      co2.setAttribute('class', 'room-overlay co2-overlay');
      co2.setAttribute('fill', 'url(#co2-grad)');
      co2.id = 'co2-fog-overlay';
      roomG.appendChild(co2);

      const soundG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      soundG.setAttribute('class', 'soundwave-container');
      soundG.id = 'soundwave-overlay';
      
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      for (let rVal of [20, 40, 60]) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', rVal);
        circle.setAttribute('class', `soundwave-ring ring-${rVal/20}`);
        soundG.appendChild(circle);
      }
      roomG.appendChild(soundG);
    }

    // Salle à manger features like ac indicator
    if (room.id === 'salle_a_manger') {
      const acIndicator = document.createElementNS("http://www.w3.org/2000/svg", "g");
      acIndicator.id = 'svg-ac-indicator';
      acIndicator.setAttribute('class', 'ac-indicator-container');
      acIndicator.style.display = 'none'; // hidden by default

      // Small background circle
      const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circ.setAttribute('cx', room.x + room.w - 25);
      circ.setAttribute('cy', room.y + 25);
      circ.setAttribute('r', 12);
      circ.setAttribute('fill', 'rgba(59, 130, 246, 0.15)');
      circ.setAttribute('stroke', 'rgba(59, 130, 246, 0.4)');
      circ.setAttribute('stroke-width', '1.5');
      acIndicator.appendChild(circ);

      // Simple wind symbol (3 lines) in SVG
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute('d', `M ${room.x + room.w - 30} ${room.y + 22} h 8 M ${room.x + room.w - 32} ${room.y + 25} h 12 M ${room.x + room.w - 29} ${room.y + 28} h 7`);
      path.setAttribute('stroke', 'var(--color-primary)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('class', 'ac-wind-lines');
      acIndicator.appendChild(path);

      roomG.appendChild(acIndicator);
    }

    const addText = (cls, dy, text) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
      el.setAttribute('x', room.x + room.w / 2);
      el.setAttribute('y', room.y + room.h / 2 + dy);
      el.setAttribute('class', cls);
      el.textContent = text;
      roomG.appendChild(el);
    };

    addText('room-label', -10, room.label);
    addText('room-temp-val', 15, '--');
    addText('room-sub-val', 35, '--');

    // Draw window indicator if windowOrientation is present
    if (room.windowOrientation !== null && room.windowOrientation !== undefined) {
      const angle = (room.windowOrientation + 360) % 360;
      // The SVG floor plan is rotated 180 degrees compared to standard compass directions:
      // - North (0°) is at the Bottom
      // - East (90°) is at the Left
      // - South (180°) is at the Top
      // - West (270°) is at the Right
      // To display the windows on the correct outer walls, we rotate the angle by 180 degrees visually.
      const visualAngle = (angle + 180) % 360;
      const winRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      winRect.setAttribute('fill', '#38bdf8');
      winRect.setAttribute('stroke', '#0ea5e9');
      winRect.setAttribute('stroke-width', '1.5');
      winRect.setAttribute('class', 'room-window');
      winRect.setAttribute('rx', '1.5');
      
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `Fenêtre (Exposition : ${room.windowOrientation}°)`;
      winRect.appendChild(title);

      const length = 28;
      const thickness = 5;

      if (visualAngle >= 315 || visualAngle < 45) { // North on plan (physical South) -> Top wall
        winRect.setAttribute('x', room.x + room.w / 2 - length / 2);
        winRect.setAttribute('y', room.y - thickness / 2);
        winRect.setAttribute('width', length);
        winRect.setAttribute('height', thickness);
      } else if (visualAngle >= 45 && visualAngle < 135) { // East on plan (physical West) -> Right wall
        winRect.setAttribute('x', room.x + room.w - thickness / 2);
        winRect.setAttribute('y', room.y + room.h / 2 - length / 2);
        winRect.setAttribute('width', thickness);
        winRect.setAttribute('height', length);
      } else if (visualAngle >= 135 && visualAngle < 225) { // South on plan (physical North) -> Bottom wall
        winRect.setAttribute('x', room.x + room.w / 2 - length / 2);
        winRect.setAttribute('y', room.y + room.h - thickness / 2);
        winRect.setAttribute('width', length);
        winRect.setAttribute('height', thickness);
      } else { // West on plan (physical East) -> Left wall
        winRect.setAttribute('x', room.x - thickness / 2);
        winRect.setAttribute('y', room.y + room.h / 2 - length / 2);
        winRect.setAttribute('width', thickness);
        winRect.setAttribute('height', length);
      }
      roomG.appendChild(winRect);
    }

    group.appendChild(roomG);
  });
}

// Layer Switcher Tab Logic
function setupLayerSwitcher() {
  const switcherBtns = document.querySelectorAll('.switcher-btn');
  switcherBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switcherBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const view = btn.getAttribute('data-view');
      elements.floorPlanContainer.setAttribute('data-active-view', view);
      
      const legends = ['standard', 'thermal', 'light', 'humidity', 'air', 'motion'];
      legends.forEach(l => {
        const legendEl = document.getElementById(`legend-${l}`);
        if (legendEl) {
          legendEl.style.display = l === view || (view === 'air-noise' && l === 'air') ? 'flex' : 'none';
        }
      });
      
      if (lastFetchedData) {
        updateFloorPlan(lastFetchedData);
      }
    });
  });
}

// Update clock and date display
function updateClock() {
  const now = new Date();
  
  elements.liveTime.textContent = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const formattedDate = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  elements.liveDate.textContent = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
}

// Countdown timer logic
function runCountdown() {
  countdownVal--;
  if (countdownVal < 0) {
    countdownVal = REFRESH_INTERVAL_SEC;
    fetchWeatherData();
  }
  
  elements.countdown.textContent = countdownVal;
  const percent = (countdownVal / REFRESH_INTERVAL_SEC) * 100;
  elements.progressBar.style.width = `${percent}%`;
}

// Reset the automatic countdown refresh
function resetCountdown() {
  countdownVal = REFRESH_INTERVAL_SEC;
  elements.countdown.textContent = countdownVal;
  elements.progressBar.style.width = '100%';
}

// Fetch weather details from Node.js proxy server
async function fetchWeatherData() {
  setConnectionStatus('loading');
  try {
    const response = await fetch('api/weather');
    if (!response.ok) throw new Error('API server returned error');
    
    const data = await response.json();
    updateUI(data);
    setConnectionStatus('online');
  } catch (error) {
    console.error('Error loading weather data:', error);
    setConnectionStatus('error');
  }
}

// Connection Status visual styles
function setConnectionStatus(status) {
  if (elements.connectionStatus) {
    elements.connectionStatus.className = 'pulse-indicator';
  }
  
  const refreshIcon = elements.refreshBtn ? (elements.refreshBtn.querySelector('i') || elements.refreshBtn.querySelector('svg')) : null;
  if (refreshIcon) {
    refreshIcon.classList.remove('spin');
  }
  
  if (status === 'online') {
    if (elements.connectionStatus) elements.connectionStatus.classList.add('status-online');
  } else if (status === 'loading') {
    if (elements.connectionStatus) elements.connectionStatus.classList.add('status-loading');
    if (refreshIcon) refreshIcon.classList.add('spin');
  } else {
    if (elements.connectionStatus) elements.connectionStatus.classList.add('status-error');
  }
}

// Safely update DOM text content and trigger flash animation
function updateValue(element, newValue, unit = '') {
  if (!element) return;
  const rawValue = newValue !== null && newValue !== undefined ? `${newValue}${unit}` : '--';
  
  if (element.textContent !== rawValue) {
    element.textContent = rawValue;
    element.classList.remove('flash-value');
    void element.offsetWidth; // Force reflow
    element.classList.add('flash-value');
  }
}

// Master UI Update logic
function updateUI(data) {
  lastFetchedData = data;

  // 1. OUTDOOR CARD
  updateValue(elements.outdoorTemp, data.outdoor.temp);
  updateValue(elements.outdoorHumidity, data.outdoor.humidity, ' %');
  
  if (data.timestamp) {
    const timeStr = new Date(data.timestamp).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    elements.outdoorLastUpdate.textContent = `à ${timeStr}`;
  }
  
  let tipText = "Conditions agréables.";
  const oTemp = data.outdoor.temp;
  const oHygro = data.outdoor.humidity;
  
  if (oTemp !== null) {
    if (oTemp > 30) tipText = "Fortes chaleurs à l'extérieur. Hydratez-vous bien et fermez les stores.";
    else if (oTemp > 24) tipText = "Temps très doux dehors. Agréable journée.";
    else if (oTemp < 5) tipText = "Temps très frais à l'extérieur. Attention aux gelées.";
    else if (oTemp < 15) tipText = "Fraîcheur extérieure de saison. Pensez à vous couvrir.";
  }
  if (oHygro !== null && oHygro > 80) {
    tipText += " Humidité extérieure élevée, risques d'averses.";
  }
  elements.weatherTip.textContent = tipText;

  // 2. INDOOR MOBILE CARD
  updateValue(elements.mobileTemp, data.mobile.temp);
  updateValue(elements.mobileHumidity, data.mobile.humidity, ' %');

  // 3. NETATMO CARD (Salon details)
  updateValue(elements.netatmoTemp, data.netatmo.temp);
  updateValue(elements.netatmoHumidity, data.netatmo.humidity, '%');
  updateValue(elements.netatmoCo2, data.netatmo.co2, ' ppm');
  updateValue(elements.netatmoNoise, data.netatmo.noise, ' dB');
  updateValue(elements.netatmoPressure, data.netatmo.pressure, ' hPa');

  // Air Quality Status classification
  const co2 = data.netatmo.co2;
  elements.co2Card.className = 'netatmo-sub-card';
  if (co2 === null) {
    elements.co2Status.textContent = 'Indéterminé';
  } else if (co2 < 700) {
    elements.co2Card.classList.add('co2-good');
    elements.co2Status.textContent = 'Excellent';
  } else if (co2 <= 1000) {
    elements.co2Card.classList.add('co2-warning');
    elements.co2Status.textContent = 'Modéré';
  } else {
    elements.co2Card.classList.add('co2-danger');
    elements.co2Status.textContent = 'Aérer !';
  }

  // Noise classification
  const noise = data.netatmo.noise;
  if (noise === null) elements.noiseStatus.textContent = 'Indéterminé';
  else if (noise < 40) elements.noiseStatus.textContent = 'Tranquille';
  else if (noise <= 55) elements.noiseStatus.textContent = 'Ambiant';
  else elements.noiseStatus.textContent = 'Bruyant';

  // Pressure advice
  const press = data.netatmo.pressure;
  if (press === null) elements.pressureStatus.textContent = 'Indéterminé';
  else if (press > 1020) elements.pressureStatus.textContent = 'Anticyclonique';
  else if (press < 1010) elements.pressureStatus.textContent = 'Dépressionnaire';
  else elements.pressureStatus.textContent = 'Stable';

  // Air Purifier
  if (data.air_purifier) {
    updateValue(elements.purifierPm25, data.air_purifier.pm25, ' µg/m³');
    const airQuality = data.air_purifier.quality;
    if (elements.purifierStatus) {
      elements.purifierStatus.textContent = airQuality || 'Indéterminé';
    }
    if (elements.airCard) {
      elements.airCard.className = 'netatmo-sub-card';
      if (data.air_purifier.pm25 === null) {
        // empty
      } else if (data.air_purifier.pm25 <= 12) {
        elements.airCard.classList.add('co2-good');
      } else if (data.air_purifier.pm25 <= 35) {
        elements.airCard.classList.add('co2-warning');
      } else {
        elements.airCard.classList.add('co2-danger');
      }
    }
  }

  // Presence & Ephemeris
  if (data.presence) {
    const isHome = data.presence.benjamin === 'home';
    updateValue(elements.valPresence, isHome ? 'Présent' : 'Absent');
    const presenceWidget = document.getElementById('widget-presence');
    if (presenceWidget) {
      if (isHome) {
        presenceWidget.classList.add('widget-active');
        presenceWidget.classList.remove('widget-inactive');
      } else {
        presenceWidget.classList.add('widget-inactive');
        presenceWidget.classList.remove('widget-active');
      }
    }
    updateValue(elements.valIphoneBattery, data.presence.iphone_battery, '%');
  }

  if (data.ephemeris) {
    let sunText = 'Indéterminé';
    if (data.ephemeris.sun_state === 'above_horizon') sunText = 'Levé';
    else if (data.ephemeris.sun_state === 'below_horizon') sunText = 'Couché';
    updateValue(elements.valSun, sunText);

    const formatTime = (isoString) => {
      if (!isoString) return '--:--';
      try {
        const date = new Date(isoString);
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '--:--';
      }
    };
    updateValue(elements.valSunrise, formatTime(data.ephemeris.next_rising));
    updateValue(elements.valSunset, formatTime(data.ephemeris.next_setting));
  }

  // 4. INTERACTIVE SVG FLOOR PLAN OVERLAYS PAINTING
  updateFloorPlan(data);

  // 4b. ROBOVAC POSITIONING
  if (data.roborock) {
    updateRobovac(data.roborock);
  }

  // 5. ALEXA ROOMS GRID (Dynamic tiles)
  elements.alexaGrid.innerHTML = '';
  
  data.alexa.forEach(room => {
    const iconName = roomIcons[room.id] || 'home';
    const tile = document.createElement('div');
    tile.className = 'room-tile animate-fade-in';
    
    let primaryAccentColor = 'var(--color-primary)';
    if (room.id === 'cuisine') primaryAccentColor = 'var(--color-warning)';
    if (room.id === 'salle_de_bain') primaryAccentColor = 'var(--color-secondary)';
    if (room.id === 'bureau') primaryAccentColor = 'var(--color-accent)';
    if (room.id === 'chambre') primaryAccentColor = 'var(--color-success)';
    
    tile.style.setProperty('--color-primary', primaryAccentColor);
    
    const formattedTemp = room.temp !== null && typeof room.temp === 'number' ? room.temp.toFixed(1) : '--';
    const formattedLight = room.light !== null && typeof room.light === 'number' ? Math.round(room.light) : '--';
    
    tile.innerHTML = `
      <div class="room-tile-header">
        <span class="room-name">${room.label}</span>
        <i data-lucide="${iconName}" class="room-icon"></i>
      </div>
      <div class="room-tile-body">
        <div class="temp-section">
          <span class="room-temp">${formattedTemp}</span>
          <span class="room-unit">°C</span>
        </div>
        <div class="light-section" title="Luminosité ambiante">
          <i data-lucide="sun" class="icon-light"></i>
          <span class="room-light">${formattedLight}</span>
          <span class="light-unit">lx</span>
        </div>
      </div>
    `;
    elements.alexaGrid.appendChild(tile);
  });
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Update the 2D SVG Floor Plan overlays dynamically
function updateFloorPlan(data) {
  if (!roomLayoutList) return;

  roomLayoutList.forEach(room => {
    // Find matching alexa state if configured
    const alexaState = data.alexa.find(r => r.id === room.id) || { temp: null, light: null, motion: null };
    
    let temp = alexaState.temp;
    let humidity = null;
    let co2 = null;
    let noise = null;
    let motion = alexaState.motion;
    let light = alexaState.light;

    // Load custom sensor mappings or fallbacks
    if (room.id === 'salon' || room.id === 'salle_a_manger') {
      temp = data.netatmo.temp;
      humidity = data.netatmo.humidity;
      co2 = data.netatmo.co2;
      noise = data.netatmo.noise;
    }

    updateSVGRoom(room.id, temp, light, humidity, co2, noise, motion);
  });
}

// Helper to update a single room SVG visual layers
function updateSVGRoom(roomId, temp, light, humidity, co2 = null, noise = null, motion = null) {
  const roomGroup = document.getElementById(`svg-room-${roomId}`);
  if (!roomGroup) return;

  const tempValText = roomGroup.querySelector('.room-temp-val');
  const subValText = roomGroup.querySelector('.room-sub-val');
  const activeView = elements.floorPlanContainer.getAttribute('data-active-view') || 'standard';

  if (tempValText) {
    if (temp !== null && typeof temp === 'number') {
      tempValText.textContent = `${temp.toFixed(1)}°C`;
      tempValText.style.display = 'block';
    } else {
      tempValText.style.display = 'none';
    }
  }

  if (subValText) {
    if (activeView === 'light') {
      subValText.textContent = light !== null && typeof light === 'number' ? `${Math.round(light)} lx` : '--';
      subValText.style.display = 'block';
    } else if (activeView === 'humidity') {
      subValText.textContent = humidity !== null && typeof humidity === 'number' ? `${Math.round(humidity)}%` : '--';
      subValText.style.display = 'block';
    } else if (activeView === 'air-noise') {
      if (roomId === 'salon' || roomId === 'salle_a_manger') {
        const co2Val = co2 !== null ? `${co2} ppm` : '--';
        const noiseVal = noise !== null ? `${noise} dB` : '--';
        subValText.textContent = `${co2Val} / ${noiseVal}`;
        subValText.style.display = 'block';
      } else {
        subValText.style.display = 'none';
      }
    } else if (activeView === 'motion') {
      if (motion !== null) {
        subValText.textContent = motion === 'on' ? 'Mouvement' : 'Calme';
        subValText.style.display = 'block';
      } else {
        subValText.textContent = 'Aucun capt.';
        subValText.style.display = 'block';
      }
    } else {
      subValText.style.display = 'none';
    }
  }

  const thermalOverlay = roomGroup.querySelector('.thermal-overlay');
  if (thermalOverlay) {
    if (temp !== null && typeof temp === 'number') {
      thermalOverlay.style.fill = getThermalColor(temp);
    } else {
      thermalOverlay.style.fill = 'transparent';
    }
  }

  const lightOverlay = roomGroup.querySelector('.light-overlay');
  if (lightOverlay) {
    if (activeView === 'light' && light !== null && typeof light === 'number') {
      const opacity = Math.min(Math.max(light / 100, 0.05), 0.9);
      lightOverlay.style.opacity = opacity;
    } else {
      lightOverlay.style.opacity = 0;
    }
  }

  const humidityOverlay = roomGroup.querySelector('.humidity-overlay');
  if (humidityOverlay) {
    if (activeView === 'humidity' && humidity !== null && typeof humidity === 'number') {
      const opacity = Math.min(Math.max((humidity - 35) / 40, 0.05), 0.75);
      humidityOverlay.style.opacity = opacity;
    } else {
      humidityOverlay.style.opacity = 0;
    }
  }

  if (roomId === 'salon') {
    const co2Overlay = document.getElementById('co2-fog-overlay');
    if (co2Overlay) {
      if (activeView === 'air-noise' && co2 !== null && typeof co2 === 'number') {
        const opacity = Math.min(Math.max((co2 - 400) / 800, 0.1), 0.85);
        co2Overlay.style.opacity = opacity;
        if (co2 > 1000) {
          co2Overlay.classList.add('co2-heavy-pulse');
        } else {
          co2Overlay.classList.remove('co2-heavy-pulse');
        }
      } else {
        co2Overlay.style.opacity = 0;
        co2Overlay.classList.remove('co2-heavy-pulse');
      }
    }

    const soundwaveOverlay = document.getElementById('soundwave-overlay');
    if (soundwaveOverlay) {
      if (noise !== null && typeof noise === 'number' && noise > 45) {
        soundwaveOverlay.style.display = 'inline';
        const rings = soundwaveOverlay.querySelectorAll('.soundwave-ring');
        const duration = Math.max(2.2 - ((noise - 45) / 35) * 1.5, 0.5);
        rings.forEach(ring => {
          ring.style.animationDuration = `${duration}s`;
          ring.style.strokeWidth = `${Math.min(1.5 + (noise - 45) / 10, 4)}px`;
        });
      } else {
        soundwaveOverlay.style.display = 'none';
      }
    }
  }

  const motionOverlay = roomGroup.querySelector('.motion-overlay');
  if (motionOverlay) {
    if (activeView === 'motion') {
      if (motion === 'on') {
        motionOverlay.style.fill = 'rgba(34, 197, 94, 0.4)';
        motionOverlay.style.opacity = '1';
      } else if (motion === 'off') {
        motionOverlay.style.fill = 'rgba(255, 255, 255, 0.03)';
        motionOverlay.style.opacity = '0.3';
      } else {
        motionOverlay.style.fill = 'transparent';
        motionOverlay.style.opacity = '0';
      }
    } else {
      motionOverlay.style.opacity = '0';
    }
  }
}

// Thermal HSL Color mapping helper
function getThermalColor(temp) {
  if (temp === null || temp === undefined || isNaN(temp)) return 'transparent';
  let hue;
  if (temp <= 16) {
    hue = 220;
  } else if (temp <= 23) {
    const pct = (temp - 16) / (23 - 16);
    hue = 220 - pct * (220 - 40);
  } else if (temp <= 25) {
    const pct = (temp - 23) / (25 - 23);
    hue = 40 - pct * (40 - 20);
  } else if (temp <= 28) {
    const pct = (temp - 25) / (28 - 25);
    hue = 20 - pct * (20 - 0);
  } else {
    hue = 0;
  }
  return `hsl(${hue}, 80%, 45%)`;
}

// Add CSS keyframes for rotation spin on refresh btn
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .spin {
    animation: spin 1s infinite linear;
  }
`;
document.head.appendChild(style);

// Normalize Home Assistant room names to map to SVG room IDs
function getRoomKey(haRoomName) {
  if (!haRoomName) return null;
  const normalized = haRoomName.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, '_');
  
  if (normalized.includes('salle_de_bain') || normalized.includes('sdb') || normalized.includes('bathroom')) return 'salle_de_bain';
  if (normalized.includes('salle_a_manger') || normalized.includes('manger') || normalized.includes('dining')) return 'salle_a_manger';
  if (normalized.includes('salon') || normalized.includes('sejour') || normalized.includes('living')) return 'salon';
  if (normalized.includes('bureau') || normalized.includes('office')) return 'bureau';
  if (normalized.includes('cuisine') || normalized.includes('kitchen')) return 'cuisine';
  if (normalized.includes('chambre') || normalized.includes('bedroom')) return 'chambre';
  if (normalized.includes('hall') || normalized.includes('entree') || normalized.includes('lobby')) return 'hall';
  if (normalized.includes('wc') || normalized.includes('toilet')) return 'wc';
  if (normalized.includes('couloir') || normalized.includes('corridor')) return 'couloir';
  
  return null;
}

// Update Roborock icon position and status details
function updateRobovac(roborock) {
  const robovacGroup = document.getElementById('robovac-group');
  if (!robovacGroup || !roborock) return;

  const isDocked = roborock.state === 'docked';
  const isCleaning = roborock.state === 'cleaning' || roborock.state === 'sweeping' || roborock.state === 'mopping' || roborock.status === 'cleaning';
  
  let targetCoords = null;
  
  if (isDocked) {
    targetCoords = { x: 275, y: 32 };
  } else {
    const roomKey = getRoomKey(roborock.room);
    const room = roomLayoutList.find(r => r.id === roomKey);
    if (room) {
      targetCoords = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
    } else {
      targetCoords = { x: 275, y: 60 }; 
    }
  }

  if (window.robovacAnimInterval) {
    clearInterval(window.robovacAnimInterval);
    window.robovacAnimInterval = null;
  }

  if (targetCoords) {
    robovacGroup.style.opacity = '1';
    if (isCleaning) {
      let tick = 0;
      robovacGroup.setAttribute('transform', `translate(${targetCoords.x}, ${targetCoords.y})`);
      window.robovacAnimInterval = setInterval(() => {
        tick += 0.15;
        const dx = Math.sin(tick) * 14;
        const dy = Math.cos(tick * 0.7) * 10;
        robovacGroup.setAttribute('transform', `translate(${targetCoords.x + dx}, ${targetCoords.y + dy})`);
      }, 150);
    } else {
      robovacGroup.setAttribute('transform', `translate(${targetCoords.x}, ${targetCoords.y})`);
    }
  } else {
    robovacGroup.style.opacity = '0';
  }

  const pulse = document.getElementById('robovac-pulse');
  if (pulse) {
    pulse.style.display = isCleaning ? 'block' : 'none';
  }

  const led = document.getElementById('robovac-led');
  if (led) {
    if (isCleaning) {
      led.setAttribute('fill', '#3b82f6');
    } else if (roborock.status === 'charging' || roborock.status === 'charge') {
      led.setAttribute('fill', '#f59e0b');
    } else {
      led.setAttribute('fill', '#10b981');
    }
  }

  const stateLabels = {
    'docked': 'Sur sa base',
    'cleaning': 'En nettoyage',
    'returning': 'Retour à la base',
    'paused': 'En pause',
    'idle': 'Inactif',
    'charging': 'En charge'
  };

  const label = stateLabels[roborock.state] || roborock.state || 'Statut inconnu';
  
  if (elements.vacuumBadgeState) {
    let cleanStatus = label;
    if (roborock.status === 'charging' || roborock.status === 'charge') {
      cleanStatus = 'En charge';
    }
    elements.vacuumBadgeState.textContent = cleanStatus;
  }
  if (elements.vacuumRoom) {
    elements.vacuumRoom.textContent = isDocked ? 'Station de charge' : (roborock.room || 'Inconnu');
  }
  if (elements.vacuumBattery) {
    elements.vacuumBattery.textContent = roborock.battery !== null ? `${roborock.battery}%` : '--%';
  }

  const batteryInfo = roborock.battery !== null ? ` (Batterie: ${roborock.battery}%)` : '';
  const roomInfo = roborock.room && !isDocked ? ` dans le ${roborock.room}` : '';
  
  let titleEl = document.getElementById('robovac-title');
  if (!titleEl) {
    titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.id = 'robovac-title';
    robovacGroup.insertBefore(titleEl, robovacGroup.firstChild);
  }
  titleEl.textContent = `Roborock Qrevo : ${label}${roomInfo}${batteryInfo}`;

  // 8. CLIMATISATION CARD & SVG INDICATOR
  updateACCardState(data.dining_ac);
}

// Setup Vacuum button listeners for POST requests to Node server
function setupVacuumControls() {
  if (elements.btnVacuumStart) {
    elements.btnVacuumStart.addEventListener('click', async () => {
      elements.btnVacuumStart.disabled = true;
      try {
        const res = await fetch('api/vacuum/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' })
        });
        if (!res.ok) throw new Error('Failed to start cleaning');
        setTimeout(fetchWeatherData, 1000);
      } catch (err) {
        console.error(err);
        alert('Erreur lors du démarrage du Roborock');
      } finally {
        elements.btnVacuumStart.disabled = false;
      }
    });
  }

  if (elements.btnVacuumDock) {
    elements.btnVacuumDock.addEventListener('click', async () => {
      elements.btnVacuumDock.disabled = true;
      try {
        const res = await fetch('api/vacuum/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'return_to_base' })
        });
        if (!res.ok) throw new Error('Failed to dock vacuum');
        setTimeout(fetchWeatherData, 1000);
      } catch (err) {
        console.error(err);
        alert('Erreur lors du renvoi à la base du Roborock');
      } finally {
        elements.btnVacuumDock.disabled = false;
      }
    });
  }
}

// Setup AC button listeners
function setupACControls() {
  if (elements.btnAcToggle) {
    elements.btnAcToggle.addEventListener('click', async () => {
      controlAC('toggle');
    });
  }
  
  const btnTempDown = document.getElementById('btn-ac-temp-down');
  const btnTempUp = document.getElementById('btn-ac-temp-up');
  if (btnTempDown && btnTempUp) {
    btnTempDown.addEventListener('click', () => {
      const currentVal = parseInt(document.getElementById('ac-temp-val').textContent, 10) || 21;
      if (currentVal > 16) {
        controlAC('set_temp', currentVal - 1);
      }
    });
    btnTempUp.addEventListener('click', () => {
      const currentVal = parseInt(document.getElementById('ac-temp-val').textContent, 10) || 21;
      if (currentVal < 30) {
        controlAC('set_temp', currentVal + 1);
      }
    });
  }
  
  document.querySelectorAll('.ac-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      controlAC('set_mode', mode);
    });
  });

  document.querySelectorAll('.ac-fan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fan = btn.getAttribute('data-fan');
      controlAC('set_fan', fan);
    });
  });
}

// Call API to control AC state/parameters
async function controlAC(action, value = null) {
  const controls = [
    elements.btnAcToggle,
    document.getElementById('btn-ac-temp-down'),
    document.getElementById('btn-ac-temp-up'),
    ...document.querySelectorAll('.ac-mode-btn'),
    ...document.querySelectorAll('.ac-fan-btn')
  ];
  
  controls.forEach(c => { if (c) c.disabled = true; });
  
  try {
    const res = await fetch('api/clim/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value })
    });
    if (!res.ok) throw new Error('Failed to control AC');
    const data = await res.json();
    
    // Update UI state immediately
    updateACCardState(data);
    
    // Show last Alexa command sent
    if (data.command) {
      const cmdRow = document.getElementById('ac-last-cmd-row');
      const cmdText = document.getElementById('ac-last-cmd-text');
      if (cmdRow && cmdText) {
        cmdText.textContent = `"${data.command}"`;
        cmdRow.style.display = 'flex';
        clearTimeout(window._acCmdTimer);
        window._acCmdTimer = setTimeout(() => {
          cmdRow.style.display = 'none';
        }, 6000);
      }
    }
    
    setTimeout(fetchWeatherData, 1000);
  } catch (err) {
    console.error(err);
    alert('Erreur lors du pilotage de la climatisation');
  } finally {
    controls.forEach(c => { if (c) c.disabled = false; });
  }
}

function updateACCardState(acData) {
  if (!acData) return;
  const state = acData.state;
  const isOn = state === 'on';
  
  if (elements.acBadgeState) {
    elements.acBadgeState.textContent = isOn ? 'Allumée' : 'Éteinte';
    if (isOn) {
      elements.acBadgeState.style.background = 'rgba(59, 130, 246, 0.15)';
      elements.acBadgeState.style.borderColor = 'rgba(59, 130, 246, 0.3)';
      elements.acBadgeState.style.color = 'var(--color-primary)';
    } else {
      elements.acBadgeState.style.background = 'rgba(107, 114, 128, 0.15)';
      elements.acBadgeState.style.borderColor = 'rgba(107, 114, 128, 0.3)';
      elements.acBadgeState.style.color = '#6b7280';
    }
  }

  // Update SVG indicator class
  const acSvg = document.getElementById('svg-ac-indicator');
  if (acSvg) {
    if (isOn) {
      acSvg.style.display = 'block';
      acSvg.classList.add('ac-active');
    } else {
      acSvg.style.display = 'none';
      acSvg.classList.remove('ac-active');
    }
  }

  // Update Target Temperature
  const tempValEl = document.getElementById('ac-temp-val');
  if (tempValEl && acData.temp !== undefined) {
    tempValEl.textContent = `${acData.temp}°C`;
  }

  // Update Mode button classes
  if (acData.mode !== undefined) {
    document.querySelectorAll('.ac-mode-btn').forEach(btn => {
      const mode = btn.getAttribute('data-mode');
      if (mode === acData.mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Update Fan speed button classes
  if (acData.fan !== undefined) {
    document.querySelectorAll('.ac-fan-btn').forEach(btn => {
      const fan = btn.getAttribute('data-fan');
      if (fan === acData.fan) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

// Start everything
window.addEventListener('DOMContentLoaded', init);
