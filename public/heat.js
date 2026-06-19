// Heat Management Page Frontend Logic

// State
let selectedRoom = 'salon';
let heatData = null;
let projectionChart = null;
let roomLayoutList = []; // Loaded dynamically from config

// DOM Elements
const elements = {
  connectionStatus: document.getElementById('connection-status'),
  liveTime: document.getElementById('live-time'),
  liveDate: document.getElementById('live-date'),
  refreshBtn: document.getElementById('refresh-btn'),
  
  // Widgets
  valSun: document.getElementById('val-sun'),
  valSunrise: document.getElementById('val-sunrise'),
  valSunset: document.getElementById('val-sunset'),
  valPresence: document.getElementById('val-presence'),
  valIphoneBattery: document.getElementById('val-iphone-battery'),

  // Hublot Card
  windowHublotCard: document.getElementById('window-hublot-card'),
  hublotCircle: document.getElementById('hublot-circle'),
  hublotIcon: document.getElementById('hublot-icon'),
  hublotStatusText: document.getElementById('hublot-status-text'),
  hublotTitle: document.getElementById('hublot-title'),
  hublotDesc: document.getElementById('hublot-desc'),

  // Advice
  adviceText: document.getElementById('advice-text'),

  // Stats Table
  roomStatsLabel: document.getElementById('room-stats-label'),
  valTin: document.getElementById('val-tin'),
  valHin: document.getElementById('val-hin'),
  valTout: document.getElementById('val-tout'),
  valHout: document.getElementById('val-hout'),
  valAhIn: document.getElementById('val-ah-in'),
  valAhOut: document.getElementById('val-ah-out'),

  // Predictor Card
  crossingTimeDisplay: document.getElementById('crossing-time-display'),
  crossingTypeLabel: document.getElementById('crossing-type-label'),
  crossingCountdownDisplay: document.getElementById('crossing-countdown-display'),
  mlDetailsText: document.getElementById('ml-details-text'),
  roomSelector: document.getElementById('room-selector')
};

// Initialize Page
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  
  // Fetch Config and Build Selector buttons first
  fetchConfigAndBuildSelector();

  elements.refreshBtn.addEventListener('click', () => {
    const icon = elements.refreshBtn.querySelector('i, svg');
    if (icon) icon.classList.add('spin');
    fetchAllData();
  });
}

// Fetch configuration to dynamically draw Room Selector Pills
async function fetchConfigAndBuildSelector() {
  setConnectionStatus('loading');
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error('Failed to fetch config');
    const data = await res.json();
    roomLayoutList = data.rooms || [];
    
    // Draw room selector pills dynamically
    drawRoomSelector(roomLayoutList);
    
    // Setup selector event listeners
    setupRoomSelector();
    
    // Fetch thermal analytics data
    fetchAllData();
  } catch (err) {
    console.error('Error loading config:', err);
    setConnectionStatus('error');
  }
}

// Render selector pills dynamically based on configured rooms
function drawRoomSelector(rooms) {
  if (!elements.roomSelector) return;
  elements.roomSelector.innerHTML = ''; // clear

  // Filters rooms that have tempEntity or matches custom key
  const tempRooms = rooms.filter(r => r.tempEntity);
  
  // Add actual room buttons
  tempRooms.forEach((room, idx) => {
    const btn = document.createElement('button');
    btn.className = idx === 0 ? 'horizon-btn active' : 'horizon-btn';
    btn.setAttribute('data-room', room.id);
    btn.textContent = room.label;
    elements.roomSelector.appendChild(btn);
    
    // Default selected room key
    if (idx === 0) {
      selectedRoom = room.id;
    }
  });

  // Always append Mobile Sensor option if configured
  const mobileBtn = document.createElement('button');
  mobileBtn.className = 'horizon-btn';
  mobileBtn.setAttribute('data-room', 'mobile');
  mobileBtn.textContent = 'Capteur Mobile';
  elements.roomSelector.appendChild(mobileBtn);
}

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

// Connection Indicator State
function setConnectionStatus(status) {
  elements.connectionStatus.className = 'pulse-indicator';
  
  const refreshIcon = elements.refreshBtn.querySelector('i, svg');
  if (refreshIcon) {
    refreshIcon.classList.remove('spin');
  }

  if (status === 'online') {
    elements.connectionStatus.classList.add('status-online');
  } else if (status === 'error') {
    elements.connectionStatus.classList.add('status-error');
  }
}

// Setup Room selector click event listeners
function setupRoomSelector() {
  const btns = document.querySelectorAll('#room-selector .horizon-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      selectedRoom = btn.getAttribute('data-room');
      if (heatData) {
        updateHeatUI(heatData);
      }
    });
  });
}

// Fetch both API endpoints in parallel
async function fetchAllData() {
  try {
    const [weatherRes, heatRes] = await Promise.all([
      fetch('./api/weather'),
      fetch('./api/heat-management')
    ]);
    
    if (!weatherRes.ok || !heatRes.ok) {
      throw new Error('API server returned error');
    }
    
    const weatherData = await weatherRes.json();
    heatData = await heatRes.json();
    
    updateWidgets(weatherData);
    updateHeatUI(heatData);
    
    setConnectionStatus('online');
  } catch (error) {
    console.error('Error loading heat management data:', error);
    setConnectionStatus('error');
  }
}

// Update standard status widgets from weather endpoint
function updateWidgets(data) {
  if (data.presence) {
    const isHome = data.presence.benjamin === 'home';
    const presenceWidget = document.getElementById('widget-presence');
    
    if (elements.valPresence) elements.valPresence.textContent = isHome ? 'Présent' : 'Absent';
    if (presenceWidget) {
      if (isHome) {
        presenceWidget.classList.add('widget-active');
        presenceWidget.classList.remove('widget-inactive');
      } else {
        presenceWidget.classList.add('widget-inactive');
        presenceWidget.classList.remove('widget-active');
      }
    }
    if (elements.valIphoneBattery) elements.valIphoneBattery.textContent = `${data.presence.iphone_battery}%`;
  }
  
  if (data.ephemeris) {
    let sunText = 'Indéterminé';
    if (data.ephemeris.sun_state === 'above_horizon') sunText = 'Levé';
    else if (data.ephemeris.sun_state === 'below_horizon') sunText = 'Couché';
    if (elements.valSun) elements.valSun.textContent = sunText;
    
    const formatTime = (isoString) => {
      if (!isoString) return '--:--';
      try {
        const date = new Date(isoString);
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '--:--';
      }
    };
    if (elements.valSunrise) elements.valSunrise.textContent = formatTime(data.ephemeris.next_rising);
    if (elements.valSunset) elements.valSunset.textContent = formatTime(data.ephemeris.next_setting);
  }
}

// Update Page UI with Heat Management results
function updateHeatUI(data) {
  const roomData = data.rooms[selectedRoom];
  if (!roomData) return;

  const current = roomData.current;
  
  // Update stats labels
  elements.roomStatsLabel.textContent = `Intérieur (${roomData.label})`;

  // Update stats display
  elements.valTin.innerHTML = `${current.indoorTemp.toFixed(1)} <span class="unit">°C</span>`;
  elements.valHin.textContent = `${current.indoorHum} %`;
  elements.valTout.innerHTML = `${current.outdoorTemp.toFixed(1)} <span class="unit">°C</span>`;
  elements.valHout.textContent = `${current.outdoorHum} %`;
  elements.valAhIn.textContent = `${current.indoorAH.toFixed(1)} g/m³`;
  elements.valAhOut.textContent = `${current.outdoorAH.toFixed(1)} g/m³`;
  
  // Set Advice Text
  elements.adviceText.textContent = current.advice;

  // Render Hublot Window State
  if (current.shouldOpen) {
    elements.hublotCircle.className = 'hublot-circle hublot-open';
    elements.hublotStatusText.textContent = 'Ouvrir';
    elements.hublotTitle.textContent = `Aérer le ${roomData.label}`;
    elements.hublotDesc.textContent = "La température extérieure est favorable pour rafraîchir sainement l'air de cette pièce.";
    elements.hublotIcon.setAttribute('data-lucide', 'wind');
  } else {
    elements.hublotCircle.className = 'hublot-circle hublot-closed';
    elements.hublotStatusText.textContent = 'Fermer';
    
    if (['rainy', 'snowy', 'hail', 'lightning', 'pouring'].includes(current.weatherCondition)) {
      elements.hublotTitle.textContent = 'Pluie / Intempéries';
      elements.hublotDesc.textContent = 'Précipitations dehors. Conservez les fenêtres fermées pour protéger la pièce.';
    } else if (current.outdoorTemp > current.indoorTemp) {
      elements.hublotTitle.textContent = 'Fenêtre Close';
      elements.hublotDesc.textContent = `Il fait plus chaud dehors qu'à l'intérieur du ${roomData.label}. Gardez fermé pour bloquer le chaud.`;
    } else if (current.isHumidityFavorable === false) {
      elements.hublotTitle.textContent = 'Air Extérieur Humide';
      elements.hublotDesc.textContent = `Bien que frais dehors, l'air extérieur est trop humide (HA : ${current.outdoorAH.toFixed(1)} g/m³ vs ${current.indoorAH.toFixed(1)} g/m³).`;
    } else {
      elements.hublotTitle.textContent = 'Aération Stable';
      elements.hublotDesc.textContent = `Températures stables dans le ${roomData.label}. Ouvrez brièvement uniquement pour régénérer l'oxygène.`;
    }
    elements.hublotIcon.setAttribute('data-lucide', 'shield-alert');
  }
  
  lucide.createIcons();

  // Populate crossing predictor
  if (roomData.nextCrossing) {
    elements.crossingTimeDisplay.textContent = roomData.nextCrossing.timeLabel;
    elements.crossingCountdownDisplay.textContent = roomData.nextCrossing.countdown;
    
    if (roomData.nextCrossing.type === 'open') {
      elements.crossingTypeLabel.textContent = `Ouverture conseillée (${roomData.label})`;
      elements.crossingCountdownDisplay.style.color = 'var(--color-success)';
      elements.mlDetailsText.textContent = `Le modèle ML estime qu'à cette heure, l'air extérieur passera en dessous de la température du ${roomData.label} (${roomData.nextCrossing.tempAtCrossing}°C).`;
    } else {
      elements.crossingTypeLabel.textContent = `Fermeture conseillée (${roomData.label})`;
      elements.crossingCountdownDisplay.style.color = 'var(--color-danger)';
      elements.mlDetailsText.textContent = `La chaleur extérieure va remonter au-dessus du ${roomData.label}. Pensez à refermer pour sceller le frais.`;
    }
  } else {
    elements.crossingTimeDisplay.textContent = "Stable";
    elements.crossingTypeLabel.textContent = "Pas de croisement de courbe prévu";
    elements.crossingCountdownDisplay.textContent = "Sur les prochaines 24h";
    elements.mlDetailsText.textContent = `Aucune intersection de courbe de température n'est prévue dans le ${roomData.label} pour les prochaines 24 heures.`;
  }

  // Draw or update Chart.js
  drawChart(roomData);
  
  // Update Global Recommendation
  updateGlobalRecommendation(data);
}

// Compute and update Global Recommendation
function updateGlobalRecommendation(data) {
  const rooms = Object.values(data.rooms);
  
  let earliestOpen = null;
  let latestClose = null;
  
  rooms.forEach(room => {
    const crossing = room.nextCrossing;
    if (crossing) {
      const crossingDate = new Date(crossing.time);
      if (crossing.type === 'open') {
        if (!earliestOpen || crossingDate < earliestOpen.date) {
          earliestOpen = {
            date: crossingDate,
            label: room.label,
            temp: crossing.tempAtCrossing,
            timeLabel: crossing.timeLabel,
            countdown: crossing.countdown
          };
        }
      } else if (crossing.type === 'close') {
        if (!latestClose || crossingDate > latestClose.date) {
          latestClose = {
            date: crossingDate,
            label: room.label,
            temp: crossing.tempAtCrossing,
            timeLabel: crossing.timeLabel,
            countdown: crossing.countdown
          };
        }
      }
    }
  });

  const timeEl = document.getElementById('global-crossing-time');
  const countdownEl = document.getElementById('global-crossing-countdown');
  const descEl = document.getElementById('global-rec-desc');

  if (!timeEl || !countdownEl || !descEl) return;

  const isLightTheme = document.body.classList.contains('light-theme');
  const gradientStart = isLightTheme ? '#1d1d1f' : '#f8fafc';

  if (earliestOpen) {
    timeEl.textContent = earliestOpen.timeLabel;
    timeEl.style.background = `linear-gradient(135deg, ${gradientStart} 30%, #10b981 100%)`;
    timeEl.style.webkitBackgroundClip = 'text';
    timeEl.style.webkitTextFillColor = 'transparent';
    countdownEl.textContent = `Ouverture conseillée : ${earliestOpen.countdown}`;
    countdownEl.style.color = 'var(--color-success)';
    descEl.textContent = `Créneau d'aération générale de la maison. Commencez par ouvrir la fenêtre du ${earliestOpen.label} dès qu'il fait ${earliestOpen.temp}°C dehors pour faire entrer l'air frais.`;
  } else if (latestClose) {
    timeEl.textContent = latestClose.timeLabel;
    timeEl.style.background = `linear-gradient(135deg, ${gradientStart} 30%, #ef4444 100%)`;
    timeEl.style.webkitBackgroundClip = 'text';
    timeEl.style.webkitTextFillColor = 'transparent';
    countdownEl.textContent = `Fermeture conseillée : ${latestClose.countdown}`;
    countdownEl.style.color = 'var(--color-danger)';
    descEl.textContent = `Préservation de la fraîcheur. Pensez à fermer la dernière fenêtre (${latestClose.label}) pour emprisonner le frais avant que la chaleur extérieure ne remonte.`;
  } else {
    const currentlyFavorableRooms = rooms.filter(r => r.current.shouldOpen);
    if (currentlyFavorableRooms.length > 0) {
      timeEl.textContent = "OUVERT";
      timeEl.style.background = `linear-gradient(135deg, ${gradientStart} 30%, #10b981 100%)`;
      timeEl.style.webkitBackgroundClip = 'text';
      timeEl.style.webkitTextFillColor = 'transparent';
      countdownEl.textContent = "Aération en cours";
      countdownEl.style.color = 'var(--color-success)';
      descEl.textContent = `Il est actuellement avantageux d'aérer la maison. Les pièces favorables sont : ${currentlyFavorableRooms.map(r => r.label).join(', ')}.`;
    } else {
      timeEl.textContent = "FERMÉ";
      timeEl.style.background = `linear-gradient(135deg, ${gradientStart} 30%, #64748b 100%)`;
      timeEl.style.webkitBackgroundClip = 'text';
      timeEl.style.webkitTextFillColor = 'transparent';
      countdownEl.textContent = "Aucun croisement prévu";
      countdownEl.style.color = 'var(--text-muted)';
      descEl.textContent = "Les températures extérieures sont trop élevées ou trop fraîches. Conservez vos fenêtres fermées.";
    }
  }
}

// Render the Line Chart
function drawChart(roomData) {
  const ctx = document.getElementById('tempProjectionChart').getContext('2d');
  
  const labels = roomData.projection.map(p => p.hourLabel);
  const toutData = roomData.projection.map(p => p.tout);
  const tinData = roomData.projection.map(p => p.tin);
  
  let fractionalCrossingIndex = null;
  if (roomData.nextCrossing) {
    const crossingTime = new Date(roomData.nextCrossing.time);
    for (let i = 1; i < roomData.projection.length; i++) {
      const prevTime = new Date(roomData.projection[i-1].time);
      const currTime = new Date(roomData.projection[i].time);
      
      if (crossingTime >= prevTime && crossingTime <= currTime) {
        const interval = currTime - prevTime;
        const progress = crossingTime - prevTime;
        fractionalCrossingIndex = (i - 1) + (progress / interval);
        break;
      }
    }
  }

  if (projectionChart) {
    projectionChart.data.labels = labels;
    projectionChart.data.datasets[0].data = toutData;
    projectionChart.data.datasets[1].data = tinData;
    projectionChart.data.datasets[1].label = `${roomData.label} (ML Prédit)`;
    projectionChart.options.plugins.verticalLine.crossingIndex = fractionalCrossingIndex;
    projectionChart.options.plugins.verticalLine.crossingType = roomData.nextCrossing ? roomData.nextCrossing.type : null;
    projectionChart.update();
    return;
  }

  const isLight = document.body.classList.contains('light-theme');
  const textColor = isLight ? '#1d1d1f' : '#f8fafc';
  const mutedColor = isLight ? '#86868b' : '#94a3b8';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
  const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.95)';
  const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
  const tooltipText = isLight ? '#1d1d1f' : '#e2e8f0';

  const gradTout = ctx.createLinearGradient(0, 0, 0, 200);
  gradTout.addColorStop(0, 'rgba(14, 165, 233, 0.25)');
  gradTout.addColorStop(1, 'rgba(14, 165, 233, 0)');
  
  const gradTin = ctx.createLinearGradient(0, 0, 0, 200);
  gradTin.addColorStop(0, 'rgba(217, 70, 239, 0.2)');
  gradTin.addColorStop(1, 'rgba(217, 70, 239, 0)');

  projectionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Extérieur (HA / Météo)',
          data: toutData,
          borderColor: '#0ea5e9',
          backgroundColor: gradTout,
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#0ea5e9',
          pointHoverRadius: 7,
          pointRadius: labels.map(l => l === 'Actuel' ? 6 : 0),
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: '#ffffff'
        },
        {
          label: `${roomData.label} (ML Prédit)`,
          data: tinData,
          borderColor: '#d946ef',
          backgroundColor: gradTin,
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#d946ef',
          pointHoverRadius: 7,
          pointRadius: labels.map(l => l === 'Actuel' ? 6 : 0),
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: '#ffffff'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: {
            color: gridColor,
            borderColor: 'transparent'
          },
          ticks: {
            color: mutedColor,
            font: {
              family: 'Inter, sans-serif',
              size: 10
            },
            maxTicksLimit: 12
          }
        },
        y: {
          grid: {
            color: gridColor,
            borderColor: 'transparent'
          },
          ticks: {
            color: mutedColor,
            font: {
              family: 'Inter, sans-serif',
              size: 10
            },
            callback: (val) => `${val}°C`
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: textColor,
            font: {
              family: 'Outfit, sans-serif',
              weight: 500,
              size: 11
            },
            usePointStyle: true,
            boxWidth: 8
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: textColor,
          bodyColor: tooltipText,
          borderColor: tooltipBorder,
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          titleFont: {
            family: 'Outfit, sans-serif',
            weight: 600
          },
          bodyFont: {
            family: 'Inter, sans-serif'
          },
          callbacks: {
            label: (context) => ` ${context.dataset.label.split(' ')[0]} : ${context.parsed.y.toFixed(1)}°C`
          }
        },
        verticalLine: {
          crossingIndex: fractionalCrossingIndex,
          crossingType: roomData.nextCrossing ? roomData.nextCrossing.type : null
        }
      }
    },
    plugins: [{
      id: 'verticalLine',
      afterDraw: (chart) => {
        const pluginOpts = chart.options.plugins.verticalLine;
        const crossingIndex = pluginOpts ? pluginOpts.crossingIndex : null;
        const crossingType = pluginOpts ? pluginOpts.crossingType : null;
        
        if (crossingIndex !== null && crossingIndex !== undefined && chart.scales.x) {
          const ctx = chart.ctx;
          const xAxis = chart.scales.x;
          const yAxis = chart.scales.y;
          
          const lowerIdx = Math.floor(crossingIndex);
          const upperIdx = Math.ceil(crossingIndex);
          
          const xPrev = xAxis.getPixelForTick(lowerIdx);
          const xNext = xAxis.getPixelForTick(upperIdx);
          const fraction = crossingIndex - lowerIdx;
          const x = xPrev + fraction * (xNext - xPrev);
          
          const strokeColor = crossingType === 'open' ? 'rgba(16, 185, 129, 0.65)' : 'rgba(239, 68, 68, 0.65)';
          const textColor = crossingType === 'open' ? '#10b981' : '#ef4444';
          const labelText = crossingType === 'open' ? '▲ OUVRIR (Frais)' : '▼ FERMER (Chaud)';

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, yAxis.top);
          ctx.lineTo(x, yAxis.bottom);
          ctx.lineWidth = 2;
          ctx.strokeStyle = strokeColor;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          
          ctx.fillStyle = textColor;
          ctx.font = 'bold 9px Outfit, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(labelText, x, yAxis.top + 15);
          ctx.restore();
        }
      }
    }]
  });
}

// Start everything
document.addEventListener('DOMContentLoaded', init);

// Redraw chart when theme is toggled
document.addEventListener('themechange', () => {
  if (projectionChart) {
    projectionChart.destroy();
    projectionChart = null;
  }
  const activeRoom = document.querySelector('.room-pill.active')?.getAttribute('data-room-id');
  if (activeRoom && heatData && heatData.rooms[activeRoom]) {
    renderChart(heatData.rooms[activeRoom]);
  }
});
