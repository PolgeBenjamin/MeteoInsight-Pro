// Forecasts Page Frontend Logic

// State
let selectedHorizon = 3;
let trendsChart = null;

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
  
  // Method 2 (Trends)
  m2Value: document.getElementById('m2-value'),
  m2Desc: document.getElementById('m2-desc'),
  trendPress: document.getElementById('trend-press'),
  trendHum: document.getElementById('trend-hum'),
  
  // Method 3 (Machine Learning)
  m3Value: document.getElementById('m3-value'),
  m3Confidence: document.getElementById('m3-confidence'),
  m3ConfidenceBar: document.getElementById('m3-confidence-bar'),
  m3DatasetSize: document.getElementById('m3-dataset-size'),

  // Dynamic Labels
  m2HorizonLabel: document.getElementById('m2-horizon-label'),
  m3HorizonLabel: document.getElementById('m3-horizon-label'),
  trendPressLabel: document.getElementById('trend-press-label'),
  trendHumLabel: document.getElementById('trend-hum-label')
};

// Initialize Page
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  
  // Setup horizon selector buttons
  setupHorizonSelector();

  // Fetch initial data
  fetchAllData();
  
  // Refresh button action
  elements.refreshBtn.addEventListener('click', () => {
    fetchAllData();
  });

  // Auto-refresh every 5 minutes
  setInterval(fetchAllData, 5 * 60 * 1000);
}

// Setup Event Listeners for Horizon Selector Pill
function setupHorizonSelector() {
  const btns = document.querySelectorAll('.horizon-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      
      // Update active state class
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update state and re-fetch
      selectedHorizon = parseInt(btn.getAttribute('data-horizon')) || 3;
      fetchAllData();
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

// Connection Status visuals
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

// Update DOM elements with visual flash animation on change
function updateValue(element, newValue, unit = '') {
  if (!element) return;
  const rawValue = newValue !== null && newValue !== undefined ? `${newValue}${unit}` : '--';
  
  if (element.textContent !== rawValue) {
    element.textContent = rawValue;
    element.classList.remove('flash-value');
    void element.offsetWidth; // force reflow
    element.classList.add('flash-value');
  }
}

// Fetch all data in parallel
async function fetchAllData() {
  setConnectionStatus('loading');
  
  try {
    const [weatherRes, forecastsRes] = await Promise.all([
      fetch('api/weather'),
      fetch(`api/forecasts?horizon=${selectedHorizon}`)
    ]);
    
    if (!weatherRes.ok || !forecastsRes.ok) {
      throw new Error('API server returned error');
    }
    
    const weatherData = await weatherRes.json();
    const forecastsData = await forecastsRes.json();
    
    updateWidgets(weatherData);
    updateForecasts(forecastsData);
    
    setConnectionStatus('online');
  } catch (error) {
    console.error('Error fetching forecasts data:', error);
    setConnectionStatus('error');
  }
}

// Update standard status widgets from weather endpoint
function updateWidgets(data) {
  // Presence
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
  
  // Ephemeris
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
}

// Helper to format values with sign (+/-)
function formatTrendVal(val, unit) {
  if (val === null || val === undefined || isNaN(val)) return '--';
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(1)} ${unit}`;
}

// Update forecasts cards and Chart
function updateForecasts(data) {
  // Dynamic labels update based on backend horizon
  const hz = data.horizon || selectedHorizon;
  updateValue(elements.m2HorizonLabel, `Prédiction (+${hz}h)`);
  updateValue(elements.m3HorizonLabel, `Prédiction ML (+${hz}h)`);
  updateValue(elements.trendPressLabel, `Variation Pression (${hz}h)`);
  updateValue(elements.trendHumLabel, `Variation Humidité (${hz}h)`);

  // --- Method 2: Trends ---
  updateValue(elements.m2Value, data.m2.label);
  updateValue(elements.m2Desc, data.m2.description);
  
  if (data.current) {
    updateValue(elements.trendPress, formatTrendVal(data.current.dp, 'hPa'));
    updateValue(elements.trendHum, formatTrendVal(data.current.dh, '%'));
  }
  
  // Update M2 Icon dynamically
  const m2IconContainer = document.querySelector('#m2-card .forecast-icon-container');
  if (m2IconContainer) {
    m2IconContainer.innerHTML = `<i data-lucide="${data.m2.icon || 'help-circle'}" id="m2-icon" class="large-forecast-icon"></i>`;
  }
  
  // --- Method 3: Machine Learning ---
  updateValue(elements.m3Value, data.m3.label);
  updateValue(elements.m3DatasetSize, `${data.m3.trainingSize || 0} points`);
  
  const confidence = data.m3.confidence || 0;
  updateValue(elements.m3Confidence, `${confidence}%`);
  
  if (elements.m3ConfidenceBar) {
    elements.m3ConfidenceBar.style.width = `${confidence}%`;
    if (confidence >= 80) {
      elements.m3ConfidenceBar.style.background = 'var(--color-success)';
      elements.m3ConfidenceBar.style.boxShadow = '0 0 8px var(--color-success)';
    } else if (confidence >= 50) {
      elements.m3ConfidenceBar.style.background = 'var(--color-primary)';
      elements.m3ConfidenceBar.style.boxShadow = '0 0 8px var(--color-primary)';
    } else {
      elements.m3ConfidenceBar.style.background = 'var(--color-danger)';
      elements.m3ConfidenceBar.style.boxShadow = '0 0 8px var(--color-danger)';
    }
  }
  
  // Update M3 Icon dynamically
  const m3IconContainer = document.querySelector('#m3-card .forecast-icon-container');
  if (m3IconContainer) {
    m3IconContainer.innerHTML = `<i data-lucide="${data.m3.icon || 'help-circle'}" id="m3-icon" class="large-forecast-icon"></i>`;
  }
  
  // Recompile icons with Lucide library
  if (window.lucide) {
    window.lucide.createIcons();
  }
  
  // --- Chart.js Rendition ---
  if (data.chart && data.chart.length > 0) {
    renderChart(data.chart);
  }
}

// Chart rendering using Chart.js API
function renderChart(chartData) {
  const canvas = document.getElementById('trendsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  if (trendsChart) {
    trendsChart.destroy();
  }
  
  const labels = chartData.map(d => d.time);
  const pressures = chartData.map(d => d.p);
  const humidities = chartData.map(d => d.h);
  
  // Linear color gradients for high-end styling
  const pressGradient = ctx.createLinearGradient(0, 0, 0, 300);
  pressGradient.addColorStop(0, 'rgba(14, 165, 233, 0.25)'); // Sky blue transparent
  pressGradient.addColorStop(1, 'rgba(14, 165, 233, 0)');
  
  const humGradient = ctx.createLinearGradient(0, 0, 0, 300);
  humGradient.addColorStop(0, 'rgba(99, 102, 241, 0.2)'); // Indigo transparent
  humGradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

  trendsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Pression (hPa)',
          data: pressures,
          borderColor: '#0ea5e9',
          borderWidth: 2,
          pointBackgroundColor: '#0ea5e9',
          pointHoverRadius: 6,
          pointRadius: 3,
          backgroundColor: pressGradient,
          fill: true,
          tension: 0.4,
          yAxisID: 'yPress'
        },
        {
          label: 'Humidité (%)',
          data: humidities,
          borderColor: '#6366f1',
          borderWidth: 2,
          pointBackgroundColor: '#6366f1',
          pointHoverRadius: 6,
          pointRadius: 3,
          backgroundColor: humGradient,
          fill: true,
          tension: 0.4,
          yAxisID: 'yHum'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#f8fafc',
            font: {
              family: 'Outfit',
              size: 12,
              weight: 500
            },
            padding: 20
          }
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
          padding: 12,
          cornerRadius: 12,
          displayColors: true
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.03)',
            borderColor: 'transparent'
          },
          ticks: {
            color: '#94a3b8',
            font: {
              family: 'Inter',
              size: 11
            }
          }
        },
        yPress: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: {
            color: 'rgba(255, 255, 255, 0.03)',
            borderColor: 'transparent'
          },
          ticks: {
            color: '#0ea5e9',
            font: {
              family: 'Outfit',
              weight: 600
            },
            callback: function(value) {
              return value + ' hPa';
            }
          },
          suggestedMin: Math.min(...pressures.filter(p => p !== null)) - 1,
          suggestedMax: Math.max(...pressures.filter(p => p !== null)) + 1
        },
        yHum: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: {
            drawOnChartArea: false,
            borderColor: 'transparent'
          },
          ticks: {
            color: '#6366f1',
            font: {
              family: 'Outfit',
              weight: 600
            },
            callback: function(value) {
              return value + ' %';
            }
          },
          min: 0,
          max: 100
        }
      }
    }
  });
}

// Start execution when DOM finishes loading
document.addEventListener('DOMContentLoaded', init);
