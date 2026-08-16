import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Scroll offset of each history entry, so going back lands where you left off.
const positions = new Map<string, number>();

// `scroll-behavior: smooth` in index.css would otherwise animate these jumps,
// leaving the previous page's content on screen for a few hundred milliseconds.
function jumpTo(top: number) {
  window.scrollTo({ top, left: 0, behavior: 'instant' });
}

// Jumping to 0 once isn't enough: as the new page's data and images arrive, the
// browser's scroll anchoring nudges the page back down a few dozen pixels. Hold
// the top briefly, and get out of the way the moment the shopper scrolls.
function pinToTop() {
  const giveUpAt = performance.now() + 400;
  const interactions = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
  let cancelled = false;

  const release = () => {
    cancelled = true;
    interactions.forEach(e => window.removeEventListener(e, release));
  };
  interactions.forEach(e => window.addEventListener(e, release, { passive: true }));

  const tick = () => {
    if (cancelled) return;
    if (window.scrollY !== 0) jumpTo(0);
    if (performance.now() < giveUpAt) requestAnimationFrame(tick);
    else release();
  };

  jumpTo(0);
  requestAnimationFrame(tick);
  return release;
}

// Content loads after the route renders, so the page is often too short to scroll
// to the saved offset right away. Keep trying until it's tall enough.
function restore(top: number) {
  let frames = 0;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    const canReach = document.documentElement.scrollHeight >= top + window.innerHeight;
    if (canReach || frames > 40) {
      jumpTo(top);
      return;
    }
    frames += 1;
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
  return () => { cancelled = true; };
}

export default function ScrollToTop() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const keyRef = useRef(location.key);
  const restoringRef = useRef(false);

  // The browser's own restoration fights ours on a SPA, where it measures the
  // page before the data arrives.
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  // Track where the shopper is on the current entry.
  useEffect(() => {
    keyRef.current = location.key;
    const onScroll = () => {
      if (!restoringRef.current) positions.set(keyRef.current, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.key]);

  useLayoutEffect(() => {
    // Read before scrolling: landing at 0 fires a scroll event of its own.
    const saved = positions.get(location.key);

    if (navigationType === 'POP' && saved) {
      restoringRef.current = true;
      const cancel = restore(saved);
      return () => { cancel(); restoringRef.current = false; };
    }

    return pinToTop();
  }, [location.key, location.pathname, location.search, navigationType]);

  return null;
}
