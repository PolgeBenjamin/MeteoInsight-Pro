// Forecasts Page Frontend Logic for AROME & ARPEGE

// State
let selectedModel = 'arome'; // 'arome' or 'arpege'
let selectedMode = 'normal'; // 'normal' or 'detailed'
let selectedDetailedChartTab = 'temp-hum'; // 'temp-hum', 'wind', 'clouds-rain', 'pressure'
let weatherChart = null;
let apiData = null;

// DOM Elements
const elements = {
  connectionStatus: document.getElementById('connection-status'),
  liveTime: document.getElementById('live-time'),
  liveDate: document.getElementById('live-date'),
  refreshBtn: document.getElementById('refresh-btn'),
  
  // Model Information Banner
  infoModelName: document.getElementById('info-model-name'),
  infoModelResolution: document.getElementById('info-model-resolution'),
  infoModelHorizon: document.getElementById('info-model-horizon'),
  infoModelUpdated: document.getElementById('info-model-updated'),
  
  // Table
  tableHeaders: document.getElementById('table-headers'),
  tableBody: document.getElementById('table-body'),
  
  // Chart Controls
  chartControlsTabs: document.getElementById('chart-controls-tabs')
};

// Initialize Page
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  
  setupSelectors();

  // Fetch initial data
  fetchAllData();
  
  // Refresh button action
  elements.refreshBtn.addEventListener('click', () => {
    fetchAllData();
  });

  // Auto-refresh every 10 minutes
  setInterval(fetchAllData, 10 * 60 * 1000);
}

// Setup Event Listeners for Model and Mode Selector Buttons
function setupSelectors() {
  // Model buttons
  const modelBtns = document.querySelectorAll('.model-btn');
  modelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      modelBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedModel = btn.getAttribute('data-model');
      updateUI();
    });
  });

  // Mode buttons
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.getAttribute('data-mode');
      updateUI();
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

// Fetch all data in parallel
async function fetchAllData() {
  setConnectionStatus('loading');
  
  try {
    const [weatherRes, forecastsRes] = await Promise.all([
      fetch('api/weather'),
      fetch('api/forecasts')
    ]);
    
    if (!weatherRes.ok || !forecastsRes.ok) {
      throw new Error('API server returned error');
    }
    
    const weatherData = await weatherRes.json();
    apiData = await forecastsRes.json();
    
    updateWidgets(weatherData);
    updateUI();
    
    setConnectionStatus('online');
  } catch (error) {
    console.error('Error fetching forecasts data:', error);
    setConnectionStatus('error');
  }
}

// Update standard status widgets from weather endpoint
function updateWidgets(data) {
  // Navigation elements update (e.g. status details can be linked here if widgets exist in HTML header)
}

// Main UI dispatcher
function updateUI() {
  if (!apiData) return;
  
  const modelData = selectedModel === 'arome' ? apiData.arome : apiData.arpege;
  
  // 1. Update Banner
  updateBanner(modelData);
  
  // 2. Update Table
  renderTable(modelData);
  
  // 3. Update Chart Controls
  renderChartControls();
  
  // 4. Update Chart
  renderChart(modelData);
  
  // Recompile Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Update the Banner Information
function updateBanner(modelData) {
  if (selectedModel === 'arome') {
    elements.infoModelName.textContent = 'AROME (Météo France HD)';
    elements.infoModelResolution.textContent = '1.3 km (Ultra Haute Résolution)';
  } else {
    elements.infoModelName.textContent = 'ARPEGE (Météo France Europe)';
    elements.infoModelResolution.textContent = '10 km (Résolution Régionale)';
  }
  
  elements.infoModelHorizon.textContent = `${modelData.length} Heures (${Math.round(modelData.length / 24)}j)`;
  
  if (apiData.timestamp) {
    const d = new Date(apiData.timestamp);
    elements.infoModelUpdated.textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' (Auj.)';
  }
}

// Render Hourly Table
function renderTable(modelData) {
  elements.tableHeaders.innerHTML = '';
  elements.tableBody.innerHTML = '';
  
  if (selectedMode === 'normal') {
    // Vue Normale headers
    elements.tableHeaders.innerHTML = `
      <th>Jour</th>
      <th>Heure</th>
      <th>Temps</th>
      <th>Temp. brute</th>
      <th>Temp. Ajustée (ML)</th>
      <th>Pluie (mm)</th>
      <th>Vent</th>
      <th>Direction</th>
    `;
    
    // Rows
    modelData.forEach(row => {
      const tr = document.createElement('tr');
      
      const tempClass = row.temp > 20 ? 'warm' : (row.temp < 12 ? 'cold' : '');
      const tempVal = row.temp !== null ? `${row.temp.toFixed(1)}°C` : '--';
      
      const tempAdjustedClass = row.tempAdjusted > 20 ? 'warm' : (row.tempAdjusted < 12 ? 'cold' : '');
      const tempAdjustedVal = row.tempAdjusted !== null ? `${row.tempAdjusted.toFixed(1)}°C` : '--';
      
      let precipBadge = '<span class="precip-badge precip-none">Sec</span>';
      if (row.precipitation > 0) {
        precipBadge = row.precipitation > 2 
          ? `<span class="precip-badge precip-heavy">${row.precipitation.toFixed(1)} mm</span>`
          : `<span class="precip-badge precip-light">${row.precipitation.toFixed(1)} mm</span>`;
      }

      // Rotate arrow to point in the direction the wind is blowing (towards, so direction + 180)
      const windDir = row.windDirection !== null ? (row.windDirection + 180) % 360 : 0;
      
      tr.innerHTML = `
        <td class="day-cell">${row.dayLabel}</td>
        <td class="hour-cell">${row.hourLabel}</td>
        <td>
          <div class="weather-cell">
            <i data-lucide="${row.weatherIcon}"></i>
            <span>${row.weatherLabel}</span>
          </div>
        </td>
        <td class="temp-cell ${tempClass}">${tempVal}</td>
        <td class="temp-cell ${tempAdjustedClass}" style="font-weight: 600; color: var(--color-primary);">${tempAdjustedVal}</td>
        <td>${precipBadge}</td>
        <td style="font-weight: 500;">${row.windSpeed !== null ? `${Math.round(row.windSpeed)} km/h` : '--'}</td>
        <td>
          <span class="wind-dir-arrow" style="transform: rotate(${windDir}deg);" title="${row.windDirection}°">
            <i data-lucide="arrow-down" style="width: 16px; height: 16px; color: var(--color-secondary);"></i>
          </span>
        </td>
      `;
      elements.tableBody.appendChild(tr);
    });
  } else {
    // Vue Détaillée headers
    elements.tableHeaders.innerHTML = `
      <th>Jour</th>
      <th>Heure</th>
      <th>Temps</th>
      <th>Temp. brute</th>
      <th>Temp. Ajustée (ML)</th>
      <th>Humidité</th>
      <th>Pression</th>
      <th>Nuages</th>
      <th>Pluie</th>
      <th>Vent Moy.</th>
      <th>Rafales</th>
      <th>Direction</th>
    `;
    
    // Rows
    modelData.forEach(row => {
      const tr = document.createElement('tr');
      
      const tempClass = row.temp > 20 ? 'warm' : (row.temp < 12 ? 'cold' : '');
      const tempVal = row.temp !== null ? `${row.temp.toFixed(1)}°C` : '--';
      
      const tempAdjustedClass = row.tempAdjusted > 20 ? 'warm' : (row.tempAdjusted < 12 ? 'cold' : '');
      const tempAdjustedVal = row.tempAdjusted !== null ? `${row.tempAdjusted.toFixed(1)}°C` : '--';
      
      const humVal = row.humidity !== null ? `${row.humidity}%` : '--';
      const presVal = row.pressure !== null ? `${Math.round(row.pressure)} hPa` : '--';
      const cloudVal = row.cloudCover !== null ? `${row.cloudCover}%` : '--';
      
      let precipBadge = '<span class="precip-badge precip-none">Sec</span>';
      if (row.precipitation > 0) {
        precipBadge = row.precipitation > 2 
          ? `<span class="precip-badge precip-heavy">${row.precipitation.toFixed(1)} mm</span>`
          : `<span class="precip-badge precip-light">${row.precipitation.toFixed(1)} mm</span>`;
      }

      const windDir = row.windDirection !== null ? (row.windDirection + 180) % 360 : 0;
      
      tr.innerHTML = `
        <td class="day-cell">${row.dayLabel}</td>
        <td class="hour-cell">${row.hourLabel}</td>
        <td>
          <div class="weather-cell">
            <i data-lucide="${row.weatherIcon}"></i>
            <span>${row.weatherLabel}</span>
          </div>
        </td>
        <td class="temp-cell ${tempClass}">${tempVal}</td>
        <td class="temp-cell ${tempAdjustedClass}" style="font-weight: 600; color: var(--color-primary);">${tempAdjustedVal}</td>
        <td style="color: #818cf8; font-weight: 500;">${humVal}</td>
        <td style="color: #38bdf8;">${presVal}</td>
        <td style="color: #94a3b8;">${cloudVal}</td>
        <td>${precipBadge}</td>
        <td style="font-weight: 500;">${row.windSpeed !== null ? `${Math.round(row.windSpeed)} km/h` : '--'}</td>
        <td style="color: var(--color-accent); font-weight: 600;">${row.windGusts !== null ? `${Math.round(row.windGusts)} km/h` : '--'}</td>
        <td>
          <span class="wind-dir-arrow" style="transform: rotate(${windDir}deg);" title="${row.windDirection}°">
            <i data-lucide="arrow-down" style="width: 16px; height: 16px; color: var(--color-secondary);"></i>
          </span>
          <span style="font-size: 0.7rem; color: var(--text-dim); margin-left: 0.25rem;">${row.windDirection}°</span>
        </td>
      `;
      elements.tableBody.appendChild(tr);
    });
  }
}

// Render Chart Selector Tabs
function renderChartControls() {
  elements.chartControlsTabs.innerHTML = '';
  
  if (selectedMode === 'normal') {
    // Normal mode doesn't need tabs, it plots Temp + Precip together
    elements.chartControlsTabs.innerHTML = `
      <span style="font-size: 0.8rem; color: var(--text-dim); font-weight: 500;">Température & Précipitations</span>
    `;
  } else {
    // Detailed mode tabs
    const tabs = [
      { id: 'temp-hum', label: 'Temp. & Humidité' },
      { id: 'wind', label: 'Vent & Rafales' },
      { id: 'clouds-rain', label: 'Nuages & Pluie' },
      { id: 'pressure', label: 'Pression' }
    ];
    
    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = `chart-tab-btn ${selectedDetailedChartTab === tab.id ? 'active' : ''}`;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        selectedDetailedChartTab = tab.id;
        // update active classes
        document.querySelectorAll('.chart-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Redraw chart
        const modelData = selectedModel === 'arome' ? apiData.arome : apiData.arpege;
        renderChart(modelData);
      });
      elements.chartControlsTabs.appendChild(btn);
    });
  }
}

// Render Chart using Chart.js API
function renderChart(modelData) {
  const canvas = document.getElementById('weatherChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  if (weatherChart) {
    weatherChart.destroy();
  }
  
  // Format labels: show day on changes, otherwise just hour
  let lastDay = '';
  const labels = modelData.map(d => {
    if (d.dayLabel !== lastDay) {
      lastDay = d.dayLabel;
      return `${d.dayLabel} ${d.hourLabel}`;
    }
    return d.hourLabel;
  });
  
  const temperatures = modelData.map(d => d.temp);
  const precipitations = modelData.map(d => d.precipitation);
  
  const isLight = document.body.classList.contains('light-theme');
  const textColor = isLight ? '#1d1d1f' : '#f8fafc';
  const mutedColor = isLight ? '#86868b' : '#94a3b8';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.03)';
  const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.95)';
  const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
  const tooltipText = isLight ? '#1d1d1f' : '#e2e8f0';

  let datasets = [];
  let options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: textColor,
          font: { family: 'Outfit', size: 11, weight: 500 }
        }
      },
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        titleColor: textColor,
        titleFont: { family: 'Outfit', weight: 600 },
        bodyColor: tooltipText,
        bodyFont: { family: 'Inter' },
        padding: 12,
        cornerRadius: 12
      }
    },
    scales: {
      x: {
        grid: { color: gridColor, borderColor: 'transparent' },
        ticks: { color: mutedColor, font: { family: 'Inter', size: 10 }, maxRotation: 45, minRotation: 45 }
      }
    }
  };

  // Build gradients
  const blueGradient = ctx.createLinearGradient(0, 0, 0, 300);
  blueGradient.addColorStop(0, 'rgba(14, 165, 233, 0.25)');
  blueGradient.addColorStop(1, 'rgba(14, 165, 233, 0)');

  const primaryGradient = ctx.createLinearGradient(0, 0, 0, 300);
  primaryGradient.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
  primaryGradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

  const accentGradient = ctx.createLinearGradient(0, 0, 0, 300);
  accentGradient.addColorStop(0, 'rgba(217, 70, 239, 0.2)');
  accentGradient.addColorStop(1, 'rgba(217, 70, 239, 0)');

  if (selectedMode === 'normal') {
    // Vue Normale: Temp Brute (Line) + Temp Ajustée (Line) + Precip (Bar)
    datasets = [
      {
        label: 'Température brute (°C)',
        data: temperatures,
        borderColor: '#86868b',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 1,
        tension: 0.35,
        yAxisID: 'yTemp'
      },
      {
        label: 'Température Ajustée (ML) (°C)',
        data: modelData.map(d => d.tempAdjusted),
        borderColor: '#f59e0b',
        borderWidth: 2.5,
        pointBackgroundColor: '#f59e0b',
        pointHoverRadius: 6,
        pointRadius: 2,
        tension: 0.35,
        yAxisID: 'yTemp'
      },
      {
        label: 'Précipitations (mm)',
        data: precipitations,
        type: 'bar',
        backgroundColor: 'rgba(14, 165, 233, 0.5)',
        borderColor: '#0ea5e9',
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'yPrecip'
      }
    ];
    
    options.scales.yTemp = {
      type: 'linear',
      position: 'left',
      grid: { color: gridColor, borderColor: 'transparent' },
      ticks: {
        color: '#f59e0b',
        font: { family: 'Outfit', weight: 600 },
        callback: v => `${v}°C`
      }
    };
    
    options.scales.yPrecip = {
      type: 'linear',
      position: 'right',
      grid: { drawOnChartArea: false, borderColor: 'transparent' },
      ticks: {
        color: '#0ea5e9',
        font: { family: 'Outfit', weight: 600 },
        callback: v => `${v} mm`
      },
      min: 0,
      suggestedMax: 5
    };
  } else {
    // Vue Détaillée: depends on selected tab
    if (selectedDetailedChartTab === 'temp-hum') {
      const humidities = modelData.map(d => d.humidity);
      datasets = [
        {
          label: 'Température brute (°C)',
          data: temperatures,
          borderColor: '#86868b',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 1,
          tension: 0.35,
          yAxisID: 'yTemp'
        },
        {
          label: 'Température Ajustée (ML) (°C)',
          data: modelData.map(d => d.tempAdjusted),
          borderColor: '#f59e0b',
          borderWidth: 2,
          pointRadius: 1.5,
          tension: 0.35,
          yAxisID: 'yTemp'
        },
        {
          label: 'Humidité (%)',
          data: humidities,
          borderColor: '#818cf8',
          borderWidth: 2,
          pointRadius: 1,
          backgroundColor: primaryGradient,
          fill: true,
          tension: 0.35,
          yAxisID: 'yHum'
        }
      ];
      
      options.scales.yTemp = {
        type: 'linear',
        position: 'left',
        grid: { color: gridColor, borderColor: 'transparent' },
        ticks: { color: '#f59e0b', font: { family: 'Outfit', weight: 600 }, callback: v => `${v}°C` }
      };
      
      options.scales.yHum = {
        type: 'linear',
        position: 'right',
        grid: { drawOnChartArea: false, borderColor: 'transparent' },
        ticks: { color: '#818cf8', font: { family: 'Outfit', weight: 600 }, callback: v => `${v}%` },
        min: 0,
        max: 100
      };
    } else if (selectedDetailedChartTab === 'wind') {
      const windSpeeds = modelData.map(d => d.windSpeed);
      const windGusts = modelData.map(d => d.windGusts);
      
      datasets = [
        {
          label: 'Vent Moyen (km/h)',
          data: windSpeeds,
          borderColor: '#38bdf8',
          borderWidth: 2,
          pointRadius: 1,
          tension: 0.35,
          yAxisID: 'yWind'
        },
        {
          label: 'Rafales (km/h)',
          data: windGusts,
          borderColor: '#d946ef',
          borderWidth: 1.5,
          pointRadius: 1,
          backgroundColor: accentGradient,
          fill: true,
          tension: 0.35,
          yAxisID: 'yWind'
        }
      ];
      
      options.scales.yWind = {
        type: 'linear',
        position: 'left',
        grid: { color: gridColor, borderColor: 'transparent' },
        ticks: { color: '#38bdf8', font: { family: 'Outfit', weight: 600 }, callback: v => `${v} km/h` },
        min: 0
      };
    } else if (selectedDetailedChartTab === 'clouds-rain') {
      const clouds = modelData.map(d => d.cloudCover);
      datasets = [
        {
          label: 'Couverture Nuageuse (%)',
          data: clouds,
          borderColor: '#94a3b8',
          borderWidth: 2,
          pointRadius: 1,
          backgroundColor: 'rgba(148, 163, 184, 0.12)',
          fill: true,
          tension: 0.35,
          yAxisID: 'yClouds'
        },
        {
          label: 'Pluie (mm)',
          data: precipitations,
          type: 'bar',
          backgroundColor: 'rgba(14, 165, 233, 0.5)',
          borderColor: '#0ea5e9',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'yPrecip'
        }
      ];
      
      options.scales.yClouds = {
        type: 'linear',
        position: 'left',
        grid: { color: gridColor, borderColor: 'transparent' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', weight: 600 }, callback: v => `${v}%` },
        min: 0,
        max: 100
      };
      
      options.scales.yPrecip = {
        type: 'linear',
        position: 'right',
        grid: { drawOnChartArea: false, borderColor: 'transparent' },
        ticks: { color: '#0ea5e9', font: { family: 'Outfit', weight: 600 }, callback: v => `${v} mm` },
        min: 0,
        suggestedMax: 5
      };
    } else if (selectedDetailedChartTab === 'pressure') {
      const pressures = modelData.map(d => d.pressure);
      datasets = [
        {
          label: 'Pression Atmosphérique (hPa)',
          data: pressures,
          borderColor: '#10b981',
          borderWidth: 2.5,
          pointRadius: 1,
          backgroundColor: ctx.createLinearGradient(0, 0, 0, 300), // empty placeholder
          fill: false,
          tension: 0.35,
          yAxisID: 'yPress'
        }
      ];
      
      // build a green gradient specifically
      const greenGradient = ctx.createLinearGradient(0, 0, 0, 300);
      greenGradient.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
      greenGradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
      datasets[0].backgroundColor = greenGradient;
      datasets[0].fill = true;

      options.scales.yPress = {
        type: 'linear',
        position: 'left',
        grid: { color: gridColor, borderColor: 'transparent' },
        ticks: { color: '#10b981', font: { family: 'Outfit', weight: 600 }, callback: v => `${v} hPa` },
        suggestedMin: Math.min(...pressures.filter(p => p !== null)) - 1,
        suggestedMax: Math.max(...pressures.filter(p => p !== null)) + 1
      };
    }
  }

  weatherChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: options
  });
}

// Start execution when DOM finishes loading
document.addEventListener('DOMContentLoaded', init);

// Redraw chart when theme is toggled
document.addEventListener('themechange', () => {
  if (apiData) {
    const modelData = selectedModel === 'arome' ? apiData.arome : apiData.arpege;
    renderChart(modelData);
  }
});
