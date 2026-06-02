// MeteoInsight-Pro Configuration Console - Frontend Logic

// DOM Elements
const elements = {
  liveTime: document.getElementById('live-time'),
  liveDate: document.getElementById('live-date'),
  connectionStatus: document.getElementById('connection-status'),
  settingsForm: document.getElementById('settings-form'),
  haUrl: document.getElementById('ha-url'),
  haToken: document.getElementById('ha-token'),
  submitBtn: document.getElementById('submit-btn'),
  statusBanner: document.getElementById('status-banner'),
  statusIcon: document.getElementById('status-icon'),
  statusMessage: document.getElementById('status-message'),
  roomsJson: document.getElementById('rooms-json')
};

// Entity Fields Mapper
const entityKeys = [
  'outdoor_temp', 'outdoor_humidity', 'mobile_temp', 'mobile_humidity', 'weather_forecast',
  'netatmo_temp', 'netatmo_humidity', 'netatmo_co2', 'netatmo_noise', 'netatmo_pressure',
  'roborock_vacuum', 'roborock_battery', 'roborock_room', 'roborock_status', 'purifier_pm25',
  'purifier_quality', 'presence_person', 'iphone_battery', 'sun', 'sun_next_rising', 'sun_next_setting'
];

// Initialize Page
function init() {
  updateClock();
  setInterval(updateClock, 1000);

  // Set up tab switching
  setupTabs();

  // Fetch current config
  fetchConfig();

  // Bind form submission
  elements.settingsForm.addEventListener('submit', handleFormSubmit);
}

// Tab Switching
function setupTabs() {
  const tabButtons = document.querySelectorAll('#settings-tabs button');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(`tab-${tabId}`);
      if (targetPane) {
        targetPane.classList.add('active');
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

// Fetch dynamic config from Node server
async function fetchConfig() {
  setConnectionStatus('loading');
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error('Failed to fetch config');
    const data = await res.json();
    
    // Connection Settings
    elements.haUrl.value = data.HA_URL || '';
    elements.haToken.value = data.HA_TOKEN || ''; 
    
    // Sensor Entities
    entityKeys.forEach(key => {
      const fieldId = `ent-${key.replace(/_/g, '-')}`;
      const inputEl = document.getElementById(fieldId);
      if (inputEl) {
        inputEl.value = (data.entities && data.entities[key]) ? data.entities[key] : '';
      }
    });

    // Rooms Layout JSON
    if (elements.roomsJson && data.rooms) {
      elements.roomsJson.value = JSON.stringify(data.rooms, null, 2);
    }

    setConnectionStatus('online');
  } catch (err) {
    console.error('Error fetching config:', err);
    setConnectionStatus('error');
    showStatus('Erreur lors du chargement de la configuration.', 'error');
  }
}

// Form submit handler
async function handleFormSubmit(e) {
  e.preventDefault();
  
  // Disable button and show loading status
  elements.submitBtn.disabled = true;
  showStatus('Sauvegarde en cours...', 'info');

  // 1. Validate Rooms JSON syntax
  let roomsData = null;
  if (elements.roomsJson && elements.roomsJson.value.trim()) {
    try {
      roomsData = JSON.parse(elements.roomsJson.value);
      if (!Array.isArray(roomsData)) {
        throw new Error("La disposition des pièces doit être un tableau JSON d'objets.");
      }
    } catch (err) {
      showStatus(`Erreur de syntaxe JSON (Plan & Pièces) : ${err.message}`, 'error');
      // Auto switch to rooms tab to show the error
      const roomsTabBtn = document.querySelector('[data-tab="rooms"]');
      if (roomsTabBtn) roomsTabBtn.click();
      elements.submitBtn.disabled = false;
      return;
    }
  }

  // 2. Build Entities mapping object
  const entitiesData = {};
  entityKeys.forEach(key => {
    const fieldId = `ent-${key.replace(/_/g, '-')}`;
    const inputEl = document.getElementById(fieldId);
    if (inputEl) {
      const val = inputEl.value.trim();
      entitiesData[key] = val || null;
    }
  });

  const payload = {
    HA_URL: elements.haUrl.value.trim(),
    HA_TOKEN: elements.haToken.value.trim(),
    entities: entitiesData,
    rooms: roomsData
  };

  try {
    const res = await fetch('api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Failed to save config');
    }

    showStatus('Configuration sauvegardée avec succès ! Les caches du serveur ont été réinitialisés.', 'success');
    
    // Refresh form with masked version of token and updated values
    fetchConfig();
  } catch (err) {
    console.error('Error saving config:', err);
    showStatus(`Échec de la sauvegarde : ${err.message}`, 'error');
  } finally {
    elements.submitBtn.disabled = false;
  }
}

// Status Banner management helper
function showStatus(msg, type) {
  elements.statusBanner.style.display = 'flex';
  elements.statusMessage.textContent = msg;

  if (type === 'success') {
    elements.statusBanner.style.background = 'rgba(16, 185, 129, 0.15)';
    elements.statusBanner.style.border = '1px solid rgba(16, 185, 129, 0.3)';
    elements.statusBanner.style.color = 'var(--color-success)';
    elements.statusIcon.setAttribute('data-lucide', 'check-circle');
  } else if (type === 'error') {
    elements.statusBanner.style.background = 'rgba(239, 68, 68, 0.15)';
    elements.statusBanner.style.border = '1px solid rgba(239, 68, 68, 0.3)';
    elements.statusBanner.style.color = 'var(--color-danger)';
    elements.statusIcon.setAttribute('data-lucide', 'alert-circle');
  } else {
    elements.statusBanner.style.background = 'rgba(14, 165, 233, 0.15)';
    elements.statusBanner.style.border = '1px solid rgba(14, 165, 233, 0.3)';
    elements.statusBanner.style.color = 'var(--color-secondary)';
    elements.statusIcon.setAttribute('data-lucide', 'info');
  }

  // Reload Lucide icons inside status banner
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Connection Indicator state helper
function setConnectionStatus(status) {
  elements.connectionStatus.className = 'pulse-indicator';
  if (status === 'online') {
    elements.connectionStatus.classList.add('status-online');
  } else if (status === 'loading') {
    elements.connectionStatus.classList.add('status-loading');
  } else {
    elements.connectionStatus.classList.add('status-error');
  }
}

// Trigger initialization
document.addEventListener('DOMContentLoaded', init);
