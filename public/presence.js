// Presence Prediction Page Frontend Logic

// State
let selectedDay = 0; // Monday=0, Sunday=6
let selectedHour = 12;
let selectedRoom = 'salon';
let presenceData = null;
let isPlaying = false;
let playInterval = null;
let occupancyChart = null;
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

  // Time Slider elements
  timeSlider: document.getElementById('time-slider'),
  timeDisplay: document.getElementById('time-display'),
  playBtn: document.getElementById('play-btn'),

  // Sidebar Analytics Card
  activeRoomLabel: document.getElementById('active-room-label'),
  roomStatusBadge: document.getElementById('room-status-badge'),
  statsMostUsed: document.getElementById('stats-most-used'),
  statsMostUsedPct: document.getElementById('stats-most-used-pct'),
  statsLeastUsed: document.getElementById('stats-least-used'),
  statsLeastUsedPct: document.getElementById('stats-least-used-pct'),
  roomAdvice: document.getElementById('room-advice')
};

// Day names mapping
const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

// Domotique Smart Advice lists
const roomAdvices = {
  salon: "Prévoyez le passage du Roborock en dehors du pic de soirée (18h00 - 22h00). Configurez un chauffage progressif à partir de 16h30.",
  cuisine: "Automatisation recommandée : allumage de la cafetière connectée ou d'une prise connectée cuisine entre 07h00 et 09h00.",
  bureau: "Régulation d'énergie : ajustez la température de confort uniquement sur la plage de bureau active (09h00 - 17h00).",
  salle_de_bain: "Idéal pour programmer le chauffe-serviettes ou l'extracteur d'humidité à 06h00 le matin et 19h00 le soir.",
  chambre: "Ambiance lumineuse : allumage de lumières tamisées à partir de 21h30 pour accompagner la transition vers le sommeil.",
  salle_a_manger: "Recommandation : synchronisez la climatisation ou le chauffage avec la pièce adjacente (Salon) sur la plage de dîner (19h00 - 21h00)."
};

// Initialize Page
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  
  // Setup Range Slider
  elements.timeSlider.addEventListener('input', (e) => {
    selectedHour = parseInt(e.target.value);
    updateSliderUI();
    if (isPlaying) {
      stopPlaySweep();
    }
  });

  // Setup Play Button Sweep
  elements.playBtn.addEventListener('click', togglePlaySweep);

  // Setup Day Selector Pill Buttons
  setupDaySelector();

  // Load Config first, build SVG, then retrieve data
  fetchConfigAndBuildSVG();

  elements.refreshBtn.addEventListener('click', fetchAllData);
}

// Fetch HA config and draw rooms SVG dynamically
async function fetchConfigAndBuildSVG() {
  setConnectionStatus('loading');
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error('Failed to fetch config');
    const data = await res.json();
    roomLayoutList = data.rooms || [];
    
    // Build rooms SVG layout
    drawRoomsSVG(roomLayoutList);
    
    // Bind click events on SVG rooms
    setupSvgClicks();
    
    // Retrieve presence data
    fetchAllData();
  } catch (err) {
    console.error('Error loading config:', err);
    setConnectionStatus('error');
  }
}

// Generate SVG nodes dynamically from configuration
function drawRoomsSVG(rooms) {
  const group = document.getElementById('svg-rooms-group');
  if (!group) return;
  group.innerHTML = ''; // clear

  rooms.forEach(room => {
    const roomG = document.createElementNS("http://www.w3.org/2000/svg", "g");
    roomG.id = `svg-room-${room.id}`;
    roomG.setAttribute('class', 'svg-room');
    roomG.setAttribute('data-room-id', room.id);
    if (room.clickable) {
      roomG.classList.add('clickable-room');
    }
    
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute('x', room.x);
    rect.setAttribute('y', room.y);
    rect.setAttribute('width', room.w);
    rect.setAttribute('height', room.h);
    rect.setAttribute('rx', 14);
    rect.setAttribute('class', 'room-rect');
    roomG.appendChild(rect);

    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    overlay.setAttribute('x', room.x);
    overlay.setAttribute('y', room.y);
    overlay.setAttribute('width', room.w);
    overlay.setAttribute('height', room.h);
    overlay.setAttribute('rx', 14);
    overlay.setAttribute('class', 'room-overlay heat-overlay');
    roomG.appendChild(overlay);

    const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textLabel.setAttribute('x', room.x + room.w / 2);
    textLabel.setAttribute('y', room.y + room.h / 2 - 5);
    textLabel.setAttribute('class', 'room-label');
    textLabel.textContent = room.label;
    roomG.appendChild(textLabel);

    if (room.clickable) {
      const textProb = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textProb.setAttribute('x', room.x + room.w / 2);
      textProb.setAttribute('y', room.y + room.h / 2 + 20);
      textProb.setAttribute('class', 'room-prob-val');
      textProb.textContent = '--%';
      roomG.appendChild(textProb);
    }

    group.appendChild(roomG);
  });
}

// Setup Day of week click listener
function setupDaySelector() {
  const btns = document.querySelectorAll('#day-selector .horizon-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      selectedDay = parseInt(btn.getAttribute('data-day')) || 0;
      updateSliderUI();
      if (presenceData) {
        updateRoomAnalytics();
        renderOccupancyChart();
      }
      if (isPlaying) {
        stopPlaySweep();
      }
    });
  });
}

// Clock updates
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
  } else if (status === 'loading') {
    elements.connectionStatus.classList.add('status-loading');
    if (refreshIcon) {
      refreshIcon.classList.add('spin');
    }
  } else {
    elements.connectionStatus.classList.add('status-error');
  }
}

// Update clock-slider display text
function updateSliderUI() {
  const formattedTime = `${dayNames[selectedDay]} à ${selectedHour.toString().padStart(2, '0')}h00`;
  elements.timeDisplay.textContent = formattedTime;
  elements.timeSlider.value = selectedHour;
  
  if (presenceData) {
    repaintHeatmap();
  }
}

// Auto-Sweep 24 Hours with day wrapping
function togglePlaySweep() {
  if (isPlaying) {
    stopPlaySweep();
  } else {
    startPlaySweep();
  }
}

function startPlaySweep() {
  isPlaying = true;
  elements.playBtn.innerHTML = '<i data-lucide="pause"></i>';
  elements.playBtn.classList.add('active');
  if (window.lucide) window.lucide.createIcons();
  
  playInterval = setInterval(() => {
    selectedHour = selectedHour + 1;
    if (selectedHour >= 24) {
      selectedHour = 0;
      selectedDay = (selectedDay + 1) % 7;
      
      const btns = document.querySelectorAll('#day-selector .horizon-btn');
      btns.forEach((btn, idx) => {
        if (idx === selectedDay) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      
      if (presenceData) {
        updateRoomAnalytics();
        renderOccupancyChart();
      }
    }
    updateSliderUI();
  }, 1200);
}

function stopPlaySweep() {
  isPlaying = false;
  clearInterval(playInterval);
  elements.playBtn.innerHTML = '<i data-lucide="play"></i>';
  elements.playBtn.classList.remove('active');
  if (window.lucide) window.lucide.createIcons();
}

// SVG Room click assignments
function setupSvgClicks() {
  const rooms = document.querySelectorAll('.clickable-room');
  rooms.forEach(room => {
    room.addEventListener('click', () => {
      const roomId = room.getAttribute('data-room-id');
      selectRoom(roomId);
    });
  });
}

// Master selector for active room details
function selectRoom(roomId) {
  selectedRoom = roomId;
  
  const allRooms = document.querySelectorAll('.clickable-room');
  allRooms.forEach(r => r.classList.remove('active-room'));
  
  const targetRoom = document.querySelector(`.clickable-room[data-room-id="${roomId}"]`);
  if (targetRoom) {
    targetRoom.classList.add('active-room');
  }

  if (presenceData) {
    updateRoomAnalytics();
    renderOccupancyChart();
  }
}

// Fetch both widgets and presence predictions
async function fetchAllData() {
  setConnectionStatus('loading');
  try {
    const [weatherRes, presenceRes] = await Promise.all([
      fetch('api/weather'),
      fetch('api/presence-prediction')
    ]);
    
    if (!weatherRes.ok || !presenceRes.ok) {
      throw new Error('API server returned error');
    }
    
    const weatherData = await weatherRes.json();
    presenceData = await presenceRes.json();
    
    updateWidgets(weatherData);
    
    selectRoom(selectedRoom);
    updateSliderUI();
    
    setConnectionStatus('online');
  } catch (error) {
    console.error('Error loading presence data:', error);
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

// Repaint SVG thermal overlay colors and percentages
function repaintHeatmap() {
  if (!presenceData || !roomLayoutList) return;
  
  roomLayoutList.forEach(room => {
    // salle_a_manger shares salon data fallback
    const apiRoomId = room.id === 'salle_a_manger' ? 'salon' : room.id;
    const probs = presenceData.rooms[apiRoomId];
    if (!probs) return;
    
    const prob = probs[selectedDay][selectedHour];
    const roomGroup = document.querySelector(`.svg-room[data-room-id="${room.id}"]`);
    if (!roomGroup) return;
    
    const probText = roomGroup.querySelector('.room-prob-val');
    if (probText) {
      probText.textContent = `${prob}%`;
    }
    
    const overlay = roomGroup.querySelector('.heat-overlay');
    if (overlay) {
      const opacity = Math.min(0.65, 0.05 + (prob / 100) * 0.55);
      
      if (prob < 20) {
        overlay.style.fill = 'rgba(30, 41, 59, 0.3)';
        overlay.style.filter = 'none';
      } else if (prob < 50) {
        overlay.style.fill = `rgba(14, 165, 233, ${opacity})`;
        overlay.style.filter = 'drop-shadow(0 0 4px rgba(14, 165, 233, 0.3))';
      } else if (prob < 80) {
        overlay.style.fill = `rgba(217, 70, 239, ${opacity})`;
        overlay.style.filter = 'drop-shadow(0 0 6px rgba(217, 70, 239, 0.45))';
      } else {
        overlay.style.fill = `rgba(239, 68, 68, ${opacity})`;
        overlay.style.filter = 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.6))';
      }
    }
  });

  // Keep passive rooms colored minimally
  const passiveRooms = roomLayoutList.filter(r => !r.clickable).map(r => r.id);
  passiveRooms.forEach(roomId => {
    const roomGroup = document.querySelector(`.svg-room[data-room-id="${roomId}"]`);
    if (!roomGroup) return;
    const overlay = roomGroup.querySelector('.heat-overlay');
    if (overlay) {
      overlay.style.fill = 'rgba(255, 255, 255, 0.01)';
      overlay.style.filter = 'none';
    }
  });
}

// Update the Sidebar Stats Card details
function updateRoomAnalytics() {
  if (!presenceData) return;
  
  const apiRoomId = selectedRoom === 'salle_a_manger' ? 'salon' : selectedRoom;
  const statsList = presenceData.stats[apiRoomId];
  if (!statsList) return;
  
  const stats = statsList[selectedDay];
  if (!stats) return;
  
  const room = roomLayoutList.find(r => r.id === selectedRoom);
  elements.activeRoomLabel.textContent = room ? room.label : selectedRoom;
  
  // Real vs Simulated badge visual
  if (stats.simulated) {
    elements.roomStatusBadge.textContent = 'Profil Estimé (ML)';
    elements.roomStatusBadge.style.background = 'rgba(99, 102, 241, 0.15)';
    elements.roomStatusBadge.style.borderColor = 'rgba(99, 102, 241, 0.3)';
    elements.roomStatusBadge.style.color = '#a5b4fc';
  } else {
    elements.roomStatusBadge.textContent = 'Données Réelles';
    elements.roomStatusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    elements.roomStatusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    elements.roomStatusBadge.style.color = 'var(--color-success)';
  }
  
  elements.statsMostUsed.textContent = stats.most_used_slot;
  elements.statsMostUsedPct.textContent = `Probabilité : ${stats.most_used_pct}%`;
  elements.statsLeastUsed.textContent = stats.least_used_slot;
  elements.statsLeastUsedPct.textContent = `Probabilité : ${stats.least_used_pct}%`;
  
  elements.roomAdvice.textContent = roomAdvices[selectedRoom] || "Aucune recommandation disponible pour cette pièce.";
}

// Occupancy Chart rendition
function renderOccupancyChart() {
  const canvas = document.getElementById('occupancyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  if (occupancyChart) {
    occupancyChart.destroy();
  }
  
  const apiRoomId = selectedRoom === 'salle_a_manger' ? 'salon' : selectedRoom;
  const roomData = presenceData.rooms[apiRoomId] || [];
  const probs = roomData[selectedDay] || Array(24).fill(0);
  
  const labels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}h`);
  
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(217, 70, 239, 0.25)');
  gradient.addColorStop(1, 'rgba(217, 70, 239, 0)');
  
  occupancyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Probabilité d\'occup. (%)',
        data: probs,
        borderColor: '#d946ef',
        borderWidth: 2,
        pointBackgroundColor: '#d946ef',
        pointHoverRadius: 6,
        pointRadius: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          titleColor: '#f8fafc',
          titleFont: {
            family: 'Outfit',
            weight: 600
          },
          bodyColor: '#e2e8f0',
          bodyFont: {
            family: 'Inter'
          },
          padding: 10,
          cornerRadius: 10,
          callbacks: {
            label: function(context) {
              return ` Probabilité : ${context.raw}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.02)',
            borderColor: 'transparent'
          },
          ticks: {
            color: '#64748b',
            font: {
              family: 'Inter',
              size: 9
            },
            maxTicksLimit: 8
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.03)',
            borderColor: 'transparent'
          },
          ticks: {
            color: '#64748b',
            font: {
              family: 'Inter',
              size: 10
            },
            callback: function(value) {
              return value + '%';
            }
          },
          min: 0,
          max: 100
        }
      }
    }
  });
}

// Start execution
document.addEventListener('DOMContentLoaded', init);
