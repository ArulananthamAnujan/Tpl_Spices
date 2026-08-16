import { useEffect, useState, useRef, useCallback } from 'react';
import { Search, Tag, Percent, DollarSign, X, CheckSquare, Loader2, Sparkles, Check, FolderTree, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Product, ProductVariation, Category, formatPrice } from '../lib/types';
import { isPromoActive, promoPriceCents } from '../lib/pricing';
import { useAuth } from '../contexts/AuthContext';

type PromoType = 'percent' | 'fixed' | 'price';

// Admin/staff tool: edit retail + wholesale prices inline, and run promotions
// on a drag-selected set of products.
export default function PricingPromotionsPanel() {
  const { profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Bulk wholesale/retail pricing (independent of promotions)
  const [bulkWsPrice, setBulkWsPrice] = useState('');
  const [bulkWsMin, setBulkWsMin] = useState('');
  const [bulkWsPct, setBulkWsPct] = useState('');
  const [bulkPriceBusy, setBulkPriceBusy] = useState(false);

  // Bulk category assignment
  const [moveCat, setMoveCat] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);

  // Square sync + "still needs pricing" filter
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [needsPriceOnly, setNeedsPriceOnly] = useState(false);
  // Only needed if SQUARE_ACCESS_TOKEN isn't set as a Supabase secret.
  const [needToken, setNeedToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [envInput, setEnvInput] = useState<'production' | 'sandbox'>('production');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { retail: string; ws: string; wsMin: string }>>({});

  // Promotion form
  const [promoType, setPromoType] = useState<PromoType>('percent');
  const [promoValue, setPromoValue] = useState('');
  const [promoStart, setPromoStart] = useState('');
  const [promoEnd, setPromoEnd] = useState('');
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState('');

  const gridRef = useRef<HTMLDivElement>(null);
  const marqueeAdditive = useRef(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [prodRes, catRes] = await Promise.all([
      supabase.from('products').select('*, category:categories(name), variations:product_variations(*)').eq('active', true).order('name'),
      supabase.from('categories').select('*').order('sort_order').order('name'),
    ]);
    setProducts((prodRes.data as Product[]) ?? []);
    setCategories((catRes.data as Category[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // A product still needs pricing if any variation has no wholesale tier set.
  const needsPricing = (p: Product) =>
    (p.variations ?? []).some(v => v.wholesale_price_cents == null || v.wholesale_min_qty == null);

  const visible = products.filter(p => {
    if (needsPriceOnly && !needsPricing(p)) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (catFilter === 'all') return true;
    // Selecting a parent category includes its subcategories.
    const childIds = categories.filter(c => c.parent_id === catFilter).map(c => c.id);
    return p.category_id === catFilter || childIds.includes(p.category_id ?? '');
  });

  const toggle = (id: string, additive: boolean) => {
    setSelected(prev => {
      const next = new Set(additive ? prev : []);
      if (prev.has(id) && additive) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- Marquee (drag) selection ----
  const onGridMouseDown = (e: React.MouseEvent) => {
    // Ignore drags that start on interactive elements (inputs/buttons).
    if ((e.target as HTMLElement).closest('input,button,select,label')) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    marqueeAdditive.current = e.shiftKey || e.metaKey || e.ctrlKey;
    const startX = e.clientX;
    const startY = e.clientY;
    const baseSelected = new Set(marqueeAdditive.current ? selected : []);

    const move = (ev: MouseEvent) => {
      const x = Math.min(startX, ev.clientX);
      const y = Math.min(startY, ev.clientY);
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      setMarquee({ x: x - rect.left, y: y - rect.top, w, h });
      const box = { left: x, top: y, right: x + w, bottom: y + h };
      const hit = new Set(baseSelected);
      gridRef.current?.querySelectorAll<HTMLElement>('[data-pid]').forEach(el => {
        const r = el.getBoundingClientRect();
        const overlap = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
        if (overlap) hit.add(el.dataset.pid!);
      });
      setSelected(hit);
    };
    const up = () => {
      setMarquee(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ---- Inline price editing ----
  const draftFor = (v: ProductVariation) => drafts[v.id] ?? {
    retail: (v.price_cents / 100).toString(),
    ws: v.wholesale_price_cents != null ? (v.wholesale_price_cents / 100).toString() : '',
    wsMin: v.wholesale_min_qty != null ? String(v.wholesale_min_qty) : '',
  };

  const setDraft = (id: string, patch: Partial<{ retail: string; ws: string; wsMin: string }>, v: ProductVariation) => {
    setDrafts(prev => ({ ...prev, [id]: { ...draftFor(v), ...prev[id], ...patch } }));
  };

  const savePrices = async (v: ProductVariation) => {
    const d = draftFor(v);
    const retail = Math.round(parseFloat(d.retail) * 100);
    if (!Number.isFinite(retail) || retail < 0) { setToast('Enter a valid retail price.'); return; }
    const wsPrice = d.ws.trim() === '' ? null : Math.round(parseFloat(d.ws) * 100);
    const wsMin = d.wsMin.trim() === '' ? null : Math.floor(Number(d.wsMin));
    if (wsPrice != null && (!Number.isFinite(wsPrice) || wsPrice < 0)) { setToast('Enter a valid wholesale price.'); return; }
    if ((wsPrice != null) !== (wsMin != null)) { setToast('Set both a wholesale price and a minimum quantity, or leave both blank.'); return; }
    setSavingId(v.id);
    const { error } = await supabase
      .from('product_variations')
      // price_overridden keeps the Square sync from overwriting this price.
      .update({ price_cents: retail, wholesale_price_cents: wsPrice, wholesale_min_qty: wsMin, price_overridden: true })
      .eq('id', v.id);
    if (error) setToast(error.message);
    else { setToast('Saved.'); await load(); setDrafts(prev => { const n = { ...prev }; delete n[v.id]; return n; }); }
    setSavingId(null);
  };

  // Pull the latest catalogue from Square. The edge function falls back to the
  // SQUARE_ACCESS_TOKEN secret, so there's nothing to paste here.
  const syncFromSquare = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-catalog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify(
          tokenInput.trim() ? { square_token: tokenInput.trim(), square_env: envInput } : {},
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // No stored secret — let them paste a token just this once.
        if (/access token/i.test(body.error ?? '')) setNeedToken(true);
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      setNeedToken(false);
      const inv = body.inventoryUpdated ?? 0;
      const notes = (body.inventoryNotes ?? []).join(' ');
      setSyncMsg(
        `Synced ${body.products ?? 0} products and ${body.variations ?? 0} prices from Square.` +
        (inv > 0 ? ` Updated stock on ${inv} item${inv > 1 ? 's' : ''}.` : '') +
        (notes ? ` ${notes}` : ''),
      );
      await load();
    } catch (e) {
      setSyncMsg(`Error: ${(e as Error).message}`);
    }
    setSyncing(false);
  };

  // ---- Move the selected products into a category / subcategory ----
  // category_overridden tells the Square sync to leave this placement alone.
  const moveToCategory = async () => {
    if (selected.size === 0) { setToast('Select some products first.'); return; }
    if (!moveCat) { setToast('Pick a category to move them into.'); return; }
    setMoveBusy(true);
    const { error } = await supabase
      .from('products')
      .update({
        category_id: moveCat === '__none__' ? null : moveCat,
        category_overridden: true,
      })
      .in('id', [...selected]);
    if (error) setToast(error.message);
    else {
      const name = moveCat === '__none__'
        ? 'Uncategorised'
        : categories.find(c => c.id === moveCat)?.name ?? 'category';
      setToast(`Moved ${selected.size} product${selected.size > 1 ? 's' : ''} into ${name}.`);
      await load();
    }
    setMoveBusy(false);
  };

  // ---- Bulk wholesale pricing on the selection (no promotion involved) ----
  const applyBulkWholesale = async () => {
    if (selected.size === 0) { setToast('Select some products first.'); return; }
    const min = Math.floor(Number(bulkWsMin));
    if (!Number.isFinite(min) || min < 1) { setToast('Enter the minimum quantity for wholesale (e.g. 10).'); return; }
    const flat = bulkWsPrice.trim() === '' ? null : Math.round(parseFloat(bulkWsPrice) * 100);
    const pct = bulkWsPct.trim() === '' ? null : parseFloat(bulkWsPct);
    if (flat == null && pct == null) { setToast('Enter either a wholesale price or a % off retail.'); return; }
    if (flat != null && (!Number.isFinite(flat) || flat < 0)) { setToast('Enter a valid wholesale price.'); return; }
    if (pct != null && (!Number.isFinite(pct) || pct <= 0 || pct >= 100)) { setToast('Enter a discount between 0 and 100.'); return; }

    setBulkPriceBusy(true);
    const targets = products.filter(p => selected.has(p.id)).flatMap(p => p.variations ?? []);
    let ok = 0, failed = 0;
    for (const v of targets) {
      // A flat price applies to every item; a % is computed from each retail price.
      const wsPrice = flat != null ? flat : Math.round((v.price_cents * (100 - (pct as number))) / 100);
      const { error } = await supabase
        .from('product_variations')
        .update({ wholesale_price_cents: wsPrice, wholesale_min_qty: min })
        .eq('id', v.id);
      if (error) failed++; else ok++;
    }
    await load();
    setBulkPriceBusy(false);
    setToast(`Wholesale pricing set on ${ok} item${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.`);
  };

  const clearBulkWholesale = async () => {
    if (selected.size === 0) { setToast('Select some products first.'); return; }
    setBulkPriceBusy(true);
    const targets = products.filter(p => selected.has(p.id)).flatMap(p => p.variations ?? []);
    for (const v of targets) {
      await supabase.from('product_variations')
        .update({ wholesale_price_cents: null, wholesale_min_qty: null }).eq('id', v.id);
    }
    await load();
    setBulkPriceBusy(false);
    setToast('Wholesale pricing removed from the selected items.');
  };

  // ---- Apply / clear promotions on the selection ----
  const applyPromo = async () => {
    if (selected.size === 0) { setToast('Select some products first (click, shift-click, or drag over them).'); return; }
    const num = parseFloat(promoValue);
    if (!Number.isFinite(num) || num <= 0) { setToast('Enter a promotion value greater than 0.'); return; }
    const value = promoType === 'percent' ? Math.round(num) : Math.round(num * 100);
    if (promoType === 'percent' && value > 100) { setToast('Percentage cannot exceed 100.'); return; }
    setApplying(true);
    const { error } = await supabase
      .from('product_variations')
      .update({
        promo_type: promoType,
        promo_value: value,
        promo_start: promoStart ? new Date(promoStart).toISOString() : null,
        promo_end: promoEnd ? new Date(promoEnd).toISOString() : null,
      })
      .in('product_id', [...selected]);
    if (error) setToast(error.message);
    else { setToast(`Promotion applied to ${selected.size} product${selected.size > 1 ? 's' : ''}.`); await load(); }
    setApplying(false);
  };

  const clearPromo = async () => {
    if (selected.size === 0) { setToast('Select some products first.'); return; }
    setApplying(true);
    const { error } = await supabase
      .from('product_variations')
      .update({ promo_type: null, promo_value: null, promo_start: null, promo_end: null })
      .in('product_id', [...selected]);
    if (error) setToast(error.message);
    else { setToast(`Promotion cleared on ${selected.size} product${selected.size > 1 ? 's' : ''}.`); await load(); }
    setApplying(false);
  };

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  return (
    <div className="space-y-4">
      {/* Header + promotion controls */}
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
          <h2 className="font-semibold text-tpl-dark text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-tpl-forest" /> Pricing &amp; Promotions
          </h2>
          {profile?.role === 'super_admin' && (
            <button onClick={syncFromSquare} disabled={syncing}
              className="px-4 py-2 border border-tpl-forest text-tpl-forest rounded-xl text-sm font-semibold hover:bg-tpl-pale transition-colors disabled:opacity-50 flex items-center gap-2">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? 'Syncing…' : 'Sync from Square'}
            </button>
          )}
        </div>
        {needToken && (
          <div className="mb-3 p-3 rounded-xl border border-amber-200 bg-amber-50">
            <p className="text-xs text-amber-800 mb-2">
              No Square token is stored. Paste one here to sync now — or set <code>SQUARE_ACCESS_TOKEN</code> in
              Supabase → Edge Functions → Secrets so you never have to paste it again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={tokenInput} onChange={e => setTokenInput(e.target.value)} type="password"
                placeholder="EAAA… Square access token"
                className="flex-1 min-w-[220px] px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
              <select value={envInput} onChange={e => setEnvInput(e.target.value as 'production' | 'sandbox')}
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </div>
          </div>
        )}
        {syncMsg && (
          <div className={`text-sm px-3 py-2 rounded-xl mb-3 ${syncMsg.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-tpl-pale text-tpl-forest'}`}>
            {syncMsg}
          </div>
        )}
        <p className="text-sm text-gray-500 mb-4">
          Edit retail and wholesale prices inline on each product. <b>Drag a box over products</b> (or click / shift-click) to select them, then set wholesale pricing or run a promotion on the whole selection.
        </p>

        {/* Move selected products into a category / subcategory */}
        <div className="rounded-xl border border-gray-200 p-4 mb-4">
          <p className="text-xs font-semibold text-tpl-dark mb-2 flex items-center gap-1.5">
            <FolderTree className="h-4 w-4 text-tpl-forest" /> Move selected products into a category
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <select value={moveCat} onChange={e => setMoveCat(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime min-w-[220px]">
              <option value="">Choose a category…</option>
              {categories.filter(c => !c.parent_id).map(parent => [
                <option key={parent.id} value={parent.id}>{parent.name}</option>,
                ...categories.filter(c => c.parent_id === parent.id).map(child => (
                  <option key={child.id} value={child.id}>&nbsp;&nbsp;— {child.name}</option>
                )),
              ])}
              <option value="__none__">Uncategorised</option>
            </select>
            <button onClick={moveToCategory} disabled={moveBusy}
              className="px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-40 flex items-center gap-1.5">
              {moveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Move {selected.size} selected
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            This is how products get into a subcategory — Square has no subcategories, so once you move a product here the sync will leave it where you put it.
          </p>
        </div>

        {/* Bulk retail/wholesale pricing — no promotion needed */}
        <div className="rounded-xl border border-gray-200 p-4 mb-4">
          <p className="text-xs font-semibold text-tpl-dark mb-2 flex items-center gap-1.5">
            <DollarSign className="h-4 w-4 text-tpl-forest" /> Wholesale pricing for selected items
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-gray-500">Wholesale price ($)
              <input value={bulkWsPrice} onChange={e => { setBulkWsPrice(e.target.value); if (e.target.value) setBulkWsPct(''); }}
                type="number" min={0} step="0.01" placeholder="e.g. 8.50"
                className="block w-28 mt-1 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
            </label>
            <span className="text-[11px] text-gray-400 pb-2">or</span>
            <label className="text-[11px] text-gray-500">% off retail
              <input value={bulkWsPct} onChange={e => { setBulkWsPct(e.target.value); if (e.target.value) setBulkWsPrice(''); }}
                type="number" min={0} max={99} step="1" placeholder="e.g. 15"
                className="block w-24 mt-1 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
            </label>
            <label className="text-[11px] text-gray-500">Wholesale from qty
              <input value={bulkWsMin} onChange={e => setBulkWsMin(e.target.value)} type="number" min={1} placeholder="e.g. 10"
                className="block w-28 mt-1 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
            </label>
            <button onClick={applyBulkWholesale} disabled={bulkPriceBusy}
              className="px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-40 flex items-center gap-1.5">
              {bulkPriceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Set on {selected.size} selected
            </button>
            <button onClick={clearBulkWholesale} disabled={bulkPriceBusy}
              className="px-3 py-2 text-gray-500 hover:text-red-500 rounded-xl text-sm font-medium transition-colors">
              Remove wholesale
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            A “% off retail” is worked out per item from its own retail price. Customers get this price once they buy the minimum quantity — no promotion required.
          </p>
        </div>

        <p className="text-xs font-semibold text-tpl-dark mb-2 flex items-center gap-1.5">
          <Tag className="h-4 w-4 text-tpl-forest" /> Promotion for selected items
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-gray-500 block mb-1">Discount type</label>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden">
              {([['percent', '% off'], ['fixed', '$ off'], ['price', 'Sale price']] as [PromoType, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setPromoType(t)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${promoType === t ? 'bg-tpl-forest text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-[11px] text-gray-500">
            {promoType === 'percent' ? 'Percent off' : promoType === 'fixed' ? 'Amount off ($)' : 'Sale price ($)'}
            <div className="relative mt-1">
              {promoType === 'percent'
                ? <Percent className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                : <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />}
              <input value={promoValue} onChange={e => setPromoValue(e.target.value)} type="number" min={0} step="0.01"
                placeholder={promoType === 'percent' ? '20' : '4.99'}
                className="w-28 pl-7 pr-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
            </div>
          </label>
          <label className="text-[11px] text-gray-500">Starts (optional)
            <input type="date" value={promoStart} onChange={e => setPromoStart(e.target.value)}
              className="block mt-1 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </label>
          <label className="text-[11px] text-gray-500">Ends (optional)
            <input type="date" value={promoEnd} onChange={e => setPromoEnd(e.target.value)}
              className="block mt-1 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </label>
          <button onClick={applyPromo} disabled={applying}
            className="px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
            Apply to {selected.size} selected
          </button>
          <button onClick={clearPromo} disabled={applying}
            className="px-3 py-2 text-gray-500 hover:text-red-500 rounded-xl text-sm font-medium transition-colors">
            Clear promo
          </button>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </div>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
            <option value="all">All categories</option>
            {categories.filter(c => !c.parent_id).map(parent => [
              <option key={parent.id} value={parent.id}>{parent.name}</option>,
              ...categories.filter(c => c.parent_id === parent.id).map(child => (
                <option key={child.id} value={child.id}>&nbsp;&nbsp;— {child.name}</option>
              )),
            ])}
          </select>
          <button onClick={() => setNeedsPriceOnly(v => !v)}
            className={`text-xs px-3 py-2 rounded-xl border flex items-center gap-1.5 transition-colors ${
              needsPriceOnly ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            <AlertCircle className="h-3.5 w-3.5" />
            Needs wholesale price ({products.filter(needsPricing).length})
          </button>
          <button onClick={() => setSelected(new Set(visible.map(p => p.id)))}
            className="text-xs px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" /> Select all
          </button>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())}
              className="text-xs px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
              <X className="h-3.5 w-3.5" /> Clear ({selected.size})
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="bg-tpl-dark text-white text-sm px-4 py-2 rounded-xl inline-block">{toast}</div>
      )}

      {/* Selectable product grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>
      ) : (
        <div ref={gridRef} onMouseDown={onGridMouseDown}
          className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 select-none">
          {marquee && (
            <div className="absolute z-10 border-2 border-tpl-forest bg-tpl-forest/10 rounded pointer-events-none"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
          )}
          {visible.map(product => {
            const isSel = selected.has(product.id);
            return (
              <div key={product.id} data-pid={product.id}
                onClick={e => toggle(product.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                className={`rounded-2xl border-2 p-3 cursor-pointer transition-all ${isSel ? 'border-tpl-forest bg-tpl-pale/40 shadow-card' : 'border-transparent bg-white shadow-card hover:border-tpl-forest/30'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-tpl-dark text-sm truncate">{product.name}</p>
                    {product.category && <p className="text-xs text-gray-400">{product.category.name}</p>}
                  </div>
                  <span className={`h-5 w-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${isSel ? 'bg-tpl-forest border-tpl-forest' : 'border-gray-300'}`}>
                    {isSel && <CheckSquare className="h-3.5 w-3.5 text-white" />}
                  </span>
                </div>
                <div className="space-y-2">
                  {(product.variations ?? []).map(v => {
                    const d = draftFor(v);
                    const dirty = drafts[v.id] !== undefined;
                    const promoOn = isPromoActive(v);
                    return (
                      <div key={v.id} className="rounded-xl bg-tpl-cream/60 p-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-600 truncate">{v.name}</span>
                          {promoOn && (
                            <span className="text-[10px] font-bold text-red-600">
                              SALE {formatPrice(promoPriceCents(v))}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1.5" onClick={e => e.stopPropagation()}>
                          <label className="text-[10px] text-gray-400">Retail $
                            <input value={d.retail} onChange={e => setDraft(v.id, { retail: e.target.value }, v)} type="number" min={0} step="0.01"
                              className="w-full mt-0.5 px-1.5 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-tpl-lime" />
                          </label>
                          <label className="text-[10px] text-gray-400">Wholesale $
                            <input value={d.ws} onChange={e => setDraft(v.id, { ws: e.target.value }, v)} type="number" min={0} step="0.01" placeholder="—"
                              className="w-full mt-0.5 px-1.5 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-tpl-lime" />
                          </label>
                          <label className="text-[10px] text-gray-400">From qty
                            <input value={d.wsMin} onChange={e => setDraft(v.id, { wsMin: e.target.value }, v)} type="number" min={1} placeholder="—"
                              className="w-full mt-0.5 px-1.5 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-tpl-lime" />
                          </label>
                        </div>
                        {dirty && (
                          <button onClick={e => { e.stopPropagation(); savePrices(v); }} disabled={savingId === v.id}
                            className="mt-1.5 text-[11px] px-2 py-1 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-40">
                            {savingId === v.id ? 'Saving…' : 'Save prices'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {(product.variations ?? []).length === 0 && (
                    <p className="text-xs text-gray-400 italic">No variations</p>
                  )}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && <p className="text-sm text-gray-400 py-10">No products found.</p>}
        </div>
      )}
    </div>
  );
}
