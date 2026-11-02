// Progressive enhancement: without this module, the dashboard is immediately visible.
// The independent safety timer also releases it if fonts or other modules fail.
const logo = `<svg class="dtd-intro-logo" viewBox="0 0 96 96" aria-hidden="true">
  <defs>
    <linearGradient id="dtd-intro-blue" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#a1d2ff"/><stop offset=".45" stop-color="#4a91ef"/><stop offset="1" stop-color="#235bd5"/></linearGradient>
    <linearGradient id="dtd-intro-mint" x2=".7" y2="1"><stop stop-color="#d4f9e8"/><stop offset="1" stop-color="#78ccad"/></linearGradient>
  </defs>
  <path class="dtd-intro-d" d="M16 21a7 7 0 0 1 7-7h18c22 0 36 14 36 33S63 80 41 80H23a7 7 0 0 1-7-7V21Z" fill="url(#dtd-intro-blue)"/>
  <path class="dtd-intro-counter" d="M30 30v34h11c12 0 21-6 21-17s-9-17-21-17H30Z" fill="#edf6ff"/>
  <path class="dtd-intro-check dtd-intro-check-outline" pathLength="1" d="m28 47 11 11L83 10" fill="none" stroke="#edf6ff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="dtd-intro-check" pathLength="1" d="m28 47 11 11L83 10" fill="none" stroke="#235bd5" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <rect class="dtd-intro-pixel dtd-intro-pixel-one" x="80" y="63" width="12" height="12" rx="4" fill="url(#dtd-intro-mint)"/>
  <rect class="dtd-intro-pixel dtd-intro-pixel-two" x="79" y="80" width="7" height="7" rx="2.5" fill="#f7ce62"/>
</svg>`;

let currentIntro = null;

export function initIntro() {
  if (currentIntro) return currentIntro;
  // Respect a request for less motion: no overlay, fading or hidden dashboard.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();

  const root = document.documentElement;
  let overlay;
  let safety;
  let removal;
  let finished = false;
  let resolveFinished;
  currentIntro = new Promise((resolve) => { resolveFinished = resolve; });

  const release = (immediate = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    try {
      root.classList.remove('dtd-intro-playing');
      overlay?.classList.add('dtd-intro-leaving');
    } finally {
      // Timer runs even if CSS never loads or an animation is interrupted.
      removal = setTimeout(() => {
        overlay?.remove();
        root.classList.remove('dtd-intro-reveal');
        resolveFinished();
      }, immediate ? 0 : 300);
    }
  };

  try {
    overlay = document.createElement('div');
    overlay.className = 'dtd-intro';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<div class="dtd-intro-halo"></div><div class="dtd-intro-content">${logo}<div class="dtd-intro-name">Digital <span>To-Do</span></div><p class="dtd-intro-caption">Большие планы. Маленькие шаги.</p><div class="dtd-intro-progress"><span></span></div></div>`;
    // Overlay is decorative and does not trap input, focus or screen readers.
    document.body.appendChild(overlay);
    safety = setTimeout(() => release(true), 3000);
    root.classList.add('dtd-intro-playing', 'dtd-intro-reveal');

    const fonts = Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 850)),
    ]);
    Promise.all([
      fonts,
      new Promise((resolve) => setTimeout(resolve, 2300)),
    ]).then(() => release()).catch(() => release(true));
    // Any early action takes priority over a decorative introduction.
    document.addEventListener('pointerdown', () => release(true), { once: true });
    document.addEventListener('keydown', () => release(true), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) release(true);
    }, { once: true });
  } catch {
    root.classList.remove('dtd-intro-playing', 'dtd-intro-reveal');
    clearTimeout(safety);
    clearTimeout(removal);
    overlay?.remove();
    finished = true;
    resolveFinished();
  }
  return currentIntro;
}
