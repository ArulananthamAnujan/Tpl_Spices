import { useEffect, useState, useRef, useCallback } from 'react';
import { Search, Tag, Percent, DollarSign, X, CheckSquare, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Product, ProductVariation, formatPrice } from '../lib/types';
import { isPromoActive, promoPriceCents } from '../lib/pricing';

type PromoType = 'percent' | 'fixed' | 'price';

// Admin/staff tool: edit retail + wholesale prices inline, and run promotions
// on a drag-selected set of products.
export default function PricingPromotionsPanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
    const { data } = await supabase
      .from('products')
      .select('*, category:categories(name), variations:product_variations(*)')
      .eq('active', true)
      .order('name');
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

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
      .update({ price_cents: retail, wholesale_price_cents: wsPrice, wholesale_min_qty: wsMin })
      .eq('id', v.id);
    if (error) setToast(error.message);
    else { setToast('Saved.'); await load(); setDrafts(prev => { const n = { ...prev }; delete n[v.id]; return n; }); }
    setSavingId(null);
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
        <h2 className="font-semibold text-tpl-dark text-lg mb-1 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-tpl-forest" /> Pricing &amp; Promotions
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Edit retail and wholesale prices inline on each product. To run a promotion, <b>drag a box over the products</b> (or click / shift-click to multi-select), then choose a discount and apply.
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
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </div>
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
