import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Category/section tabs and nav links only change the URL (pathname or query
// string) — React Router doesn't reset scroll position like a full page load
// would, so the page stays scrolled wherever the user left it.
//
// Switching to a different page always jumps to the very top. But switching
// section/category/search on the SAME page (e.g. clicking "Pooja Essentials")
// jumps straight to the product results instead — landing on the literal top
// would just bury them under the hero banner again.
export default function ScrollToTop() {
  const { pathname, search } = useLocation();
  const prevPathname = useRef<string | null>(null);

  useEffect(() => {
    const samePage = prevPathname.current === pathname;
    prevPathname.current = pathname;

    if (samePage) {
      const el = document.getElementById('products-section');
      if (el) {
        const headerOffset = 140;
        const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
        window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return null;
}
