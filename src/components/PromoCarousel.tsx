import { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PromoSlide } from '../lib/types';

const SLIDE_INTERVAL = 5000;

const GRADIENT_PAIRS = [
  'from-tpl-dark via-tpl-forest to-tpl-mid',
  'from-tpl-dark via-[#1a3a4a] to-[#1e5a5a]',
  'from-[#2a1a0e] via-[#5c2d0e] to-[#8b4513]',
  'from-[#0e1a2a] via-[#1a3060] to-[#1e4a8b]',
];

export default function PromoCarousel() {
  const [slides, setSlides] = useState<PromoSlide[]>([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    supabase
      .from('promo_slides')
      .select('*')
      .eq('active', true)
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('sort_order')
      .then(({ data }) => {
        setSlides(data ?? []);
      });
  }, []);

  const next = useCallback(() => {
    setCurrent(c => (c + 1) % (slides.length || 1));
  }, [slides.length]);

  const prev = useCallback(() => {
    setCurrent(c => (c - 1 + (slides.length || 1)) % (slides.length || 1));
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    timerRef.current = setInterval(next, SLIDE_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [slides.length, paused, next]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 40) { if (diff > 0) next(); else prev(); }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  if (slides.length === 0) {
    return (
      <div className="bg-gradient-to-r from-tpl-dark via-tpl-forest to-tpl-mid py-16 px-4 flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-3xl sm:text-4xl text-white font-bold leading-tight">
            Authentic Sri Lankan<br />
            <span className="text-tpl-lime">&amp; Indian Groceries</span>
          </h1>
          <p className="text-tpl-pale/80 mt-3 text-sm sm:text-base">
            Fresh spices, pantry essentials &amp; more — delivered or ready for pickup.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-tpl-lime text-tpl-dark font-semibold rounded-xl hover:bg-tpl-light transition-colors"
          >
            Shop Now <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative w-full overflow-hidden select-none"
      style={{ minHeight: 320 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Slides */}
      {slides.map((s, i) => (
        <div
          key={s.id}
          className={`absolute inset-0 transition-opacity duration-700 ${i === current ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
          aria-hidden={i !== current}
        >
          {s.image_url ? (
            <div className="relative w-full h-full" style={{ minHeight: 320 }}>
              <img
                src={s.image_url}
                alt={s.title ?? 'Promotion'}
                className="w-full h-full object-cover"
                style={{ minHeight: 320 }}
              />
              {/* overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-tpl-dark/80 via-tpl-dark/40 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-center px-8 sm:px-16 py-12">
                {s.discount_label && (
                  <span className="inline-block bg-tpl-lime text-tpl-dark text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-3 w-fit">
                    {s.discount_label}
                  </span>
                )}
                {s.title && (
                  <h2 className="font-display text-3xl sm:text-5xl text-white font-bold leading-tight max-w-lg drop-shadow">
                    {s.title}
                  </h2>
                )}
                {s.subtitle && (
                  <p className="text-tpl-pale/90 mt-3 text-sm sm:text-lg max-w-md leading-relaxed drop-shadow">
                    {s.subtitle}
                  </p>
                )}
                {s.cta_text && s.cta_link && (
                  <Link
                    to={s.cta_link}
                    className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-tpl-lime text-tpl-dark font-bold rounded-xl hover:bg-tpl-light transition-colors w-fit shadow-lg"
                  >
                    {s.cta_text} <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className={`bg-gradient-to-r ${GRADIENT_PAIRS[i % GRADIENT_PAIRS.length]} w-full h-full flex items-center`} style={{ minHeight: 320 }}>
              <div className="max-w-7xl mx-auto px-8 sm:px-16 py-12 w-full">
                <div className="max-w-xl">
                  {s.discount_label && (
                    <span className="inline-block bg-tpl-lime text-tpl-dark text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider mb-4">
                      {s.discount_label}
                    </span>
                  )}
                  {s.title && (
                    <h2 className="font-display text-3xl sm:text-5xl text-white font-bold leading-tight">
                      {s.title}
                    </h2>
                  )}
                  {s.subtitle && (
                    <p className="text-tpl-pale/80 mt-3 text-sm sm:text-lg leading-relaxed">
                      {s.subtitle}
                    </p>
                  )}
                  {s.cta_text && s.cta_link && (
                    <Link
                      to={s.cta_link}
                      className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-tpl-lime text-tpl-dark font-bold rounded-xl hover:bg-tpl-light transition-colors shadow-lg"
                    >
                      {s.cta_text} <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Spacer so container has height */}
      <div className="invisible" style={{ minHeight: 320 }} aria-hidden="true" />

      {/* Prev / Next arrows */}
      {slides.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
            aria-label="Next slide"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {slides.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`rounded-full transition-all duration-300 ${i === current ? 'w-6 h-2.5 bg-tpl-lime' : 'w-2.5 h-2.5 bg-white/50 hover:bg-white/80'}`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Progress bar */}
      {slides.length > 1 && !paused && (
        <div className="absolute bottom-0 left-0 w-full h-0.5 z-20 bg-white/10">
          <div
            key={current}
            className="h-full bg-tpl-lime"
            style={{ animation: `progress ${SLIDE_INTERVAL}ms linear forwards` }}
          />
        </div>
      )}

      <style>{`
        @keyframes progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  );
}
