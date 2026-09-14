import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Store as StoreIcon, Users, Package, RefreshCw, Plus, Edit2, Trash2,
  CheckCircle, AlertCircle, Megaphone, Upload, X, ToggleLeft, ToggleRight,
  Image as ImageIcon, Type, Tag, Shirt, Salad, Camera, Search as SearchIcon, Wand2, Loader2, Boxes,
  History as HistoryIcon, Clock, PackagePlus, ChefHat, Flame
} from 'lucide-react';

const CATEGORY_SECTIONS: { id: Category['section']; label: string; icon: typeof Salad }[] = [
  { id: 'grocery', label: 'Grocery', icon: Salad },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat },
  { id: 'pooja', label: 'Pooja', icon: Flame },
  { id: 'clothing', label: 'Clothing', icon: Shirt },
];
import { supabase } from '../lib/supabase';
import { Store, Profile, Order, PromoSlide, Category, Product, formatPrice } from '../lib/types';
import OrderStatusBadge from '../components/OrderStatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import PricingPromotionsPanel from '../components/PricingPromotionsPanel';

type Tab = 'orders' | 'stores' | 'staff' | 'catalog' | 'categories' | 'products' | 'inventory' | 'pricing' | 'promos';

// A single row from the inventory_movements ledger.
type InvMove = {
  id: string;
  variation_id: string;
  delta: number;
  reason: string;
  received_at: string | null;
  created_at: string;
  note: string | null;
  creator?: { full_name: string | null } | null;
};

// Work out how much stock is available and how old it is, using FIFO:
// the oldest received batches are depleted first by the outgoing movements.
function computeAging(moves: InvMove[]) {
  const inflows = moves
    .filter(m => m.delta > 0)
    .map(m => ({ when: m.received_at || m.created_at, remaining: m.delta }))
    .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  let out = moves.filter(m => m.delta < 0).reduce((s, m) => s + -m.delta, 0);
  for (const b of inflows) {
    if (out <= 0) break;
    const take = Math.min(b.remaining, out);
    b.remaining -= take;
    out -= take;
  }
  const now = Date.now();
  const bk = { available: 0, fresh: 0, mid: 0, old: 0 }; // 0-1m, 1-3m, 3m+
  for (const b of inflows) {
    if (b.remaining <= 0) continue;
    bk.available += b.remaining;
    const days = (now - new Date(b.when).getTime()) / 86400000;
    if (days < 30) bk.fresh += b.remaining;
    else if (days < 90) bk.mid += b.remaining;
    else bk.old += b.remaining;
  }
  return bk;
}

const REASON_LABEL: Record<string, string> = {
  received: 'Received',
  sale: 'Sale',
  adjustment: 'Adjusted',
  initial: 'Opening balance',
};

// Supabase caps a single response at its configured max row count. Page
// through with .range() until a short page comes back so large catalogues
// (1000+ products) load in full instead of being silently truncated.
async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data } = await buildQuery().range(from, from + pageSize - 1);
    all.push(...((data as T[]) ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

const EMPTY_SLIDE: Partial<PromoSlide> = {
  title: '',
  subtitle: '',
  image_url: null,
  discount_label: '',
  cta_text: 'Shop Now',
  cta_link: '/',
  active: true,
  sort_order: 0,
  start_date: new Date().toISOString().split('T')[0],
  end_date: null,
};

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [slides, setSlides] = useState<PromoSlide[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [savingCatId, setSavingCatId] = useState<string | null>(null);

  // Products image management
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productImageUrl, setProductImageUrl] = useState('');
  const [uploadingProductImg, setUploadingProductImg] = useState(false);
  const [savingProductImg, setSavingProductImg] = useState(false);
  const productImgRef = useRef<HTMLInputElement>(null);

  // Auto-fill state
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillProgress, setAutoFillProgress] = useState({ done: 0, total: 0, current: '', found: 0 });
  const [showAutoFill, setShowAutoFill] = useState(false);

  // AI generation state
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openai_api_key') ?? '');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiSection, setAiSection] = useState<'grocery' | 'clothing' | 'all'>('grocery');
  const [aiOverwrite, setAiOverwrite] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0, current: '', errors: 0 });
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; imageUrl?: string; error?: string; product?: string } | null>(null);
  const [aiTesting, setAiTesting] = useState(false);

  // Per-product AI action state
  const [enhancingProductId, setEnhancingProductId] = useState<string | null>(null);
  const [productActionError, setProductActionError] = useState<{ id: string; msg: string } | null>(null);

  // AI enhance state
  const [showEnhancePanel, setShowEnhancePanel] = useState(false);
  const [enhanceSection, setEnhanceSection] = useState<'grocery' | 'clothing' | 'all'>('grocery');
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState({ done: 0, total: 0, current: '', errors: 0 });
  const [enhanceTesting, setEnhanceTesting] = useState(false);
  const [enhanceTestResult, setEnhanceTestResult] = useState<{ ok: boolean; imageUrl?: string; error?: string; product?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [squareToken, setSquareToken] = useState('');
  const [squareEnv, setSquareEnv] = useState<'sandbox' | 'production'>('production');
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Store form
  const [storeForm, setStoreForm] = useState<Partial<Store> | null>(null);
  const [savingStore, setSavingStore] = useState(false);

  // Inventory management
  const [invStoreId, setInvStoreId] = useState('');
  const [invProducts, setInvProducts] = useState<Product[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invRows, setInvRows] = useState<Record<string, number>>({}); // variation_id -> tracked quantity
  const [invDrafts, setInvDrafts] = useState<Record<string, string>>({}); // variation_id -> input value while editing
  const [invSavingId, setInvSavingId] = useState<string | null>(null);
  const [invSearch, setInvSearch] = useState('');
  const [invMoves, setInvMoves] = useState<Record<string, InvMove[]>>({}); // variation_id -> movements (newest first)
  const [invPanelVar, setInvPanelVar] = useState<string | null>(null); // which variation's detail panel is open
  const [addQty, setAddQty] = useState('');
  const [addDate, setAddDate] = useState('');
  const [addNote, setAddNote] = useState('');

  // Promo slide form
  const [slideForm, setSlideForm] = useState<Partial<PromoSlide> | null>(null);
  const [savingSlide, setSavingSlide] = useState(false);
  const [slideError, setSlideError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [useImageMode, setUseImageMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadTab(tab); }, [tab]);

  const loadTab = async (t: Tab) => {
    setLoading(true);
    if (t === 'orders') {
      const { data } = await supabase.from('orders').select('*, store:stores(name), order_items(*)').order('created_at', { ascending: false }).limit(100);
      setOrders(data ?? []);
    } else if (t === 'stores') {
      const { data } = await supabase.from('stores').select('*').order('name');
      setStores(data ?? []);
    } else if (t === 'staff') {
      const { data } = await supabase.from('profiles').select('*, store:stores(name)').neq('role', 'customer').order('full_name');
      setStaff(data ?? []);
    } else if (t === 'promos') {
      const { data } = await supabase.from('promo_slides').select('*').order('sort_order');
      setSlides(data ?? []);
    } else if (t === 'categories') {
      const { data } = await supabase.from('categories').select('*').order('sort_order');
      setAllCategories(data ?? []);
    } else if (t === 'products') {
      const data = await fetchAllRows<Product>(() =>
        supabase.from('products').select('*, category:categories(name, section)').eq('active', true).order('name')
      );
      setProducts(data);
    } else if (t === 'inventory') {
      const [storesRes, productsData] = await Promise.all([
        stores.length ? Promise.resolve({ data: stores }) : supabase.from('stores').select('*').order('name'),
        fetchAllRows<Product>(() =>
          supabase.from('products').select('*, category:categories(name), variations:product_variations(*)').eq('active', true).order('name')
        ),
      ]);
      if (!stores.length) setStores((storesRes as any).data ?? []);
      const loadedStores = stores.length ? stores : ((storesRes as any).data ?? []);
      setInvProducts(productsData);
      if (!invStoreId && loadedStores.length > 0) setInvStoreId(loadedStores[0].id);
    }
    setLoading(false);
  };

  const loadInventoryForStore = useCallback(async (storeId: string) => {
    if (!storeId) return;
    setInvLoading(true);
    const [invRes, movesRes] = await Promise.all([
      supabase.from('store_inventory').select('variation_id, quantity').eq('store_id', storeId),
      supabase
        .from('inventory_movements')
        .select('id, variation_id, delta, reason, received_at, created_at, note, creator:profiles(full_name)')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false }),
    ]);
    const map: Record<string, number> = {};
    (invRes.data ?? []).forEach(r => { map[r.variation_id] = r.quantity; });
    setInvRows(map);
    const moveMap: Record<string, InvMove[]> = {};
    ((movesRes.data as InvMove[] | null) ?? []).forEach(m => {
      (moveMap[m.variation_id] = moveMap[m.variation_id] ?? []).push(m);
    });
    setInvMoves(moveMap);
    setInvDrafts({});
    setInvLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'inventory' && invStoreId) loadInventoryForStore(invStoreId);
  }, [tab, invStoreId, loadInventoryForStore]);

  // Setting the quantity records an "adjustment" movement (the difference from
  // the current level) so the change is logged with a timestamp and the user.
  const saveInventoryQty = async (variationId: string, qtyStr: string) => {
    const qty = Math.max(0, Math.floor(Number(qtyStr)));
    if (!Number.isFinite(qty)) return;
    const current = invRows[variationId] ?? 0;
    const delta = qty - current;
    if (delta === 0) {
      setInvDrafts(prev => { const next = { ...prev }; delete next[variationId]; return next; });
      return;
    }
    setInvSavingId(variationId);
    const { error } = await supabase.rpc('record_inventory_movement', {
      p_store_id: invStoreId,
      p_variation_id: variationId,
      p_delta: delta,
      p_reason: 'adjustment',
      p_note: `Set quantity to ${qty}`,
    });
    if (error) alert(error.message);
    else await loadInventoryForStore(invStoreId);
    setInvSavingId(null);
  };

  // Add received stock as a batch, with the date it arrived (used for aging).
  const addStock = async (variationId: string) => {
    const qty = Math.floor(Number(addQty));
    if (!Number.isFinite(qty) || qty <= 0) { alert('Enter a quantity greater than 0.'); return; }
    setInvSavingId(variationId);
    const { error } = await supabase.rpc('record_inventory_movement', {
      p_store_id: invStoreId,
      p_variation_id: variationId,
      p_delta: qty,
      p_reason: 'received',
      p_received_at: addDate ? new Date(addDate).toISOString() : null,
      p_note: addNote || null,
    });
    if (error) {
      alert(error.message);
    } else {
      setAddQty(''); setAddDate(''); setAddNote('');
      await loadInventoryForStore(invStoreId);
    }
    setInvSavingId(null);
  };

  const untrackInventory = async (variationId: string) => {
    setInvSavingId(variationId);
    const { error } = await supabase.from('store_inventory').delete().eq('store_id', invStoreId).eq('variation_id', variationId);
    if (!error) {
      setInvRows(prev => { const next = { ...prev }; delete next[variationId]; return next; });
    }
    setInvSavingId(null);
  };

  const syncCatalog = async () => {
    setSyncLoading(true); setSyncMessage(''); setTestResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-catalog`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ square_token: squareToken.trim() || undefined, square_env: squareEnv }),
      });
      const body = await res.json();
      if (!res.ok || body.error) { setSyncMessage('Error: ' + (body.error || 'sync failed')); }
      else { setSyncMessage(`Synced successfully: ${body.categories ?? 0} categories, ${body.products ?? 0} products, ${body.variations ?? 0} variations, ${body.inventoryAdjustments ?? 0} stock updates. (${body.squareTotal ?? 0} total objects from Square)`); }
    } catch (e: any) {
      setSyncMessage('Error: ' + e.message);
    }
    setSyncLoading(false);
  };

  const testConnection = async () => {
    setTestLoading(true); setTestResult(null); setSyncMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-catalog`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ square_token: squareToken.trim() || undefined, square_env: squareEnv, debug: true }),
      });
      const body = await res.json();
      setTestResult(body);
    } catch (e: any) {
      setTestResult({ error: e.message });
    }
    setTestLoading(false);
  };

  const deleteStore = async (id: string) => {
    if (!window.confirm('Delete this store?')) return;
    await supabase.from('stores').delete().eq('id', id);
    setStores(prev => prev.filter(s => s.id !== id));
  };

  const saveStore = async () => {
    if (!storeForm) return;
    setSavingStore(true);
    // Only one store can be the payment location at a time.
    if (storeForm.is_payment_location) {
      await supabase.from('stores').update({ is_payment_location: false }).neq('id', storeForm.id ?? '');
      setStores(prev => prev.map(s => s.id === storeForm.id ? s : { ...s, is_payment_location: false }));
    }
    if (storeForm.id) {
      const { error } = await supabase.from('stores').update(storeForm).eq('id', storeForm.id);
      if (!error) { setStores(prev => prev.map(s => s.id === storeForm.id ? { ...s, ...storeForm } as Store : s)); setStoreForm(null); }
    } else {
      const { data, error } = await supabase.from('stores').insert([storeForm]).select().maybeSingle();
      if (!error && data) { setStores(prev => [...prev, data]); setStoreForm(null); }
    }
    setSavingStore(false);
  };

  const updateStaffRole = async (staffId: string, role: string, storeId: string | null) => {
    await supabase.from('profiles').update({ role, assigned_store_id: storeId }).eq('id', staffId);
    setStaff(prev => prev.map(s => s.id === staffId ? { ...s, role: role as any, assigned_store_id: storeId } : s));
  };

  // "Grocery" here means the AI photo-generation pipeline (product-style shots)
  // rather than the clothing/apparel one — kitchen and pooja items go through
  // the same non-apparel pipeline, they just show under their own nav tab.
  const isGroceryProduct = (product: Product): boolean => {
    const cat = (product as any).category;
    return !cat || cat.section !== 'clothing';
  };

  // Search Open Food Facts with a term; returns image URL or null
  const searchOFF = async (term: string): Promise<string | null> => {
    if (!term.trim()) return null;
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term.trim())}&action=process&json=1&page_size=5&fields=product_name,image_front_url,image_url`,
        { headers: { 'User-Agent': 'TPLStore/1.0' } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const match = data.products?.find((p: any) => p.image_front_url || p.image_url);
      return match?.image_front_url || match?.image_url || null;
    } catch {
      return null;
    }
  };

  // Build 3-level search terms: full name → product type words → category name
  const buildSearchTerms = (name: string, categoryName: string): string[] => {
    const noSize = name
      .replace(/\b\d+(\.\d+)?\s*(g|kg|ml|l|oz|lb|gm|litre|liter|pcs|pack|pieces?)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const words = noSize.split(' ').filter(w => w.length > 2);
    // Last 3 words = usually the product type after stripping brand
    const productType = words.slice(-3).join(' ');
    // Last 2 words = core product
    const coreProduct = words.slice(-2).join(' ');
    // Category as guaranteed fallback
    const catTerm = categoryName?.trim() ?? '';

    return [...new Set([noSize, productType, coreProduct, catTerm].filter(Boolean))];
  };

  const runAutoFill = async () => {
    const missing = products.filter(p => !p.image_url && isGroceryProduct(p));
    if (missing.length === 0) { alert('All grocery products already have photos!'); return; }
    setAutoFilling(true);
    setAutoFillProgress({ done: 0, total: missing.length, current: '', found: 0 });
    let found = 0;
    for (let i = 0; i < missing.length; i++) {
      const product = missing[i];
      const categoryName = (product as any).category?.name ?? 'grocery';
      const terms = buildSearchTerms(product.name, categoryName);
      setAutoFillProgress({ done: i, total: missing.length, current: product.name, found });

      let url: string | null = null;
      for (const term of terms) {
        url = await searchOFF(term);
        if (url) break;
        await new Promise(r => setTimeout(r, 250));
      }

      if (url) {
        found++;
        await supabase.from('products').update({ image_url: url }).eq('id', product.id);
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: url } : p));
      }
      // Small pause between products
      await new Promise(r => setTimeout(r, 300));
    }
    setAutoFillProgress({ done: missing.length, total: missing.length, current: '', found });
    setAutoFilling(false);
  };

  const aiProductTargets = () => {
    let list = products;
    if (aiSection === 'grocery') list = products.filter(isGroceryProduct);
    else if (aiSection === 'clothing') list = products.filter(p => !isGroceryProduct(p));
    if (!aiOverwrite) list = list.filter(p => !p.image_url);
    return list;
  };

  const runTestGeneration = async () => {
    if (!openaiKey.trim()) return;
    localStorage.setItem('openai_api_key', openaiKey.trim());
    const candidate = products.find(p => isGroceryProduct(p) && !p.image_url) ?? products.find(isGroceryProduct);
    if (!candidate) { setAiTestResult({ ok: false, error: 'No grocery products found.' }); return; }
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const categoryName = (candidate as any).category?.name ?? 'grocery';
      const { data, error } = await supabase.functions.invoke('generate-product-image', {
        body: { productId: candidate.id, productName: candidate.name, categoryName, section: 'grocery' },
        headers: { 'X-OpenAI-Key': openaiKey.trim() },
      });
      // Edge function always returns HTTP 200 — check data.success for the real result
      const invokeError = error?.message;
      const dataError = data?.success === false ? (data?.error ?? 'Unknown error from AI service') : null;
      const errorMsg = invokeError ?? dataError;
      if (errorMsg) {
        setAiTestResult({ ok: false, error: errorMsg, product: candidate.name });
      } else {
        setProducts(prev => prev.map(p => p.id === candidate.id ? { ...p, image_url: data.imageUrl } : p));
        setAiTestResult({ ok: true, imageUrl: data.imageUrl, product: candidate.name });
      }
    } catch (e: any) {
      setAiTestResult({ ok: false, error: e?.message ?? 'Unknown error', product: candidate.name });
    }
    setAiTesting(false);
  };

  const runAiGeneration = async () => {
    if (!openaiKey.trim()) return;
    localStorage.setItem('openai_api_key', openaiKey.trim());
    const targets = aiProductTargets();
    if (targets.length === 0) { alert('No products to generate for!'); return; }
    setAiGenerating(true);
    setAiProgress({ done: 0, total: targets.length, current: '', errors: 0 });
    let errors = 0;
    for (let i = 0; i < targets.length; i++) {
      const product = targets[i];
      const categoryName = (product as any).category?.name ?? 'grocery';
      const section = isGroceryProduct(product) ? 'grocery' : 'clothing';
      setAiProgress({ done: i, total: targets.length, current: product.name, errors });
      try {
        const { data, error } = await supabase.functions.invoke('generate-product-image', {
          body: { productId: product.id, productName: product.name, categoryName, section },
          headers: { 'X-OpenAI-Key': openaiKey.trim() },
        });
        if (error || data?.success === false || !data?.imageUrl) {
          errors++;
        } else {
          setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: data.imageUrl } : p));
        }
      } catch { errors++; }
      // DALL-E 3 rate limit: 5 images/min (Tier 1) — wait 13s between requests
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 13000));
    }
    setAiProgress({ done: targets.length, total: targets.length, current: '', errors });
    setAiGenerating(false);
  };

  const isAiEnhanced = (url: string | null | undefined) =>
    !!url && url.includes('/product-images/ai/');

  // Only real uploaded photos (in our Supabase storage /products/ bucket) should be enhanced.
  // Third-party URLs (openfoodfacts, pexels, etc.) are placeholder images and must not be sent to the AI.
  const isRealUploadedPhoto = (url: string | null | undefined) =>
    !!url && (url.includes('/product-images/products/') || url.startsWith('/images/'));

  const aiEnhanceTargets = () => {
    let list = products.filter(p => isRealUploadedPhoto(p.image_url) && !isAiEnhanced(p.image_url));
    if (enhanceSection === 'grocery') list = list.filter(isGroceryProduct);
    else if (enhanceSection === 'clothing') list = list.filter(p => !isGroceryProduct(p));
    return list;
  };

  const resetAiImage = async (product: Product) => {
    // Reconstruct the original uploaded photo URL from Supabase storage
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const originalUrl = `${supabaseUrl}/storage/v1/object/public/product-images/products/${product.id}.jpeg`;
    const { error } = await supabase.from('products').update({ image_url: originalUrl }).eq('id', product.id);
    if (!error) {
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: originalUrl } : p));
    }
  };

  const runTestEnhancement = async () => {
    if (!openaiKey.trim()) return;
    localStorage.setItem('openai_api_key', openaiKey.trim());
    const candidate = products.find(p => isRealUploadedPhoto(p.image_url) && !isAiEnhanced(p.image_url) && isGroceryProduct(p));
    if (!candidate) { setEnhanceTestResult({ ok: false, error: 'No grocery products with existing photos found.' }); return; }
    setEnhanceTesting(true);
    setEnhanceTestResult(null);
    try {
      const categoryName = (candidate as any).category?.name ?? 'grocery';
      const { data, error } = await supabase.functions.invoke('generate-product-image', {
        body: { productId: candidate.id, productName: candidate.name, categoryName, section: 'grocery', existingImageUrl: candidate.image_url },
        headers: { 'X-OpenAI-Key': openaiKey.trim() },
      });
      const invokeError = error?.message;
      const dataError = data?.success === false ? (data?.error ?? 'Unknown error from AI service') : null;
      const errorMsg = invokeError ?? dataError;
      if (errorMsg) {
        setEnhanceTestResult({ ok: false, error: errorMsg, product: candidate.name });
      } else {
        setProducts(prev => prev.map(p => p.id === candidate.id ? { ...p, image_url: data.imageUrl } : p));
        setEnhanceTestResult({ ok: true, imageUrl: data.imageUrl, product: candidate.name });
      }
    } catch (e: any) {
      setEnhanceTestResult({ ok: false, error: e?.message ?? 'Unknown error', product: candidate.name });
    }
    setEnhanceTesting(false);
  };

  const runAiEnhancement = async () => {
    if (!openaiKey.trim()) return;
    localStorage.setItem('openai_api_key', openaiKey.trim());
    const targets = aiEnhanceTargets();
    if (targets.length === 0) { alert('No products with photos to enhance!'); return; }
    setEnhancing(true);
    setEnhanceProgress({ done: 0, total: targets.length, current: '', errors: 0 });
    let errors = 0;
    for (let i = 0; i < targets.length; i++) {
      const product = targets[i];
      const categoryName = (product as any).category?.name ?? 'grocery';
      const section = isGroceryProduct(product) ? 'grocery' : 'clothing';
      setEnhanceProgress({ done: i, total: targets.length, current: product.name, errors });
      try {
        const { data, error } = await supabase.functions.invoke('generate-product-image', {
          body: { productId: product.id, productName: product.name, categoryName, section, existingImageUrl: product.image_url },
          headers: { 'X-OpenAI-Key': openaiKey.trim() },
        });
        if (error || data?.success === false || !data?.imageUrl) {
          errors++;
        } else {
          setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: data.imageUrl } : p));
        }
      } catch { errors++; }
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 13000));
    }
    setEnhanceProgress({ done: targets.length, total: targets.length, current: '', errors });
    setEnhancing(false);
  };

  // Upload local rice images to Supabase storage
  const [uploadingLocalImages, setUploadingLocalImages] = useState(false);
  const [localUploadProgress, setLocalUploadProgress] = useState({ done: 0, total: 0, current: '', errors: 0 });
  const [localUploadDone, setLocalUploadDone] = useState(false);

  const uploadLocalRiceImages = async () => {
    const riceProducts = products.filter(p => p.image_url?.startsWith('/images/'));
    if (riceProducts.length === 0) { alert('No local rice images to upload — all already in storage.'); return; }
    setUploadingLocalImages(true);
    setLocalUploadDone(false);
    setLocalUploadProgress({ done: 0, total: riceProducts.length, current: '', errors: 0 });
    let errors = 0;
    for (let i = 0; i < riceProducts.length; i++) {
      const product = riceProducts[i];
      setLocalUploadProgress({ done: i, total: riceProducts.length, current: product.name, errors });
      try {
        const res = await fetch(product.image_url!);
        if (!res.ok) throw new Error(`fetch failed ${res.status}`);
        const blob = await res.blob();
        const ext = product.image_url!.split('.').pop()?.toLowerCase() ?? 'jpeg';
        const filePath = `products/${product.id}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(filePath, blob, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(filePath);
        const bustedUrl = `${publicUrl}?v=${Date.now()}`;
        const { error: updateError } = await supabase.from('products').update({ image_url: bustedUrl }).eq('id', product.id);
        if (updateError) throw new Error(updateError.message);
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: bustedUrl } : p));
      } catch { errors++; }
    }
    setLocalUploadProgress({ done: riceProducts.length, total: riceProducts.length, current: '', errors });
    setLocalUploadDone(true);
    setUploadingLocalImages(false);
  };

  const openProductImageEditor = (product: Product) => {
    setEditingProduct(product);
    setProductImageUrl(product.image_url ?? '');
  };

  const handleProductImageUpload = async (file: File) => {
    if (!editingProduct) return;
    setUploadingProductImg(true);
    const ext = file.name.split('.').pop();
    const path = `products/${editingProduct.id}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: true });
    if (error) { alert('Upload failed: ' + error.message); setUploadingProductImg(false); return; }
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    // Re-uploading a photo for the same product reuses this exact path, so bust
    // the cache — otherwise the browser/CDN can keep serving the old photo at
    // this URL even though the file underneath it has actually changed.
    setProductImageUrl(`${data.publicUrl}?v=${Date.now()}`);
    setUploadingProductImg(false);
  };

  const saveProductImage = async () => {
    if (!editingProduct) return;
    setSavingProductImg(true);
    const url = productImageUrl.trim() || null;
    const { error } = await supabase.from('products').update({ image_url: url }).eq('id', editingProduct.id);
    if (!error) {
      setProducts(prev => prev.map(p => p.id === editingProduct.id ? { ...p, image_url: url } : p));
      setEditingProduct(null);
    }
    setSavingProductImg(false);
  };

  const ensureAbsoluteImageUrl = async (product: Product): Promise<string | null> => {
    const url = product.image_url;
    if (!url) return null;
    // Already an absolute URL — use as-is
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    // Relative URL (e.g. /images/...) — upload from browser to Supabase storage first
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const ext = url.split('.').pop()?.toLowerCase() ?? 'jpeg';
      const filePath = `products/${product.id}.${ext}`;
      const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(filePath, blob, { contentType, upsert: true });
      if (uploadError) return null;
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(filePath);
      const bustedUrl = `${publicUrl}?v=${Date.now()}`;
      // Update the product record to the new permanent URL
      await supabase.from('products').update({ image_url: bustedUrl }).eq('id', product.id);
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: bustedUrl } : p));
      return publicUrl;
    } catch {
      return null;
    }
  };

  const enhanceSingleProduct = async (product: Product, mode: 'enhance' | 'generate') => {
    if (!openaiKey.trim()) {
      setProductActionError({ id: product.id, msg: 'Enter your OpenAI key in the AI Generate panel first.' });
      setTimeout(() => setProductActionError(null), 4000);
      return;
    }
    setEnhancingProductId(product.id);
    setProductActionError(null);
    try {
      const categoryName = (product as any).category?.name ?? 'grocery';
      const section = isGroceryProduct(product) ? 'grocery' : 'clothing';
      const body: Record<string, unknown> = { productId: product.id, productName: product.name, categoryName, section };
      if (mode === 'enhance' && product.image_url) {
        const absoluteUrl = await ensureAbsoluteImageUrl(product);
        if (absoluteUrl) body.existingImageUrl = absoluteUrl;
      }
      const { data, error } = await supabase.functions.invoke('generate-product-image', {
        body,
        headers: { 'X-OpenAI-Key': openaiKey.trim() },
      });
      if (error || data?.success === false || !data?.imageUrl) {
        const msg = data?.error ?? error?.message ?? 'Generation failed';
        setProductActionError({ id: product.id, msg });
        setTimeout(() => setProductActionError(null), 5000);
      } else {
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, image_url: data.imageUrl } : p));
      }
    } catch (e: any) {
      setProductActionError({ id: product.id, msg: e?.message ?? 'Unknown error' });
      setTimeout(() => setProductActionError(null), 5000);
    }
    setEnhancingProductId(null);
  };

  const updateCategorySection = async (catId: string, section: Category['section']) => {
    setSavingCatId(catId);
    await supabase.from('categories').update({ section }).eq('id', catId);
    setAllCategories(prev => prev.map(c => c.id === catId ? { ...c, section } : c));
    setSavingCatId(null);
  };

  // --- Promo Slide CRUD ---
  const openNewSlide = () => {
    setSlideForm({ ...EMPTY_SLIDE });
    setUseImageMode(false);
    setSlideError('');
  };

  const openEditSlide = (slide: PromoSlide) => {
    setSlideForm({ ...slide });
    setUseImageMode(!!slide.image_url);
    setSlideError('');
  };

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `slides/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('promo-flyers').upload(path, file, { upsert: true });
    if (uploadError) {
      setSlideError('Image upload failed: ' + uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from('promo-flyers').getPublicUrl(path);
    setSlideForm(f => ({ ...f!, image_url: data.publicUrl }));
    setUploading(false);
  };

  const saveSlide = async () => {
    if (!slideForm) return;
    setSavingSlide(true); setSlideError('');
    const payload: any = {
      title: slideForm.title || null,
      subtitle: slideForm.subtitle || null,
      image_url: useImageMode ? (slideForm.image_url || null) : null,
      discount_label: slideForm.discount_label || null,
      cta_text: slideForm.cta_text || null,
      cta_link: slideForm.cta_link || null,
      active: slideForm.active ?? true,
      sort_order: slideForm.sort_order ?? 0,
      start_date: slideForm.start_date || null,
      end_date: slideForm.end_date || null,
    };
    if ((slideForm as any).id) {
      const { error } = await supabase.from('promo_slides').update(payload).eq('id', (slideForm as any).id);
      if (error) { setSlideError(error.message); }
      else {
        setSlides(prev => prev.map(s => s.id === (slideForm as any).id ? { ...s, ...payload } : s));
        setSlideForm(null);
      }
    } else {
      const { data, error } = await supabase.from('promo_slides').insert([payload]).select().maybeSingle();
      if (error) { setSlideError(error.message); }
      else if (data) { setSlides(prev => [...prev, data]); setSlideForm(null); }
    }
    setSavingSlide(false);
  };

  const deleteSlide = async (id: string) => {
    if (!window.confirm('Delete this promo slide?')) return;
    await supabase.from('promo_slides').delete().eq('id', id);
    setSlides(prev => prev.filter(s => s.id !== id));
  };

  const toggleSlideActive = async (slide: PromoSlide) => {
    await supabase.from('promo_slides').update({ active: !slide.active }).eq('id', slide.id);
    setSlides(prev => prev.map(s => s.id === slide.id ? { ...s, active: !s.active } : s));
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'orders', label: 'All Orders', icon: <Package className="h-4 w-4" /> },
    { id: 'stores', label: 'Stores', icon: <StoreIcon className="h-4 w-4" /> },
    { id: 'staff', label: 'Staff', icon: <Users className="h-4 w-4" /> },
    { id: 'catalog', label: 'Catalogue', icon: <RefreshCw className="h-4 w-4" /> },
    { id: 'categories', label: 'Categories', icon: <Tag className="h-4 w-4" /> },
    { id: 'products', label: 'Product Photos', icon: <Camera className="h-4 w-4" /> },
    { id: 'inventory', label: 'Inventory', icon: <Boxes className="h-4 w-4" /> },
    { id: 'pricing', label: 'Pricing & Promos', icon: <Tag className="h-4 w-4" /> },
    { id: 'promos', label: 'Banners', icon: <Megaphone className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold text-tpl-dark">Super Admin Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Manage the entire TPL Spices platform</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-2xl shadow-card p-1.5 mb-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap flex-1 justify-center ${tab === t.id ? 'bg-tpl-forest text-white shadow' : 'text-gray-500 hover:text-tpl-forest hover:bg-tpl-cream'}`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : (
          <>
            {/* ORDERS TAB */}
            {tab === 'orders' && (
              <div className="space-y-3">
                {orders.length === 0 && <div className="bg-white rounded-2xl shadow-card p-12 text-center"><p className="text-gray-500">No orders yet.</p></div>}
                {orders.map(order => (
                  <div key={order.id} className="bg-white rounded-2xl shadow-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <OrderStatusBadge status={order.status} />
                          <span className="text-xs text-gray-500 capitalize">{order.fulfillment_type.toLowerCase()}</span>
                        </div>
                        <p className="text-xs text-gray-400 font-mono">#{order.id.slice(0, 12)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{(order as any).store?.name ?? '—'} · {new Date(order.created_at).toLocaleDateString('en-AU')}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-tpl-forest">{formatPrice(order.total_cents)}</p>
                        <p className="text-xs text-gray-400">{(order.order_items ?? []).length} item(s)</p>
                      </div>
                    </div>
                    {(order.order_items ?? []).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                        {(order.order_items ?? []).map(item => (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span className="text-gray-600">{item.name_snapshot} <span className="text-gray-400">×{item.qty}</span></span>
                            <span className="text-gray-500">{formatPrice(item.unit_price_cents * item.qty)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* STORES TAB */}
            {tab === 'stores' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button
                    onClick={() => setStoreForm({ name: '', address: '', square_location_id: '', pickup_enabled: true, delivery_enabled: false, delivery_radius_km: 10, delivery_fee_cents: 0 } as any)}
                    className="flex items-center gap-2 px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors"
                  >
                    <Plus className="h-4 w-4" /> Add Store
                  </button>
                </div>

                {storeForm && (
                  <div className="bg-white rounded-2xl shadow-card p-6 border-2 border-tpl-lime/30">
                    <h3 className="font-semibold text-tpl-dark mb-4">{storeForm.id ? 'Edit Store' : 'New Store'}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      <input value={storeForm.name ?? ''} onChange={e => setStoreForm(f => ({ ...f!, name: e.target.value }))} placeholder="Store name" className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                      <input value={storeForm.address ?? ''} onChange={e => setStoreForm(f => ({ ...f!, address: e.target.value }))} placeholder="Address" className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                      <input value={storeForm.square_location_id ?? ''} onChange={e => setStoreForm(f => ({ ...f!, square_location_id: e.target.value }))} placeholder="Square Location ID" className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                      <input type="number" value={storeForm.delivery_radius_km ?? 10} onChange={e => setStoreForm(f => ({ ...f!, delivery_radius_km: parseFloat(e.target.value) }))} placeholder="Delivery radius (km)" className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                      <div>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={((storeForm.delivery_fee_cents ?? 0) / 100).toString()}
                          onChange={e => setStoreForm(f => ({ ...f!, delivery_fee_cents: Math.round((parseFloat(e.target.value) || 0) * 100) }))}
                          placeholder="Delivery fee ($)"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                        <p className="text-xs text-gray-400 mt-1">Charged as a line item on delivery orders. 0 = free delivery.</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={!!storeForm.pickup_enabled} onChange={e => setStoreForm(f => ({ ...f!, pickup_enabled: e.target.checked }))} className="rounded" />
                        Pickup enabled
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={!!storeForm.delivery_enabled} onChange={e => setStoreForm(f => ({ ...f!, delivery_enabled: e.target.checked }))} className="rounded" />
                        Delivery enabled
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={!!storeForm.is_payment_location} onChange={e => setStoreForm(f => ({ ...f!, is_payment_location: e.target.checked }))} className="rounded" />
                        Process all payments through this store's Square location
                      </label>
                      <p className="text-xs text-gray-400 -mt-2">Only one store can be checked — checking this one unchecks any other.</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveStore} disabled={savingStore} className="px-4 py-2 bg-tpl-forest text-white text-sm font-semibold rounded-lg hover:bg-tpl-mid transition-colors disabled:opacity-50">
                        {savingStore ? 'Saving…' : 'Save Store'}
                      </button>
                      <button onClick={() => setStoreForm(null)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}

                {stores.map(store => (
                  <div key={store.id} className="bg-white rounded-2xl shadow-card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-tpl-dark">{store.name}</h3>
                        <p className="text-sm text-gray-500 mt-0.5">{store.address}</p>
                        <p className="text-xs text-gray-400 font-mono mt-1">{store.square_location_id}</p>
                        <div className="flex gap-2 mt-2">
                          {store.pickup_enabled && <span className="text-xs bg-tpl-pale text-tpl-forest px-2 py-0.5 rounded-full font-medium">Pickup</span>}
                          {store.delivery_enabled && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                              Delivery ({store.delivery_radius_km}km · {store.delivery_fee_cents > 0 ? formatPrice(store.delivery_fee_cents) : 'free'})
                            </span>
                          )}
                          {store.is_payment_location && (
                            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">Processes all payments</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => setStoreForm(store)} className="p-2 text-gray-400 hover:text-tpl-forest hover:bg-tpl-cream rounded-lg transition-colors">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => deleteStore(store.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* STAFF TAB */}
            {tab === 'staff' && (
              <div className="space-y-3">
                <div className="bg-tpl-pale/60 border border-tpl-lime/30 rounded-xl p-4 text-sm text-tpl-forest">
                  Invite staff by having them create a customer account first, then change their role here.
                </div>
                {staff.map(member => (
                  <div key={member.id} className="bg-white rounded-2xl shadow-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-tpl-dark">{member.full_name || '(No name)'}</p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{member.id.slice(0, 12)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={member.role}
                          onChange={e => updateStaffRole(member.id, e.target.value, member.assigned_store_id)}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime bg-white"
                        >
                          <option value="customer">Customer</option>
                          <option value="staff">Staff</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                        <select
                          value={member.assigned_store_id ?? ''}
                          onChange={e => updateStaffRole(member.id, member.role, e.target.value || null)}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime bg-white"
                        >
                          <option value="">No store</option>
                          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                {staff.length === 0 && (
                  <div className="bg-white rounded-2xl shadow-card p-12 text-center">
                    <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No staff members yet.</p>
                  </div>
                )}
              </div>
            )}

            {/* CATALOG TAB */}
            {tab === 'catalog' && (
              <div className="bg-white rounded-2xl shadow-card p-8">
                <h2 className="font-semibold text-tpl-dark text-lg mb-2">Square Catalogue Sync</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Pull all products, categories, prices, and stock counts from your Square catalogue into Supabase.
                  Stock is synced from your primary store's Square location and mirrored to every store.
                  Use <strong>Test Connection</strong> first to confirm your token is working, then <strong>Sync</strong>.
                </p>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Environment</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setSquareEnv('production'); setTestResult(null); setSyncMessage(''); }}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${squareEnv === 'production' ? 'bg-tpl-forest text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        Production
                      </button>
                      <button
                        onClick={() => { setSquareEnv('sandbox'); setTestResult(null); setSyncMessage(''); }}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${squareEnv === 'sandbox' ? 'bg-tpl-forest text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        Sandbox
                      </button>
                    </div>
                    {squareEnv === 'sandbox' && (
                      <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Sandbox has a separate empty catalog. Your real 186 items are in Production — switch to Production and use your production access token.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                      Square {squareEnv === 'production' ? 'Production' : 'Sandbox'} Access Token (optional)
                    </label>
                    <input
                      type="password"
                      value={squareToken}
                      onChange={e => { setSquareToken(e.target.value); setTestResult(null); setSyncMessage(''); }}
                      placeholder={squareEnv === 'production' ? 'Leave blank to use the SQUARE_ACCESS_TOKEN secret already stored in Supabase' : 'EAAAl... (sandbox token)'}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Only needed if you haven't set the SQUARE_ACCESS_TOKEN secret on the sync-catalog edge function in Supabase. Otherwise leave blank — it will be used automatically.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={testConnection}
                    disabled={testLoading || syncLoading}
                    className="flex items-center gap-2 px-5 py-2.5 border-2 border-tpl-forest text-tpl-forest font-semibold rounded-xl hover:bg-tpl-pale transition-colors disabled:opacity-50 text-sm"
                  >
                    <CheckCircle className={`h-4 w-4 ${testLoading ? 'animate-pulse' : ''}`} />
                    {testLoading ? 'Testing…' : 'Test Connection'}
                  </button>
                  <button
                    onClick={syncCatalog}
                    disabled={syncLoading || testLoading}
                    className="flex items-center gap-2 px-6 py-2.5 bg-tpl-forest text-white font-semibold rounded-xl hover:bg-tpl-mid transition-colors disabled:opacity-50 text-sm"
                  >
                    <RefreshCw className={`h-4 w-4 ${syncLoading ? 'animate-spin' : ''}`} />
                    {syncLoading ? 'Syncing from Square…' : 'Sync Catalogue Now'}
                  </button>
                </div>

                {/* Test result */}
                {testResult && (
                  <div className={`mt-4 rounded-xl p-4 border ${testResult.error ? 'bg-red-50 border-red-200' : testResult.total === 0 ? 'bg-amber-50 border-amber-200' : 'bg-tpl-pale border-tpl-lime/30'}`}>
                    {testResult.error ? (
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-red-700">{testResult.error}</p>
                      </div>
                    ) : testResult.total === 0 ? (
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-amber-700">Connected, but 0 items found.</p>
                          <p className="text-xs text-amber-600 mt-1">
                            {squareEnv === 'sandbox'
                              ? 'Sandbox catalog is empty. Switch to Production and use your production access token.'
                              : 'Double-check you pasted the correct production token from the Square Developer Dashboard.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-tpl-forest mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-tpl-forest">Connected! Found {testResult.total} objects in Square.</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {Object.entries(testResult.byType ?? {}).map(([type, count]) => (
                              <span key={type} className="text-xs bg-white border border-tpl-lime/40 text-tpl-forest px-2 py-0.5 rounded-full font-medium">
                                {type}: {count as number}
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-tpl-forest/70 mt-2">Click <strong>Sync Catalogue Now</strong> to import into Supabase.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Sync result */}
                {syncMessage && (
                  <div className={`mt-4 flex items-start gap-2 rounded-xl p-4 ${syncMessage.startsWith('Error') ? 'bg-red-50 border border-red-200' : 'bg-tpl-pale border border-tpl-lime/30'}`}>
                    {syncMessage.startsWith('Error') ? <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" /> : <CheckCircle className="h-4 w-4 text-tpl-forest mt-0.5 flex-shrink-0" />}
                    <p className={`text-sm ${syncMessage.startsWith('Error') ? 'text-red-700' : 'text-tpl-forest'}`}>{syncMessage}</p>
                  </div>
                )}
              </div>
            )}

            {/* PRODUCTS TAB */}
            {tab === 'products' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl shadow-card p-6">
                  <h2 className="font-semibold text-tpl-dark text-lg mb-1">Product Photos</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Upload or set a photo for each product. Clothing items are managed separately — only grocery products are auto-filled.
                  </p>

                  {/* Upload Local Rice Photos to Storage */}
                  {products.some(p => p.image_url?.startsWith('/images/')) && (
                    <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-blue-900 text-sm">Upload Rice Photos to Storage</p>
                          <p className="text-xs text-blue-700 mt-0.5">
                            {products.filter(p => p.image_url?.startsWith('/images/')).length} local rice photos are ready to be permanently uploaded to Supabase Storage.
                          </p>
                        </div>
                        {!uploadingLocalImages && !localUploadDone && (
                          <button
                            onClick={uploadLocalRiceImages}
                            className="shrink-0 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Upload All
                          </button>
                        )}
                      </div>
                      {uploadingLocalImages && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
                            <span className="truncate max-w-xs">Uploading: <strong>{localUploadProgress.current}</strong></span>
                            <span className="shrink-0 ml-2">{localUploadProgress.done} / {localUploadProgress.total}</span>
                          </div>
                          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-300"
                              style={{ width: `${localUploadProgress.total ? (localUploadProgress.done / localUploadProgress.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {localUploadDone && (
                        <p className="text-xs text-blue-800 font-semibold mt-2">
                          Done! {localUploadProgress.total - localUploadProgress.errors} photos uploaded to storage.
                          {localUploadProgress.errors > 0 && <span className="text-red-600 ml-1">{localUploadProgress.errors} failed.</span>}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Auto-fill with Open Food Facts */}
                  <div className="mb-5 p-4 bg-tpl-pale/30 border border-tpl-lime/30 rounded-xl">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="font-semibold text-tpl-dark text-sm">Auto-fill Grocery Photos</p>
                        <p className="text-xs text-gray-500">
                          Searches Open Food Facts — a real grocery product photo database. No API key needed.
                          Clothing items are skipped.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowAutoFill(v => !v)}
                        className="text-xs px-3 py-1.5 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors shrink-0 ml-3"
                      >
                        {showAutoFill ? 'Hide' : 'Start'}
                      </button>
                    </div>
                    {showAutoFill && (
                      <div className="mt-3 space-y-3">
                        {autoFilling ? (
                          <div>
                            <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                              <span className="truncate max-w-xs">Searching: <strong>{autoFillProgress.current}</strong></span>
                              <span className="shrink-0 ml-2">{autoFillProgress.done} / {autoFillProgress.total} &nbsp;·&nbsp; {autoFillProgress.found} matched</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-tpl-lime rounded-full transition-all duration-300"
                                style={{ width: `${autoFillProgress.total ? (autoFillProgress.done / autoFillProgress.total) * 100 : 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Searching Open Food Facts product database — no API key needed…</p>
                          </div>
                        ) : autoFillProgress.done > 0 && autoFillProgress.done === autoFillProgress.total ? (
                          <div className="text-sm">
                            <p className="text-tpl-forest font-semibold">Done! Found real product photos for {autoFillProgress.found} of {autoFillProgress.total} grocery products.</p>
                            {autoFillProgress.found < autoFillProgress.total && (
                              <p className="text-xs text-gray-500 mt-1">
                                {autoFillProgress.total - autoFillProgress.found} products weren't found in the database (mainly local Sri Lankan brands). Upload those manually by clicking each product tile below.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500">
                              Uses a <strong>3-level search</strong> per product to guarantee a match:
                              full brand+name → product type only → category fallback.
                              Every grocery product will receive a relevant food photo.
                              Clothing items are never touched.
                            </p>
                            {products.filter(p => !p.image_url && isGroceryProduct(p)).length > 0 ? (
                              <button
                                onClick={runAutoFill}
                                className="w-full py-2.5 bg-tpl-lime text-tpl-dark text-sm font-semibold rounded-lg hover:bg-tpl-light transition-colors"
                              >
                                Fill {products.filter(p => !p.image_url && isGroceryProduct(p)).length} remaining grocery photos
                              </button>
                            ) : (
                              <p className="text-sm text-tpl-forest font-semibold text-center py-2">All grocery products have photos!</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* AI Photo Studio */}
                  <div className="mb-5 p-4 bg-gradient-to-br from-slate-50 to-gray-50 border border-gray-200 rounded-xl">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="font-semibold text-tpl-dark text-sm flex items-center gap-2">
                          <span className="text-base">✦</span> AI Photo Studio
                        </p>
                        <p className="text-xs text-gray-500">
                          Uses ChatGPT DALL-E 3 to generate professional retail photos.
                          Grocery items get clean packaging shots. Clothing items get model photos wearing the garment.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowAiPanel(v => !v)}
                        className="text-xs px-3 py-1.5 bg-tpl-dark text-white rounded-lg font-medium hover:bg-gray-800 transition-colors shrink-0 ml-3"
                      >
                        {showAiPanel ? 'Hide' : 'Set Up'}
                      </button>
                    </div>

                    {showAiPanel && (
                      <div className="mt-4 space-y-4">
                        {/* API Key */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            OpenAI API Key
                            <span className="ml-2 font-normal text-gray-400">(stored locally, never saved to server)</span>
                          </label>
                          <input
                            type="password"
                            value={openaiKey}
                            onChange={e => setOpenaiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            Get your key at platform.openai.com → API Keys. Each image costs ~$0.04 (DALL-E 3 standard).
                          </p>
                        </div>

                        {/* Section selector */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-2">Generate for</label>
                          <div className="flex gap-2">
                            {(['grocery', 'clothing', 'all'] as const).map(s => (
                              <button
                                key={s}
                                onClick={() => setAiSection(s)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                                  aiSection === s
                                    ? 'bg-tpl-dark text-white'
                                    : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
                                }`}
                              >
                                {s === 'all' ? 'All products' : `${s.charAt(0).toUpperCase() + s.slice(1)} only`}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Overwrite toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <div
                            onClick={() => setAiOverwrite(v => !v)}
                            className={`relative w-9 h-5 rounded-full transition-colors ${aiOverwrite ? 'bg-tpl-dark' : 'bg-gray-200'}`}
                          >
                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiOverwrite ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </div>
                          <span className="text-xs text-gray-600">Regenerate products that already have photos</span>
                        </label>

                        {/* Cost + time estimate */}
                        {(() => {
                          const count = aiProductTargets().length;
                          const cost = (count * 0.04).toFixed(2);
                          const mins = Math.ceil((count * 13) / 60);
                          return count > 0 ? (
                            <div className="flex gap-4 text-xs text-gray-500 bg-white rounded-lg p-3 border border-gray-100">
                              <span><strong className="text-tpl-dark">{count}</strong> products</span>
                              <span><strong className="text-tpl-dark">~${cost}</strong> estimated cost</span>
                              <span><strong className="text-tpl-dark">~{mins} min</strong> to complete</span>
                            </div>
                          ) : null;
                        })()}

                        {/* Progress / button */}
                        {aiGenerating ? (
                          <div>
                            <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
                              <span className="truncate max-w-xs">Generating: <strong>{aiProgress.current}</strong></span>
                              <span className="shrink-0 ml-2">
                                {aiProgress.done} / {aiProgress.total}
                                {aiProgress.errors > 0 && <span className="text-red-500 ml-2">{aiProgress.errors} errors</span>}
                              </span>
                            </div>
                            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-gray-700 to-gray-900 rounded-full transition-all duration-500"
                                style={{ width: `${aiProgress.total ? (aiProgress.done / aiProgress.total) * 100 : 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-1.5">
                              Keep this tab open. DALL-E processes 1 image every 13 seconds.
                              {aiProgress.total - aiProgress.done > 0 && (
                                <> ~{Math.ceil(((aiProgress.total - aiProgress.done) * 13) / 60)} min remaining.</>
                              )}
                            </p>
                          </div>
                        ) : aiProgress.done > 0 && aiProgress.done === aiProgress.total ? (
                          <div className="bg-white rounded-lg p-3 border border-gray-100">
                            <p className="text-sm font-semibold text-tpl-dark">
                              Done! Generated {aiProgress.total - aiProgress.errors} of {aiProgress.total} photos.
                            </p>
                            {aiProgress.errors > 0 && (
                              <p className="text-xs text-red-500 mt-1">
                                {aiProgress.errors} failed — check your API key balance and try again.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Test result */}
                            {aiTestResult && (
                              <div className={`rounded-lg p-3 border text-sm ${aiTestResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                {aiTestResult.ok ? (
                                  <div>
                                    <p className="font-semibold text-green-800 mb-2">Test passed for: {aiTestResult.product}</p>
                                    <img src={aiTestResult.imageUrl} alt="test" className="w-32 h-32 object-cover rounded-lg border" />
                                    <p className="text-xs text-green-700 mt-2">Image saved to the product. Ready to generate all.</p>
                                  </div>
                                ) : (
                                  <div>
                                    <p className="font-semibold text-red-800 mb-1">Error for: {aiTestResult.product}</p>
                                    <pre className="text-xs text-red-700 whitespace-pre-wrap break-all bg-red-100 rounded p-2 max-h-32 overflow-y-auto">{aiTestResult.error}</pre>
                                    <p className="text-xs text-red-600 mt-2">Common causes: wrong API key, insufficient credits, or content policy rejection. Check the error above.</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Test button */}
                            <button
                              onClick={runTestGeneration}
                              disabled={!openaiKey.trim() || aiTesting}
                              className="w-full py-2 border-2 border-tpl-dark text-tpl-dark text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                              {aiTesting ? (
                                <>
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                  </svg>
                                  Generating test image…
                                </>
                              ) : 'Test with 1 grocery product first'}
                            </button>

                            {/* Full generate button */}
                            <button
                              onClick={runAiGeneration}
                              disabled={!openaiKey.trim() || aiProductTargets().length === 0 || aiTesting}
                              className="w-full py-2.5 bg-tpl-dark text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40"
                            >
                              Generate all {aiProductTargets().length} AI photos with DALL-E 3
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* AI Photo Enhance */}
                  <div className="mb-5 p-4 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="font-semibold text-tpl-dark text-sm flex items-center gap-2">
                          <span className="text-base">✦</span> Enhance Existing Photos
                          {(() => {
                            const pending = products.filter(p => isRealUploadedPhoto(p.image_url) && !isAiEnhanced(p.image_url)).length;
                            return pending > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-600 text-white">{pending} pending</span>
                            ) : null;
                          })()}
                        </p>
                        <p className="text-xs text-gray-500">
                          Uses ChatGPT to upgrade photos already on products — white background, studio lighting, catalog quality. Works on your real uploaded photos.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowEnhancePanel(v => !v)}
                        className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors shrink-0 ml-3"
                      >
                        {showEnhancePanel ? 'Hide' : 'Set Up'}
                      </button>
                    </div>

                    {showEnhancePanel && (
                      <div className="mt-4 space-y-4">
                        {/* API Key (shared with generator) */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            OpenAI API Key
                            <span className="ml-2 font-normal text-gray-400">(stored locally, never saved to server)</span>
                          </label>
                          <input
                            type="password"
                            value={openaiKey}
                            onChange={e => setOpenaiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                        </div>

                        {/* Section selector */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-2">Enhance photos for</label>
                          <div className="flex gap-2">
                            {(['grocery', 'clothing', 'all'] as const).map(s => (
                              <button
                                key={s}
                                onClick={() => setEnhanceSection(s)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                                  enhanceSection === s
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-white border border-gray-200 text-gray-600 hover:border-amber-400'
                                }`}
                              >
                                {s === 'all' ? 'All products' : `${s.charAt(0).toUpperCase() + s.slice(1)} only`}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Count */}
                        {(() => {
                          const count = aiEnhanceTargets().length;
                          const mins = Math.ceil((count * 13) / 60);
                          return count > 0 ? (
                            <div className="flex gap-4 text-xs text-gray-500 bg-white rounded-lg p-3 border border-amber-100">
                              <span><strong className="text-tpl-dark">{count}</strong> products with photos</span>
                              <span><strong className="text-tpl-dark">~{mins} min</strong> to complete</span>
                            </div>
                          ) : (
                            <p className="text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2">No products with photos found for this section.</p>
                          );
                        })()}

                        {/* Progress / buttons */}
                        {enhancing ? (
                          <div>
                            <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
                              <span className="truncate max-w-xs">Enhancing: <strong>{enhanceProgress.current}</strong></span>
                              <span className="shrink-0 ml-2">
                                {enhanceProgress.done} / {enhanceProgress.total}
                                {enhanceProgress.errors > 0 && <span className="text-red-500 ml-2">{enhanceProgress.errors} errors</span>}
                              </span>
                            </div>
                            <div className="h-2.5 bg-amber-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                                style={{ width: `${enhanceProgress.total ? (enhanceProgress.done / enhanceProgress.total) * 100 : 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-1.5">
                              Keep this tab open.
                              {enhanceProgress.total - enhanceProgress.done > 0 && (
                                <> ~{Math.ceil(((enhanceProgress.total - enhanceProgress.done) * 13) / 60)} min remaining.</>
                              )}
                            </p>
                          </div>
                        ) : enhanceProgress.done > 0 && enhanceProgress.done === enhanceProgress.total ? (
                          <div className="bg-white rounded-lg p-3 border border-amber-100">
                            <p className="text-sm font-semibold text-tpl-dark">
                              Done! Enhanced {enhanceProgress.total - enhanceProgress.errors} of {enhanceProgress.total} photos.
                            </p>
                            {enhanceProgress.errors > 0 && (
                              <p className="text-xs text-red-500 mt-1">{enhanceProgress.errors} failed — check your API key and try again.</p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Test result */}
                            {enhanceTestResult && (
                              <div className={`rounded-lg p-3 border text-sm ${enhanceTestResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                {enhanceTestResult.ok ? (
                                  <div>
                                    <p className="font-semibold text-green-800 mb-2">Enhanced: {enhanceTestResult.product}</p>
                                    <img src={enhanceTestResult.imageUrl} alt="enhanced" className="w-32 h-32 object-cover rounded-lg border" />
                                    <p className="text-xs text-green-700 mt-2">Enhanced image saved. Ready to run on all photos.</p>
                                  </div>
                                ) : (
                                  <div>
                                    <p className="font-semibold text-red-800 mb-1">Error for: {enhanceTestResult.product}</p>
                                    <pre className="text-xs text-red-700 whitespace-pre-wrap break-all bg-red-100 rounded p-2 max-h-32 overflow-y-auto">{enhanceTestResult.error}</pre>
                                  </div>
                                )}
                              </div>
                            )}
                            <button
                              onClick={runTestEnhancement}
                              disabled={!openaiKey.trim() || enhanceTesting}
                              className="w-full py-2 border-2 border-amber-600 text-amber-700 text-sm font-semibold rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                              {enhanceTesting ? (
                                <>
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                  </svg>
                                  Enhancing test photo…
                                </>
                              ) : 'Test enhance 1 grocery photo first'}
                            </button>
                            <button
                              onClick={runAiEnhancement}
                              disabled={!openaiKey.trim() || aiEnhanceTargets().length === 0 || enhanceTesting}
                              className="w-full py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-40"
                            >
                              Enhance all {aiEnhanceTargets().length} existing photos
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Search */}
                  <div className="relative mb-4">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Search products…"
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                    />
                    {productSearch && (
                      <button onClick={() => setProductSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex flex-wrap gap-4 mb-4 text-sm">
                    <span className="text-gray-500">{products.filter(isGroceryProduct).length} grocery products</span>
                    <span className="text-tpl-forest font-medium">{products.filter(p => p.image_url && isGroceryProduct(p)).length} with photos</span>
                    <span className="text-amber-600">{products.filter(p => !p.image_url && isGroceryProduct(p)).length} missing photos</span>
                  </div>

                  {/* Product grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {products
                      .filter(p => isGroceryProduct(p))
                      .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                      .map(product => (
                      <div
                        key={product.id}
                        className="group rounded-xl overflow-hidden border-2 border-transparent hover:border-tpl-lime transition-all"
                      >
                        <div
                          className="aspect-square relative bg-tpl-cream cursor-pointer"
                          onClick={() => openProductImageEditor(product)}
                        >
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-tpl-pale to-tpl-cream">
                              <Camera className="h-8 w-8 text-tpl-mid/30" />
                            </div>
                          )}
                          {enhancingProductId === product.id ? (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                              <Loader2 className="h-6 w-6 text-white animate-spin" />
                              <span className="text-white text-xs font-medium">Working…</span>
                            </div>
                          ) : (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <div className="bg-white rounded-lg px-2 py-1 text-xs font-semibold text-tpl-forest flex items-center gap-1">
                                <Camera className="h-3 w-3" /> Edit
                              </div>
                            </div>
                          )}
                          {product.image_url && enhancingProductId !== product.id && (
                            <span className="absolute top-1 right-1 w-2 h-2 bg-tpl-lime rounded-full" />
                          )}
                        </div>
                        <div className="p-2 bg-white">
                          <p className="text-xs font-medium text-tpl-dark line-clamp-2 leading-snug">{product.name}</p>
                          {(product as any).category && (
                            <p className="text-xs text-gray-400 mt-0.5">{(product as any).category.name}</p>
                          )}
                          {productActionError?.id === product.id && (
                            <p className="text-xs text-red-500 mt-1 line-clamp-2">{productActionError.msg}</p>
                          )}
                          <div className="mt-1.5 flex gap-1">
                            {product.image_url && isAiEnhanced(product.image_url) ? (
                              <div className="flex-1 flex flex-col gap-1">
                                <div className="flex items-center justify-center gap-1 px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-lg border border-green-200 cursor-default">
                                  <CheckCircle className="h-3 w-3" />
                                  AI Enhanced
                                </div>
                                <button
                                  onClick={() => resetAiImage(product)}
                                  title="Reset to original uploaded photo so it can be re-enhanced"
                                  className="flex items-center justify-center gap-1 px-2 py-1 bg-white border border-gray-200 text-gray-500 text-xs rounded-lg hover:border-red-300 hover:text-red-500 transition-colors"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Reset & Re-enhance
                                </button>
                              </div>
                            ) : product.image_url && isRealUploadedPhoto(product.image_url) ? (
                              <button
                                onClick={() => enhanceSingleProduct(product, 'enhance')}
                                disabled={enhancingProductId === product.id}
                                title="Enhance photo with AI"
                                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-tpl-forest text-white text-xs font-semibold rounded-lg hover:bg-tpl-mid transition-colors disabled:opacity-40"
                              >
                                <Wand2 className="h-3 w-3" />
                                {enhancingProductId === product.id ? 'Working…' : 'Enhance'}
                              </button>
                            ) : (
                              <button
                                onClick={() => enhanceSingleProduct(product, 'generate')}
                                disabled={enhancingProductId === product.id}
                                title="Generate with AI"
                                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-tpl-forest text-white text-xs font-semibold rounded-lg hover:bg-tpl-mid transition-colors disabled:opacity-40"
                              >
                                <Wand2 className="h-3 w-3" />
                                {product.image_url ? 'Re-enhance' : 'Generate'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Image edit modal */}
                {editingProduct && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingProduct(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-tpl-dark">Set Product Photo</h3>
                        <button onClick={() => setEditingProduct(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="text-sm font-medium text-tpl-forest mb-4 line-clamp-2">{editingProduct.name}</p>

                      {/* Preview */}
                      <div className="aspect-square rounded-xl overflow-hidden bg-tpl-cream mb-4 max-h-48">
                        {productImageUrl ? (
                          <img src={productImageUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                            <Camera className="h-10 w-10 text-gray-300" />
                            <p className="text-xs text-gray-400">No photo yet</p>
                          </div>
                        )}
                      </div>

                      {/* Upload button */}
                      <button
                        onClick={() => productImgRef.current?.click()}
                        disabled={uploadingProductImg}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-600 hover:border-tpl-lime hover:text-tpl-forest transition-colors mb-3"
                      >
                        <Upload className={`h-4 w-4 ${uploadingProductImg ? 'animate-bounce' : ''}`} />
                        {uploadingProductImg ? 'Uploading…' : 'Upload from device'}
                      </button>
                      <input
                        ref={productImgRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleProductImageUpload(f); }}
                      />

                      {/* OR URL input */}
                      <div className="mb-4">
                        <label className="block text-xs font-medium text-gray-500 mb-1.5">Or paste an image URL</label>
                        <input
                          type="url"
                          value={productImageUrl}
                          onChange={e => setProductImageUrl(e.target.value)}
                          placeholder="https://..."
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={saveProductImage}
                          disabled={savingProductImg || uploadingProductImg}
                          className="flex-1 px-4 py-2.5 bg-tpl-forest text-white text-sm font-semibold rounded-xl hover:bg-tpl-mid transition-colors disabled:opacity-50"
                        >
                          {savingProductImg ? 'Saving…' : 'Save Photo'}
                        </button>
                        {editingProduct.image_url && (
                          <button
                            onClick={() => { setProductImageUrl(''); }}
                            className="px-4 py-2.5 border border-red-200 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-50 transition-colors"
                          >
                            Remove
                          </button>
                        )}
                        <button onClick={() => setEditingProduct(null)} className="px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CATEGORIES TAB */}
            {tab === 'categories' && (
              <div className="space-y-3">
                <div className="bg-white rounded-2xl shadow-card p-6">
                  <h2 className="font-semibold text-tpl-dark text-lg mb-1">Category Sections</h2>
                  <p className="text-sm text-gray-500 mb-6">
                    Assign each category to a section — Grocery, Kitchen, Pooja, or Clothing. This controls which nav tab it appears under.
                  </p>
                  {allCategories.length === 0 ? (
                    <div className="text-center py-10">
                      <Tag className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 text-sm">No categories yet — sync your Square catalogue first.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {allCategories.map(cat => (
                        <div key={cat.id} className="flex items-center justify-between py-3 gap-4">
                          <div>
                            <p className="font-medium text-tpl-dark text-sm">{cat.name}</p>
                            {cat.is_brand && <span className="text-xs text-gray-400">Brand</span>}
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            {CATEGORY_SECTIONS.map(s => (
                              <button
                                key={s.id}
                                onClick={() => updateCategorySection(cat.id, s.id)}
                                disabled={savingCatId === cat.id}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  cat.section === s.id
                                    ? 'bg-tpl-forest text-white'
                                    : 'border border-gray-200 text-gray-500 hover:border-tpl-forest hover:text-tpl-forest'
                                }`}
                              >
                                <s.icon className="h-3.5 w-3.5" /> {s.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PRICING & PROMOTIONS TAB */}
            {tab === 'pricing' && <PricingPromotionsPanel />}

            {/* INVENTORY TAB */}
            {tab === 'inventory' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl shadow-card p-6">
                  <h2 className="font-semibold text-tpl-dark text-lg mb-1">Stock by Store</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Set a quantity to start tracking stock for a variation at this store — it'll show as limited/out of stock on the storefront and be checked at checkout.
                    Untracked variations stay shown as always available, same as today. Open the <HistoryIcon className="inline h-3.5 w-3.5 align-text-bottom" /> icon on any variation to add received stock with a date, and see availability, aging (how old the stock is), and the full change history.
                  </p>
                  <div className="flex flex-wrap gap-3 items-center">
                    <select
                      value={invStoreId}
                      onChange={e => setInvStoreId(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime bg-white"
                    >
                      {stores.length === 0 && <option value="">No stores yet</option>}
                      {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div className="relative flex-1 min-w-[200px]">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        value={invSearch}
                        onChange={e => setInvSearch(e.target.value)}
                        placeholder="Search products…"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                      />
                    </div>
                  </div>
                </div>

                {!invStoreId ? (
                  <div className="bg-white rounded-2xl shadow-card p-12 text-center">
                    <Boxes className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Add a store first, then come back to set stock levels.</p>
                  </div>
                ) : invLoading ? (
                  <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
                ) : (
                  <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                    <div className="divide-y divide-gray-100">
                      {invProducts
                        .filter(p => !invSearch || p.name.toLowerCase().includes(invSearch.toLowerCase()))
                        .map(product => (
                          <div key={product.id} className="p-4">
                            <p className="text-sm font-semibold text-tpl-dark mb-2">{product.name}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {(product.variations ?? []).map(v => {
                                const tracked = Object.prototype.hasOwnProperty.call(invRows, v.id);
                                const currentQty = invRows[v.id];
                                const draft = invDrafts[v.id];
                                const saving = invSavingId === v.id;
                                return (
                                  <div key={v.id} className="flex items-center gap-2 bg-tpl-cream rounded-xl px-3 py-2">
                                    <span className="text-xs text-gray-600 flex-1 truncate">{v.name}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={draft !== undefined ? draft : (tracked ? String(currentQty) : '')}
                                      onChange={e => setInvDrafts(prev => ({ ...prev, [v.id]: e.target.value }))}
                                      placeholder="∞"
                                      className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                                    />
                                    <button
                                      onClick={() => saveInventoryQty(v.id, draft !== undefined ? draft : String(currentQty ?? 0))}
                                      disabled={saving || draft === undefined}
                                      title="Save quantity"
                                      className="text-xs px-2 py-1 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-30"
                                    >
                                      {saving ? '…' : 'Save'}
                                    </button>
                                    <button
                                      onClick={() => setInvPanelVar(prev => (prev === v.id ? null : v.id))}
                                      title="Stock history & aging"
                                      className={`text-xs px-2 py-1 rounded-lg transition-colors ${invPanelVar === v.id ? 'text-tpl-forest' : 'text-gray-400 hover:text-tpl-forest'}`}
                                    >
                                      <HistoryIcon className="h-3.5 w-3.5" />
                                    </button>
                                    {tracked && (
                                      <button
                                        onClick={() => untrackInventory(v.id)}
                                        disabled={saving}
                                        title="Stop tracking — treat as always available"
                                        className="text-xs px-2 py-1 text-gray-400 hover:text-red-500 transition-colors"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                              {(product.variations ?? []).length === 0 && (
                                <span className="text-xs text-gray-400 italic">No variations</span>
                              )}
                            </div>
                            {(() => {
                              const openV = (product.variations ?? []).find(v => v.id === invPanelVar);
                              if (!openV) return null;
                              const moves = invMoves[openV.id] ?? [];
                              const ag = computeAging(moves);
                              const available = invRows[openV.id] ?? ag.available;
                              const saving = invSavingId === openV.id;
                              return (
                                <div className="mt-3 border border-tpl-forest/20 rounded-xl bg-white p-4 space-y-4">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-tpl-dark">{openV.name} — stock details</p>
                                    <button onClick={() => setInvPanelVar(null)} className="text-gray-400 hover:text-gray-600">
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>

                                  {/* Aging summary */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="rounded-xl bg-tpl-cream px-3 py-2">
                                      <p className="text-[11px] uppercase tracking-wide text-gray-500">Available</p>
                                      <p className="text-lg font-bold text-tpl-dark">{available}</p>
                                    </div>
                                    <div className="rounded-xl bg-green-50 px-3 py-2">
                                      <p className="text-[11px] uppercase tracking-wide text-green-700">New · under 1 mo</p>
                                      <p className="text-lg font-bold text-green-700">{ag.fresh}</p>
                                    </div>
                                    <div className="rounded-xl bg-amber-50 px-3 py-2">
                                      <p className="text-[11px] uppercase tracking-wide text-amber-700">1–3 months</p>
                                      <p className="text-lg font-bold text-amber-700">{ag.mid}</p>
                                    </div>
                                    <div className="rounded-xl bg-red-50 px-3 py-2">
                                      <p className="text-[11px] uppercase tracking-wide text-red-700">Over 3 months</p>
                                      <p className="text-lg font-bold text-red-700">{ag.old}</p>
                                    </div>
                                  </div>

                                  {/* Add received stock */}
                                  <div className="rounded-xl border border-gray-100 p-3">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold text-tpl-dark mb-2">
                                      <PackagePlus className="h-4 w-4 text-tpl-forest" /> Add received stock
                                    </p>
                                    <div className="flex flex-wrap items-end gap-2">
                                      <label className="text-[11px] text-gray-500">
                                        Quantity
                                        <input type="number" min={1} value={addQty} onChange={e => setAddQty(e.target.value)}
                                          placeholder="0" className="block w-24 mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                                      </label>
                                      <label className="text-[11px] text-gray-500">
                                        Received on
                                        <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)}
                                          className="block mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                                      </label>
                                      <label className="text-[11px] text-gray-500 flex-1 min-w-[140px]">
                                        Note (optional)
                                        <input value={addNote} onChange={e => setAddNote(e.target.value)}
                                          placeholder="Supplier, batch #…" className="block w-full mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                                      </label>
                                      <button onClick={() => addStock(openV.id)} disabled={saving}
                                        className="text-xs px-3 py-1.5 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-40">
                                        {saving ? '…' : 'Add stock'}
                                      </button>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-1.5">Leave the date blank to use today. Received date is what the aging report above is based on.</p>
                                  </div>

                                  {/* History */}
                                  <div>
                                    <p className="flex items-center gap-1.5 text-xs font-semibold text-tpl-dark mb-2">
                                      <Clock className="h-4 w-4 text-tpl-forest" /> History
                                    </p>
                                    {moves.length === 0 ? (
                                      <p className="text-xs text-gray-400 italic">No stock changes recorded yet.</p>
                                    ) : (
                                      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                                        {moves.map(m => (
                                          <div key={m.id} className="flex items-center gap-3 py-1.5 text-xs">
                                            <span className={`font-bold w-12 text-right ${m.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                              {m.delta > 0 ? `+${m.delta}` : m.delta}
                                            </span>
                                            <span className="flex-1">
                                              <span className="font-medium text-tpl-dark">{REASON_LABEL[m.reason] ?? m.reason}</span>
                                              {m.received_at && (
                                                <span className="text-gray-400"> · received {new Date(m.received_at).toLocaleDateString()}</span>
                                              )}
                                              {m.note && <span className="text-gray-400"> · {m.note}</span>}
                                            </span>
                                            <span className="text-gray-400 whitespace-nowrap">
                                              {new Date(m.created_at).toLocaleDateString()}
                                              {m.creator?.full_name ? ` · ${m.creator.full_name}` : ''}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      {invProducts.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-10">No products found.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PROMOTIONS TAB */}
            {tab === 'promos' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-tpl-dark">Promotional Slides</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Manage homepage carousel slides</p>
                  </div>
                  <button
                    onClick={openNewSlide}
                    className="flex items-center gap-2 px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors"
                  >
                    <Plus className="h-4 w-4" /> Add Slide
                  </button>
                </div>

                {/* Slide Form */}
                {slideForm && (
                  <div className="bg-white rounded-2xl shadow-card p-6 border-2 border-tpl-lime/30">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-semibold text-tpl-dark">
                        {(slideForm as any).id ? 'Edit Slide' : 'New Slide'}
                      </h3>
                      <button onClick={() => setSlideForm(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Mode toggle */}
                    <div className="flex gap-2 mb-5">
                      <button
                        onClick={() => setUseImageMode(false)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${!useImageMode ? 'bg-tpl-forest text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        <Type className="h-4 w-4" /> Text Slide
                      </button>
                      <button
                        onClick={() => setUseImageMode(true)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${useImageMode ? 'bg-tpl-forest text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        <ImageIcon className="h-4 w-4" /> Flyer / Image
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Image upload */}
                      {useImageMode && (
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">Flyer Image</label>
                          <div
                            className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-tpl-lime transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {slideForm.image_url ? (
                              <div className="relative inline-block">
                                <img src={slideForm.image_url} alt="Preview" className="h-32 rounded-lg object-cover mx-auto" />
                                <button
                                  onClick={e => { e.stopPropagation(); setSlideForm(f => ({ ...f!, image_url: null })); }}
                                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="py-4">
                                <Upload className={`h-8 w-8 mx-auto mb-2 ${uploading ? 'text-tpl-lime animate-pulse' : 'text-gray-300'}`} />
                                <p className="text-sm text-gray-500">{uploading ? 'Uploading…' : 'Click to upload flyer image'}</p>
                                <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP — max 5MB</p>
                              </div>
                            )}
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }}
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Title</label>
                        <input
                          value={slideForm.title ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, title: e.target.value }))}
                          placeholder="Slide headline"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Subtitle</label>
                        <input
                          value={slideForm.subtitle ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, subtitle: e.target.value }))}
                          placeholder="Supporting text"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Discount Label</label>
                        <input
                          value={slideForm.discount_label ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, discount_label: e.target.value }))}
                          placeholder="e.g. 20% OFF"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Sort Order</label>
                        <input
                          type="number"
                          value={slideForm.sort_order ?? 0}
                          onChange={e => setSlideForm(f => ({ ...f!, sort_order: parseInt(e.target.value) }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">CTA Button Text</label>
                        <input
                          value={slideForm.cta_text ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, cta_text: e.target.value }))}
                          placeholder="Shop Now"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">CTA Link</label>
                        <input
                          value={slideForm.cta_link ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, cta_link: e.target.value }))}
                          placeholder="/"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Start Date</label>
                        <input
                          type="date"
                          value={slideForm.start_date ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, start_date: e.target.value || null }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">End Date</label>
                        <input
                          type="date"
                          value={slideForm.end_date ?? ''}
                          onChange={e => setSlideForm(f => ({ ...f!, end_date: e.target.value || null }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={slideForm.active ?? true}
                            onChange={e => setSlideForm(f => ({ ...f!, active: e.target.checked }))}
                            className="rounded accent-tpl-lime w-4 h-4"
                          />
                          <span className="text-sm text-gray-700">Active (visible on storefront)</span>
                        </label>
                      </div>
                    </div>

                    {slideError && (
                      <div className="mt-3 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {slideError}
                      </div>
                    )}

                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={saveSlide}
                        disabled={savingSlide || uploading}
                        className="px-5 py-2 bg-tpl-forest text-white text-sm font-semibold rounded-xl hover:bg-tpl-mid transition-colors disabled:opacity-50"
                      >
                        {savingSlide ? 'Saving…' : 'Save Slide'}
                      </button>
                      <button
                        onClick={() => setSlideForm(null)}
                        className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Slides List */}
                {slides.length === 0 && !slideForm && (
                  <div className="bg-white rounded-2xl shadow-card p-12 text-center">
                    <Megaphone className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No slides yet. Add your first promotional slide.</p>
                  </div>
                )}

                {slides.map((slide, idx) => (
                  <div key={slide.id} className="bg-white rounded-2xl shadow-card p-5">
                    <div className="flex items-start gap-4">
                      {/* Thumb */}
                      <div className="flex-shrink-0 w-20 h-14 rounded-xl overflow-hidden bg-gradient-to-br from-tpl-forest to-tpl-mid flex items-center justify-center">
                        {slide.image_url ? (
                          <img src={slide.image_url} alt={slide.title ?? ''} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-tpl-lime text-xs font-bold px-2 text-center leading-tight">{slide.discount_label || slide.title?.slice(0, 10) || `Slide ${idx + 1}`}</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-tpl-dark text-sm">{slide.title || '(no title)'}</p>
                            {slide.subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{slide.subtitle}</p>}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {slide.discount_label && (
                                <span className="text-xs bg-tpl-lime/20 text-tpl-forest px-2 py-0.5 rounded-full font-medium">{slide.discount_label}</span>
                              )}
                              <span className="text-xs text-gray-400">Order: {slide.sort_order}</span>
                              {slide.start_date && (
                                <span className="text-xs text-gray-400">
                                  {slide.start_date}{slide.end_date ? ` → ${slide.end_date}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* Active toggle */}
                            <button
                              onClick={() => toggleSlideActive(slide)}
                              className={`p-1.5 rounded-lg transition-colors ${slide.active ? 'text-tpl-lime hover:bg-tpl-pale' : 'text-gray-300 hover:bg-gray-100'}`}
                              title={slide.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                            >
                              {slide.active
                                ? <ToggleRight className="h-5 w-5" />
                                : <ToggleLeft className="h-5 w-5" />}
                            </button>
                            <button onClick={() => openEditSlide(slide)} className="p-1.5 text-gray-400 hover:text-tpl-forest hover:bg-tpl-cream rounded-lg transition-colors">
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button onClick={() => deleteSlide(slide.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
