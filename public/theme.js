// Shared Theme Logic (Light/Dark Mode Toggle)

(function () {
  // 1. Determine initial theme
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  
  if (savedTheme === 'light' || (!savedTheme && systemPrefersLight)) {
    document.documentElement.classList.add('light-theme');
  } else {
    document.documentElement.classList.remove('light-theme');
  }
})();

// Global function to toggle theme
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light-theme');
  if (document.body) {
    if (isLight) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  
  // Update icons and text
  updateThemeUI();
  
  // Dispatch custom theme change event
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: isLight ? 'light' : 'dark' } }));
}

// Update the theme toggle buttons in the DOM
function updateThemeUI() {
  const isLight = document.documentElement.classList.contains('light-theme');
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  
  // Update Lucide icon
  const iconName = isLight ? 'moon' : 'sun';
  const labelText = isLight ? 'Sombre' : 'Clair';
  
  btn.innerHTML = `<i data-lucide="${iconName}"></i><span>${labelText}</span>`;
  
  // Re-render Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Injects the theme toggle button into the header navigation bar dynamically
function injectThemeToggle() {
  const nav = document.querySelector('.header-nav');
  if (!nav) return;
  
  // Check if button already exists
  if (document.getElementById('theme-toggle')) return;
  
  const isLight = document.documentElement.classList.contains('light-theme');
  const iconName = isLight ? 'moon' : 'sun';
  const labelText = isLight ? 'Sombre' : 'Clair';
  
  const toggleBtn = document.createElement('a');
  toggleBtn.href = 'javascript:toggleTheme()';
  toggleBtn.className = 'nav-link theme-toggle-btn';
  toggleBtn.id = 'theme-toggle';
  toggleBtn.title = 'Changer de thème';
  toggleBtn.innerHTML = `<i data-lucide="${iconName}"></i><span>${labelText}</span>`;
  
  // Insert before the github link if it exists, otherwise at the end
  const githubLink = nav.querySelector('.github-link');
  if (githubLink) {
    nav.insertBefore(toggleBtn, githubLink);
  } else {
    nav.appendChild(toggleBtn);
  }
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Initialize theme toggle injection when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Sync documentElement class to body
  if (document.documentElement.classList.contains('light-theme')) {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
  injectThemeToggle();
  updateThemeUI();
});

