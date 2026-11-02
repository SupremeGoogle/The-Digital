// Small, bounded visual acknowledgements. Store remains the source of truth.
import * as store from './store.js';

const MAX_ACTIVE = 4;
const MAX_PENDING = 8;
let disposeEffects = null;

export function initTaskEffects() {
  if (disposeEffects) return disposeEffects;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  const pending = new Set();
  const layer = document.createElement('div');
  layer.className = 'task-effects-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  function visibleRect(element) {
    if (!element?.isConnected || document.hidden) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return null;
    return rect;
  }

  function run(id, completed) {
    const task = store.get(id);
    if (!task || (completed && task.status !== 'done') || active.size >= MAX_ACTIVE) return;
    const card = [...document.querySelectorAll('#board .card-item')].find((el) => el.dataset.id === id);
    const rect = visibleRect(card);
    if (!rect) return;

    const className = completed ? 'task-effect-completed' : 'task-effect-arrival';
    const particles = document.createElement('div');
    particles.className = 'task-effect-particles';
    const animations = [];
    let timer;
    let ended = false;
    const effect = {
      end() {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        card.classList.remove(className);
        particles.remove();
        animations.forEach((animation) => animation.cancel());
        active.delete(effect);
      },
    };
    active.add(effect);
    card.classList.add(className);
    timer = setTimeout(() => effect.end(), completed ? 900 : 720);

    // Reduced motion gets just a short static color outline; no scaling or particles.
    if (reducedMotion.matches) return;

    const animate = (target, frames, options) => {
      try {
        if (target?.animate) animations.push(target.animate(frames, options));
      } catch { /* A decorative effect must never interrupt adding or completing tasks. */ }
    };
    if (completed) {
      animate(card.querySelector('.box'), [
        { transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: .3 },
        { transform: 'scale(.94)', offset: .62 }, { transform: 'scale(1)' },
      ], { duration: 400, easing: 'cubic-bezier(.2,.7,.2,1)' });
      const progress = document.querySelector('.progress.card');
      if (visibleRect(progress)) {
        animate(progress, [
          { filter: 'brightness(1)' }, { filter: 'brightness(1.06)', offset: .35 }, { filter: 'brightness(1)' },
        ], { duration: 600, easing: 'ease-out' });
      }
    } else {
      animate(card, [
        { opacity: .35, transform: 'translateY(9px) scale(.96)' },
        { opacity: 1, transform: 'translateY(-2px) scale(1.018)', offset: .6 },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration: 430, easing: 'cubic-bezier(.16,.8,.3,1)' });
    }

    const originX = Math.max(12, Math.min(innerWidth - 12, completed ? rect.left + 26 : rect.right - 24));
    const originY = Math.max(12, Math.min(innerHeight - 12, rect.top + 26));
    particles.style.left = `${originX}px`;
    particles.style.top = `${originY}px`;
    const colors = completed ? ['#83d4b6', '#f5ce68', '#b6e8d8', '#71b1f0'] : ['#4a90ee', '#8bc2ff', '#b1d9ff'];
    const count = completed ? 12 : 5;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('i');
      particle.className = completed ? 'task-effect-confetti' : 'task-effect-spark';
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const distance = completed ? 25 + (i % 4) * 10 : 15 + (i % 3) * 7;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance - (completed ? 20 : 12);
      particle.style.setProperty('--effect-color', colors[i % colors.length]);
      particle.style.setProperty('--effect-dx', `${dx}px`);
      particle.style.setProperty('--effect-dy', `${dy}px`);
      particle.style.setProperty('--effect-end-y', `${dy + (completed ? 55 : 10)}px`);
      particle.style.setProperty('--effect-turn', `${i * 53 + 80}deg`);
      particle.style.setProperty('--effect-delay', `${i % 3 * 18}ms`);
      particles.appendChild(particle);
    }
    layer.appendChild(particles);
  }

  const unsubscribe = store.subscribe((change) => {
    const added = change.type === 'add';
    const completed = (change.type === 'move' || change.type === 'update') && change.to === 'done' && change.from !== 'done';
    if (!added && !completed) return;
    for (const id of (change.ids || []).slice(0, MAX_ACTIVE)) {
      if (pending.size >= MAX_PENDING) break;
      // Completion waits for the board's 260ms FLIP move, then celebrates at its new position.
      const token = { timer: null, frame: null };
      pending.add(token);
      token.timer = setTimeout(() => {
        token.frame = requestAnimationFrame(() => {
          pending.delete(token);
          run(id, completed);
        });
      }, completed && !reducedMotion.matches ? 275 : 0);
    }
  });

  function clear() {
    pending.forEach((token) => {
      clearTimeout(token.timer);
      if (token.frame !== null) cancelAnimationFrame(token.frame);
    });
    pending.clear();
    [...active].forEach((effect) => effect.end());
  }
  const motionChanged = () => { if (reducedMotion.matches) clear(); };
  reducedMotion.addEventListener?.('change', motionChanged);
  disposeEffects = () => {
    unsubscribe();
    clear();
    layer.remove();
    reducedMotion.removeEventListener?.('change', motionChanged);
    disposeEffects = null;
  };
  return disposeEffects;
}
