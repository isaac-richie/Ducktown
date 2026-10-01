import { animate } from 'motion/mini';

let activeEntrances = [];

export function finishEntrance() {
  activeEntrances.forEach(animation => animation.complete());
  activeEntrances = [];
}

export function playEntrance(root, enabled) {
  finishEntrance();
  if (!enabled) return;

  const heading = root.querySelector('.pond-heading, .page-head, .profile-hero');
  const feature = root.querySelector('.featured-moment, .arena-hero, .map-hero');
  const headingParts = heading ? [...heading.querySelectorAll('.section-kicker, h1, p, :scope > button')] : [];

  headingParts.forEach((element, index) => {
    activeEntrances.push(animate(element,
      { opacity: [0, 1], transform: ['translateY(18px)', 'translateY(0px)'] },
      { duration: 0.62, delay: 0.05 + index * 0.08, ease: [0.2, 0.8, 0.2, 1] }
    ));
  });

  if (feature) activeEntrances.push(animate(feature,
    { opacity: [0, 1], transform: ['translateY(24px) scale(0.985)', 'translateY(0px) scale(1)'] },
    { duration: 0.78, delay: 0.18, ease: [0.2, 0.8, 0.2, 1] }
  ));

  // Cards pop in like ducklings following in a row: a short springy cascade.
  const cards = [...root.querySelectorAll('.behavior-card, .feed-card, .challenge-tile, .side-card, .place-card, .stat-card, .resident-card')].slice(0, 12);
  cards.forEach((card, index) => {
    activeEntrances.push(animate(card,
      { opacity: [0, 1], transform: ['translateY(22px) scale(0.96)', 'translateY(0px) scale(1)'] },
      { duration: 0.6, delay: 0.26 + index * 0.05, ease: [0.34, 1.4, 0.64, 1] }
    ));
  });
}

export function bindPointerGlow(root) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  root.addEventListener('pointermove', event => {
    const card = event.target.closest('.featured-moment, .behavior-card, .feed-card, .challenge-tile');
    if (!card || !root.contains(card)) return;
    const bounds = card.getBoundingClientRect();
    card.style.setProperty('--glow-x', `${event.clientX - bounds.left}px`);
    card.style.setProperty('--glow-y', `${event.clientY - bounds.top}px`);
  });
}
