import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronDown, MapPin, Loader2, SlidersHorizontal, X, Salad, Shirt, Truck, ShieldCheck, Leaf, Store as StoreIcon, ArrowDownUp, Heart, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Category, Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import { effectiveUnitCents, isPromoActive } from '../lib/pricing';
import { useLocalList } from '../lib/useLocalList';
import PromoCarousel from '../components/PromoCarousel';

type Section = 'grocery' | 'clothing';
type SortKey = 'featured' | 'price_asc' | 'price_desc' | 'name' | 'newest';

const PAGE_SIZE = 24;

const SORT_LABELS: Record<SortKey, string> = {
  featured: 'Featured',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  name: 'Name: A to Z',
  newest: 'Newest arrivals',
};

// Cheapest current price across a product's variations, for sorting/filtering.
const unitPriceOf = (p: Product): number => {
  const vs = p.variations ?? [];
  if (vs.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...vs.map(v => effectiveUnitCents(v, 1)));
};

export default function StorefrontPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [section, setSection] = useState<Section>('grocery');
  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [storeDropOpen, setStoreDropOpen] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [ratings, setRatings] = useState<Record<string, { average: number; count: number }>>({});

  // Sorting / filtering / paging (applied client-side over the fetched set)
  const [sortBy, setSortBy] = useState<SortKey>('featured');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const wishlist = useLocalList('tpl_wishlist');
  const recent = useLocalList('tpl_recent', 12);

  // Sync state from URL params
  useEffect(() => {
    const cat = searchParams.get('category');
    const sec = searchParams.get('section') as Section | null;
    const search = searchParams.get('search');

    if (sec === 'grocery' || sec === 'clothing') setSection(sec);
    setSelectedCategory(cat ?? null);
    if (search) setSearchQuery(search);
  }, [searchParams]);

  useEffect(() => {
    supabase.from('stores').select('*').order('name').then(({ data }) => {
      setStores(data ?? []);
      if (data && data.length > 0) setSelectedStore(data[0]);
      setLoadingStores(false);
    });
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      setCategories(data ?? []);
    });
    // Star ratings for the cards — one small aggregate query for the catalogue.
    supabase.from('product_rating_summary').select('*').then(({ data }) => {
      const m: Record<string, { average: number; count: number }> = {};
      (data ?? []).forEach((r: any) => {
        m[r.product_id] = { average: Number(r.average_rating), count: r.review_count };
      });
      setRatings(m);
    });
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    let query = supabase
      .from('products')
      .select('*, category:categories(*), variations:product_variations(*)')
      .eq('active', true)
      .order('name');

    if (selectedCategory) {
      // Selecting a parent category also shows everything in its subcategories.
      const childIds = categories.filter(c => c.parent_id === selectedCategory).map(c => c.id);
      if (childIds.length > 0) query = query.in('category_id', [selectedCategory, ...childIds]);
      else query = query.eq('category_id', selectedCategory);
    } else {
      const sectionCatIds = categories
        .filter(c => c.section === section)
        .map(c => c.id);
      if (section === 'grocery') {
        // Grocery: all products in grocery categories OR with no category
        if (sectionCatIds.length > 0) {
          query = query.or(`category_id.in.(${sectionCatIds.join(',')}),category_id.is.null`);
        } else {
          query = query.is('category_id', null);
        }
      } else {
        // Clothing: only products explicitly in clothing categories
        if (sectionCatIds.length > 0) {
          query = query.in('category_id', sectionCatIds);
        } else {
          // No clothing categories yet — return nothing
          setProducts([]);
          setLoadingProducts(false);
          return;
        }
      }
    }

    if (searchQuery.trim()) query = query.ilike('name', `%${searchQuery.trim()}%`);
    if (selectedBrand) query = query.eq('brand', selectedBrand);

    const { data } = await query;
    setProducts(data ?? []);
    setLoadingProducts(false);
  }, [selectedCategory, selectedBrand, searchQuery, section, categories]);

  useEffect(() => {
    if (categories.length === 0 && !searchQuery) return;
    const t = setTimeout(fetchProducts, 300);
    return () => clearTimeout(t);
  }, [fetchProducts]);

  // Also fetch when categories load
  useEffect(() => {
    if (categories.length > 0) fetchProducts();
  }, [categories]);

  // Stock levels for the selected store, for whichever variations are on screen
  useEffect(() => {
    if (!selectedStore || products.length === 0) { setStockMap({}); return; }
    const variationIds = products.flatMap(p => (p.variations ?? []).map(v => v.id));
    if (variationIds.length === 0) { setStockMap({}); return; }
    supabase
      .from('store_inventory')
      .select('variation_id, quantity')
      .eq('store_id', selectedStore.id)
      .in('variation_id', variationIds)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach(r => { map[r.variation_id] = r.quantity; });
        setStockMap(map);
      });
  }, [selectedStore, products]);

  const switchSection = (s: Section) => {
    setSection(s);
    setSelectedCategory(null);
    setSelectedBrand(null);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('section', s);
      p.delete('category');
      return p;
    });
  };

  const selectCategory = (catId: string | null) => {
    setSelectedCategory(catId);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('section', section);
      if (catId) p.set('category', catId);
      else p.delete('category');
      return p;
    });
  };

  const sidebarCategories = categories.filter(c => c.section === section && !c.is_brand);

  const sectionLabel = section === 'grocery' ? 'Grocery & Spices' : 'Clothing';

  // Any tracked variation with stock left counts as in stock; untracked items
  // are always available, matching the checkout rules.
  const hasStock = (p: Product) => (p.variations ?? []).some(v => {
    const q = stockMap[v.id];
    return q === undefined || q > 0;
  });

  const minCents = minPrice.trim() === '' ? null : Math.round(parseFloat(minPrice) * 100);
  const maxCents = maxPrice.trim() === '' ? null : Math.round(parseFloat(maxPrice) * 100);

  const refined = products.filter(p => {
    if (inStockOnly && !hasStock(p)) return false;
    if (onSaleOnly && !(p.variations ?? []).some(v => isPromoActive(v))) return false;
    const price = unitPriceOf(p);
    if (minCents != null && Number.isFinite(minCents) && price < minCents) return false;
    if (maxCents != null && Number.isFinite(maxCents) && price > maxCents) return false;
    return true;
  });

  const sorted = [...refined].sort((a, b) => {
    switch (sortBy) {
      case 'price_asc': return unitPriceOf(a) - unitPriceOf(b);
      case 'price_desc': return unitPriceOf(b) - unitPriceOf(a);
      case 'name': return a.name.localeCompare(b.name);
      case 'newest': return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      default: {
        // Featured: on-sale first, then in-stock, then name.
        const aSale = (a.variations ?? []).some(v => isPromoActive(v)) ? 1 : 0;
        const bSale = (b.variations ?? []).some(v => isPromoActive(v)) ? 1 : 0;
        if (aSale !== bSale) return bSale - aSale;
        const aStock = hasStock(a) ? 1 : 0;
        const bStock = hasStock(b) ? 1 : 0;
        if (aStock !== bStock) return bStock - aStock;
        return a.name.localeCompare(b.name);
      }
    }
  });

  const shown = sorted.slice(0, visibleCount);
  const filtersActive = inStockOnly || onSaleOnly || minPrice !== '' || maxPrice !== '' || !!selectedBrand;

  const clearAllFilters = () => {
    setInStockOnly(false); setOnSaleOnly(false);
    setMinPrice(''); setMaxPrice(''); setSelectedBrand(null);
  };

  // Show a fresh first page whenever the result set changes.
  useEffect(() => { setVisibleCount(PAGE_SIZE); },
    [selectedCategory, selectedBrand, searchQuery, section, sortBy, minPrice, maxPrice, inStockOnly, onSaleOnly]);

  const savedProducts = products.filter(p => wishlist.has(p.id));
  const recentProducts = recent.ids
    .map(id => products.find(p => p.id === id))
    .filter((p): p is Product => !!p && !shown.some(s => s.id === p.id))
    .slice(0, 6);

  const openProduct = (p: Product) => {
    recent.push(p.id);
    navigate(`/product/${p.id}`, { state: { store: selectedStore } });
  };

  return (
    <div className="min-h-screen bg-tpl-cream">
      <PromoCarousel />

      {/* Trust / feature strip */}
      <div className="bg-tpl-forest text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10">
          {[
            { icon: Leaf, title: 'Fresh & Authentic', sub: 'Quality spices & groceries' },
            { icon: Truck, title: 'Delivery & Pickup', sub: 'Fast, flexible fulfilment' },
            { icon: ShieldCheck, title: 'Secure Checkout', sub: 'Safe, encrypted payments' },
            { icon: StoreIcon, title: 'Local Stores', sub: 'Serving your community' },
          ].map(f => (
            <div key={f.title} className="flex items-center gap-3 px-3 py-3.5">
              <f.icon className="h-5 w-5 text-tpl-lime flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold leading-tight truncate">{f.title}</p>
                <p className="text-[11px] text-tpl-pale/70 leading-tight truncate hidden sm:block">{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Store Selector */}
      <div className="bg-white border-b border-gray-100 py-2 px-4">
        <div className="max-w-7xl mx-auto">
          {loadingStores ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="h-4 w-4 animate-spin text-tpl-lime" />
              <span className="text-sm text-gray-500">Loading stores…</span>
            </div>
          ) : (
            <div className="relative inline-block">
              <button
                onClick={() => setStoreDropOpen(v => !v)}
                className="flex items-center gap-2 text-sm text-gray-700 hover:text-tpl-forest transition-colors py-1"
              >
                <MapPin className="h-4 w-4 text-tpl-lime flex-shrink-0" />
                <span className="font-medium">{selectedStore?.name ?? 'Select a store'}</span>
                {selectedStore && <span className="text-gray-400 text-xs hidden sm:inline">· {selectedStore.address}</span>}
                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${storeDropOpen ? 'rotate-180' : ''}`} />
              </button>
              {storeDropOpen && (
                <div className="absolute top-full mt-1 left-0 bg-white rounded-2xl shadow-card-hover border border-gray-100 z-30 overflow-hidden min-w-[280px]">
                  {stores.map(store => (
                    <button
                      key={store.id}
                      onClick={() => { setSelectedStore(store); setStoreDropOpen(false); }}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-tpl-cream transition-colors border-b last:border-b-0 border-gray-50 ${selectedStore?.id === store.id ? 'bg-tpl-pale/40' : ''}`}
                    >
                      <p className="font-semibold text-tpl-forest">{store.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{store.address}</p>
                      <div className="flex gap-2 mt-1">
                        {store.pickup_enabled && <span className="text-xs bg-tpl-pale text-tpl-forest px-1.5 py-0.5 rounded">Pickup</span>}
                        {store.delivery_enabled && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Delivery</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section Tabs */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 py-2">
            <button
              onClick={() => switchSection('grocery')}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                section === 'grocery'
                  ? 'bg-tpl-forest text-white shadow-sm'
                  : 'text-gray-500 hover:text-tpl-forest hover:bg-tpl-cream'
              }`}
            >
              <Salad className="h-4 w-4" />
              Grocery &amp; Spices
            </button>
            <button
              onClick={() => switchSection('clothing')}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                section === 'clothing'
                  ? 'bg-tpl-forest text-white shadow-sm'
                  : 'text-gray-500 hover:text-tpl-forest hover:bg-tpl-cream'
              }`}
            >
              <Shirt className="h-4 w-4" />
              Clothing
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search + Filter */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={`Search ${sectionLabel.toLowerCase()}…`}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowMobileFilters(v => !v)}
            className="md:hidden p-2.5 bg-white border border-gray-200 rounded-xl text-gray-600"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className={`w-52 flex-shrink-0 ${showMobileFilters ? 'block' : 'hidden'} md:block`}>
            <div className="bg-white rounded-2xl shadow-card p-4 sticky top-28">
              <div className="flex items-center gap-2 mb-3">
                {section === 'grocery'
                  ? <Salad className="h-4 w-4 text-tpl-forest" />
                  : <Shirt className="h-4 w-4 text-tpl-forest" />}
                <h3 className="font-semibold text-tpl-dark text-sm">{sectionLabel}</h3>
              </div>
              <button
                onClick={() => selectCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${!selectedCategory ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
              >
                All Products
              </button>
              {sidebarCategories.filter(c => !c.parent_id).map(cat => {
                const children = sidebarCategories.filter(c => c.parent_id === cat.id);
                const inBranch = selectedCategory === cat.id || children.some(c => c.id === selectedCategory);
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => selectCategory(cat.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${selectedCategory === cat.id ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                    >
                      {cat.name}
                    </button>
                    {/* Subcategories — revealed while browsing this branch */}
                    {children.length > 0 && inBranch && (
                      <div className="ml-3 pl-2 border-l border-gray-100 mb-1">
                        {children.map(child => (
                          <button
                            key={child.id}
                            onClick={() => selectCategory(child.id)}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] mb-0.5 transition-colors ${selectedCategory === child.id ? 'bg-tpl-pale text-tpl-forest font-medium' : 'text-gray-500 hover:bg-tpl-cream'}`}
                          >
                            {child.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {sidebarCategories.length === 0 && (
                <p className="text-xs text-gray-400 italic px-3 py-2">No categories yet.</p>
              )}

              {/* Price & availability filters */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-2">Price</p>
                <div className="flex items-center gap-1.5 px-3 mb-3">
                  <input type="number" min={0} value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="Min"
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                  <span className="text-gray-300 text-xs">–</span>
                  <input type="number" min={0} value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max"
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                </div>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 cursor-pointer hover:text-tpl-forest">
                  <input type="checkbox" checked={inStockOnly} onChange={e => setInStockOnly(e.target.checked)}
                    className="rounded border-gray-300 text-tpl-forest focus:ring-tpl-lime" />
                  In stock only
                </label>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 cursor-pointer hover:text-tpl-forest">
                  <input type="checkbox" checked={onSaleOnly} onChange={e => setOnSaleOnly(e.target.checked)}
                    className="rounded border-gray-300 text-tpl-forest focus:ring-tpl-lime" />
                  On sale
                </label>
              </div>

              {/* Brand filter */}
              {(() => {
                const brands = [...new Set(products.map(p => p.brand).filter(Boolean) as string[])].sort();
                if (brands.length === 0) return null;
                return (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-2">Brand</p>
                    <button
                      onClick={() => setSelectedBrand(null)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${!selectedBrand ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                    >
                      All Brands
                    </button>
                    {brands.map(brand => (
                      <button
                        key={brand}
                        onClick={() => setSelectedBrand(selectedBrand === brand ? null : brand)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${selectedBrand === brand ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                      >
                        {brand}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </aside>

          {/* Product Grid */}
          <div className="flex-1 min-w-0">
            {/* Toolbar: result count + sort */}
            {!loadingProducts && products.length > 0 && (
              <div className="mb-4 pb-3 border-b border-gray-200 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-tpl-dark">
                    {selectedCategory && categories.find(c => c.id === selectedCategory)
                      ? categories.find(c => c.id === selectedCategory)?.name
                      : sectionLabel}
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Showing {Math.min(shown.length, sorted.length)} of {sorted.length} product{sorted.length !== 1 ? 's' : ''}
                    {selectedBrand ? ` · ${selectedBrand}` : ''}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <ArrowDownUp className="h-4 w-4 text-gray-400" />
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortKey)}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                  >
                    {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                      <option key={k} value={k}>{SORT_LABELS[k]}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {/* Active filter chips */}
            {filtersActive && !loadingProducts && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {inStockOnly && (
                  <button onClick={() => setInStockOnly(false)} className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-tpl-forest">
                    In stock <X className="h-3 w-3" />
                  </button>
                )}
                {onSaleOnly && (
                  <button onClick={() => setOnSaleOnly(false)} className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-tpl-forest">
                    On sale <X className="h-3 w-3" />
                  </button>
                )}
                {(minPrice || maxPrice) && (
                  <button onClick={() => { setMinPrice(''); setMaxPrice(''); }} className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-tpl-forest">
                    {minPrice ? `$${minPrice}` : '$0'}–{maxPrice ? `$${maxPrice}` : 'any'} <X className="h-3 w-3" />
                  </button>
                )}
                {selectedBrand && (
                  <button onClick={() => setSelectedBrand(null)} className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-tpl-forest">
                    {selectedBrand} <X className="h-3 w-3" />
                  </button>
                )}
                <button onClick={clearAllFilters} className="text-xs text-tpl-forest font-medium hover:underline">Clear all</button>
              </div>
            )}

            {loadingProducts ? (
              // Skeleton cards keep the layout stable while results load.
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl shadow-card overflow-hidden animate-pulse">
                    <div className="aspect-square bg-gray-100" />
                    <div className="p-4 space-y-2">
                      <div className="h-3 bg-gray-100 rounded w-1/3" />
                      <div className="h-4 bg-gray-100 rounded w-4/5" />
                      <div className="h-5 bg-gray-100 rounded w-1/2 mt-3" />
                      <div className="h-8 bg-gray-100 rounded-xl mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-card p-12 text-center">
                {section === 'grocery'
                  ? <Salad className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  : <Shirt className="h-12 w-12 text-gray-300 mx-auto mb-4" />}
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No products found</h3>
                <p className="text-sm text-gray-500">
                  {products.length > 0
                    ? 'No products match your filters. Try widening them.'
                    : searchQuery
                      ? `No results for "${searchQuery}" in ${sectionLabel}.`
                      : `No ${sectionLabel.toLowerCase()} products yet.`}
                </p>
                {(searchQuery || selectedCategory || filtersActive) && (
                  <button
                    onClick={() => { setSearchQuery(''); selectCategory(null); clearAllFilters(); }}
                    className="mt-4 px-4 py-2 bg-tpl-forest text-white text-sm rounded-lg hover:bg-tpl-mid transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {shown.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      store={selectedStore}
                      stock={stockMap}
                      rating={ratings[product.id]}
                      onClick={() => openProduct(product)}
                    />
                  ))}
                </div>

                {shown.length < sorted.length && (
                  <div className="flex flex-col items-center gap-2 mt-8">
                    <button
                      onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                      className="px-6 py-3 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors"
                    >
                      Load more products
                    </button>
                    <span className="text-xs text-gray-400">{sorted.length - shown.length} more</span>
                  </div>
                )}

                {/* Saved for later */}
                {savedProducts.length > 0 && (
                  <section className="mt-12">
                    <h3 className="font-display text-lg font-bold text-tpl-dark mb-3 flex items-center gap-2">
                      <Heart className="h-4 w-4 text-red-500 fill-current" /> Saved for later
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                      {savedProducts.slice(0, 6).map(p => (
                        <ProductCard key={p.id} product={p} store={selectedStore} stock={stockMap} rating={ratings[p.id]} onClick={() => openProduct(p)} />
                      ))}
                    </div>
                  </section>
                )}

                {/* Recently viewed */}
                {recentProducts.length > 0 && (
                  <section className="mt-12">
                    <h3 className="font-display text-lg font-bold text-tpl-dark mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-tpl-forest" /> Recently viewed
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                      {recentProducts.map(p => (
                        <ProductCard key={p.id} product={p} store={selectedStore} stock={stockMap} rating={ratings[p.id]} onClick={() => openProduct(p)} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
