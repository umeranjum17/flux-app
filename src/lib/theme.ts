export function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.add('theme-light');
  } else {
    root.classList.remove('theme-light');
  }
  // Update Windows title bar overlay colors to match theme
  window.api?.invoke?.('theme:update-titlebar', { theme }).catch(() => {});
}
