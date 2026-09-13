import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Salad, Shirt, Truck, ShieldCheck, Leaf, Store as StoreIcon, ChefHat, Flame } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Category, Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';
import PromoCarousel from '../components/PromoCarousel';

type Section = 'grocery' | 'clothing' | 'kitchen' | 'pooja';

const SECTIONS: { id: Section; label: string; icon: typeof Salad }[] = [
  { id: 'grocery', label: 'Grocery & Spices', icon: Salad },
  { id: 'kitchen', label: 'Kitchen Essentials', icon: ChefHat },
  { id: 'pooja', label: 'Pooja Essentials', icon: Flame },
  { id: 'clothing', label: 'Clothing', icon: Shirt },
];

const FEATURE_STRIP_BG = '/images/spices-feature-strip-bg.png';

export default function StorefrontPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [section, setSection] = useState<Section>('grocery');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  // Sync state from URL params
  useEffect(() => {
    const cat = searchParams.get('category');
    const sec = searchParams.get('section') as Section | null;
    const search = searchParams.get('search');

    if (sec && SECTIONS.some(s => s.id === sec)) setSection(sec);
    setSelectedCategory(cat ?? null);
    if (search) setSearchQuery(search);
  }, [searchParams]);

  useEffect(() => {
    // Default to the first store behind the scenes for stock lookups and cart
    // association — customers pick their pickup location later, at checkout.
    supabase.from('stores').select('*').order('name').limit(1).then(({ data }) => {
      if (data && data.length > 0) setSelectedStore(data[0]);
    });
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      setCategories(data ?? []);
    });
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);

    const buildQuery = () => {
      let query = supabase
        .from('products')
        .select('*, category:categories(*), variations:product_variations(*)')
        .eq('active', true)
        .order('name');

      if (selectedCategory) {
        query = query.eq('category_id', selectedCategory);
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
            return null;
          }
        }
      }

      if (searchQuery.trim()) query = query.ilike('name', `%${searchQuery.trim()}%`);
      if (selectedBrand) query = query.eq('brand', selectedBrand);
      return query;
    };

    if (!buildQuery()) {
      // No clothing categories yet — return nothing
      setProducts([]);
      setLoadingProducts(false);
      return;
    }

    // The Supabase API caps each response at its configured max row count, so
    // page through with .range() until a page comes back short of a full page.
    const pageSize = 1000;
    const allProducts: Product[] = [];
    let from = 0;
    while (true) {
      const { data } = await buildQuery()!.range(from, from + pageSize - 1);
      allProducts.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    setProducts(allProducts);
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
  const brandCategories = categories.filter(c => c.is_brand);

  const sectionLabel = SECTIONS.find(s => s.id === section)?.label ?? 'Products';
  const SectionIcon = SECTIONS.find(s => s.id === section)?.icon ?? Salad;

  return (
    <div className="min-h-screen bg-tpl-cream">
      <PromoCarousel />

      {/* Trust / feature strip */}
      <div
        className="relative text-white bg-tpl-forest bg-cover"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(20,38,26,0.85) 0%, rgba(20,38,26,0.6) 55%, rgba(20,38,26,0.3) 100%), url('${FEATURE_STRIP_BG}')`,
          backgroundPosition: '65% 55%',
        }}
      >
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

      {/* Our Group Brands */}
      {brandCategories.length > 0 && (
        <div className="bg-tpl-dark">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
              <div className="lg:pr-10 flex-shrink-0">
                <p className="text-tpl-lime text-xs font-semibold uppercase tracking-widest mb-1">Our Group Brands</p>
                <p className="text-white font-display text-xl font-bold leading-snug">
                  Names you know.<br />Quality you come home to.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pt-6 lg:pt-0 lg:pl-10 flex-1">
                {brandCategories.map(brand => (
                  <button
                    key={brand.id}
                    onClick={() => {
                      setSection(brand.section);
                      setSelectedCategory(brand.id);
                      setSearchParams(prev => {
                        const p = new URLSearchParams(prev);
                        p.set('section', brand.section);
                        p.set('category', brand.id);
                        return p;
                      });
                    }}
                    className="text-left group"
                  >
                    <p className="text-white font-semibold group-hover:text-tpl-lime transition-colors truncate">{brand.name}</p>
                    <span className="text-tpl-pale/70 group-hover:text-tpl-lime text-xs font-medium inline-flex items-center gap-1 mt-1">
                      Explore {brand.name} →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section Tabs */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 py-2 overflow-x-auto">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => switchSection(s.id)}
                className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex-shrink-0 ${
                  section === s.id
                    ? 'bg-tpl-forest text-white shadow-sm'
                    : 'text-gray-500 hover:text-tpl-forest hover:bg-tpl-cream'
                }`}
              >
                <s.icon className="h-4 w-4" />
                {s.label}
              </button>
            ))}
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
                <SectionIcon className="h-4 w-4 text-tpl-forest" />
                <h3 className="font-semibold text-tpl-dark text-sm">{sectionLabel}</h3>
              </div>
              <button
                onClick={() => selectCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${!selectedCategory ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
              >
                All Products
              </button>
              {sidebarCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => selectCategory(cat.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${selectedCategory === cat.id ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                >
                  {cat.name}
                </button>
              ))}
              {sidebarCategories.length === 0 && (
                <p className="text-xs text-gray-400 italic px-3 py-2">No categories yet.</p>
              )}

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
            {loadingProducts ? (
              <div className="flex items-center justify-center py-20">
                <LoadingSpinner size="lg" />
              </div>
            ) : products.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-card p-12 text-center">
                <SectionIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No products found</h3>
                <p className="text-sm text-gray-500">
                  {searchQuery
                    ? `No results for "${searchQuery}" in ${sectionLabel}.`
                    : `No ${sectionLabel.toLowerCase()} products yet.`}
                </p>
                {(searchQuery || selectedCategory || selectedBrand) && (
                  <button
                    onClick={() => { setSearchQuery(''); selectCategory(null); setSelectedBrand(null); }}
                    className="mt-4 px-4 py-2 bg-tpl-forest text-white text-sm rounded-lg hover:bg-tpl-mid transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="mb-5 pb-3 border-b border-gray-200">
                  <h2 className="font-display text-xl font-bold text-tpl-dark">
                    {selectedCategory && categories.find(c => c.id === selectedCategory)
                      ? categories.find(c => c.id === selectedCategory)?.name
                      : sectionLabel}
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {products.length} product{products.length !== 1 ? 's' : ''} available
                    {selectedBrand ? ` · ${selectedBrand}` : ''}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {products.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      store={selectedStore}
                      stock={stockMap}
                      onClick={() => navigate(`/product/${product.id}`, { state: { store: selectedStore } })}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
