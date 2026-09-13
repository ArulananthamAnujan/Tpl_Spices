import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Category/section tabs and nav links only change the URL (pathname or query
// string) — React Router doesn't reset scroll position like a full page load
// would, so the page stays scrolled wherever the user left it.
export default function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return null;
}
