import { useEffect, useState, useCallback } from 'react';
import {
  Search as SearchIcon, Boxes, PackagePlus, Clock, History as HistoryIcon,
  Loader2, X, Check, ChevronDown, Layers, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Category, Product, ProductVariation } from '../lib/types';

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

const REASON_LABEL: Record<string, string> = {
  received: 'Received', sale: 'Sale', adjustment: 'Adjusted', initial: 'Opening balance',
};

// FIFO aging of the stock currently on hand, bucketed by received date.
function computeAging(moves: InvMove[]) {
  const inflows = moves
    .filter(m => m.delta > 0)
    .map(m => ({ when: m.received_at || m.created_at, remaining: m.delta }))
    .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  let out = moves.filter(m => m.delta < 0).reduce((s, m) => s + -m.delta, 0);
  for (const b of inflows) { if (out <= 0) break; const take = Math.min(b.remaining, out); b.remaining -= take; out -= take; }
  const now = Date.now();
  const bk = { fresh: 0, mid: 0, old: 0 };
  for (const b of inflows) {
    if (b.remaining <= 0) continue;
    const days = (now - new Date(b.when).getTime()) / 86400000;
    if (days < 30) bk.fresh += b.remaining; else if (days < 90) bk.mid += b.remaining; else bk.old += b.remaining;
  }
  return bk;
}

const UNCAT = '__uncat__';

export default function InventoryPanel() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<Record<string, number>>({});          // variation_id -> tracked qty
  const [moves, setMoves] = useState<Record<string, InvMove[]>>({});
  const [loading, setLoading] = useState(true);
  const [stockLoading, setStockLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());       // variation_ids
  const [panelVar, setPanelVar] = useState<string | null>(null);
  const [addQty, setAddQty] = useState(''); const [addDate, setAddDate] = useState(''); const [addNote, setAddNote] = useState('');

  // Bulk bar
  const [bulkMode, setBulkMode] = useState<'set' | 'add'>('add');
  const [bulkQty, setBulkQty] = useState('');
  const [bulkDate, setBulkDate] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      const [storesRes, catsRes, prodRes] = await Promise.all([
        supabase.from('stores').select('*').order('name'),
        supabase.from('categories').select('*').order('sort_order'),
        supabase.from('products').select('*, category:categories(name), variations:product_variations(*)').eq('active', true).order('name'),
      ]);
      setStores((storesRes.data as Store[]) ?? []);
      setCategories((catsRes.data as Category[]) ?? []);
      setProducts((prodRes.data as Product[]) ?? []);
      if ((storesRes.data as Store[])?.length) setStoreId((storesRes.data as Store[])[0].id);
      setLoading(false);
    })();
  }, []);

  const loadStock = useCallback(async (sid: string) => {
    if (!sid) return;
    setStockLoading(true);
    const [invRes, movesRes] = await Promise.all([
      supabase.from('store_inventory').select('variation_id, quantity').eq('store_id', sid),
      supabase.from('inventory_movements')
        .select('id, variation_id, delta, reason, received_at, created_at, note, creator:profiles(full_name)')
        .eq('store_id', sid).order('created_at', { ascending: false }),
    ]);
    const r: Record<string, number> = {};
    (invRes.data ?? []).forEach((x: any) => { r[x.variation_id] = x.quantity; });
    setRows(r);
    const m: Record<string, InvMove[]> = {};
    ((movesRes.data as InvMove[] | null) ?? []).forEach(x => { (m[x.variation_id] = m[x.variation_id] ?? []).push(x); });
    setMoves(m);
    setDrafts({});
    setStockLoading(false);
  }, []);

  useEffect(() => { if (storeId) loadStock(storeId); }, [storeId, loadStock]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);

  const flash = (msg: string) => setToast(msg);

  // ---- filtering + grouping by category ----
  const term = search.trim().toLowerCase();
  const filtered = products.filter(p => {
    if (term && !p.name.toLowerCase().includes(term)) return false;
    if (catFilter === 'all') return true;
    if (catFilter === UNCAT) return !p.category_id;
    // Picking a parent category includes everything in its subcategories.
    const childIds = categories.filter(c => c.parent_id === catFilter).map(c => c.id);
    return p.category_id === catFilter || childIds.includes(p.category_id ?? '');
  });
  const groups = new Map<string, { name: string; items: Product[] }>();
  for (const p of filtered) {
    const key = p.category_id ?? UNCAT;
    // Show the full path so subcategories are obvious, e.g. "Rice › Basmati".
    const cat = categories.find(c => c.id === p.category_id);
    const parent = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) : null;
    const name = cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : 'Uncategorised';
    if (!groups.has(key)) groups.set(key, { name, items: [] });
    groups.get(key)!.items.push(p);
  }
  const visibleVarIds = filtered.flatMap(p => (p.variations ?? []).map(v => v.id));

  // ---- single-row actions ----
  const recordMovement = async (variationId: string, delta: number, reason: string, receivedAt?: string | null, note?: string | null) => {
    return supabase.rpc('record_inventory_movement', {
      p_store_id: storeId, p_variation_id: variationId, p_delta: delta, p_reason: reason,
      p_received_at: receivedAt ?? null, p_note: note ?? null,
    });
  };

  const saveQty = async (v: ProductVariation, qtyStr: string) => {
    const qty = Math.max(0, Math.floor(Number(qtyStr)));
    if (!Number.isFinite(qty)) return;
    const cur = rows[v.id] ?? 0;
    const delta = qty - cur;
    if (delta === 0) { setDrafts(p => { const n = { ...p }; delete n[v.id]; return n; }); return; }
    setSavingId(v.id);
    const { error } = await recordMovement(v.id, delta, 'adjustment', null, `Set quantity to ${qty}`);
    if (error) flash(error.message); else await loadStock(storeId);
    setSavingId(null);
  };

  const addStock = async (v: ProductVariation) => {
    const qty = Math.floor(Number(addQty));
    if (!Number.isFinite(qty) || qty <= 0) { flash('Enter a quantity greater than 0.'); return; }
    setSavingId(v.id);
    const { error } = await recordMovement(v.id, qty, 'received', addDate ? new Date(addDate).toISOString() : null, addNote || null);
    if (error) flash(error.message);
    else { setAddQty(''); setAddDate(''); setAddNote(''); await loadStock(storeId); }
    setSavingId(null);
  };

  // ---- bulk actions ----
  const toggleSel = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectGroup = (items: Product[], on: boolean) => {
    const ids = items.flatMap(p => (p.variations ?? []).map(v => v.id));
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n; });
  };

  const applyBulk = async () => {
    if (selected.size === 0) { flash('Select some items first.'); return; }
    const qty = Math.floor(Number(bulkQty));
    if (!Number.isFinite(qty) || qty < 0 || (bulkMode === 'add' && qty <= 0)) { flash('Enter a valid quantity.'); return; }
    setBulkBusy(true);
    let ok = 0, failed = 0;
    for (const vid of selected) {
      let res;
      if (bulkMode === 'add') res = await recordMovement(vid, qty, 'received', bulkDate ? new Date(bulkDate).toISOString() : null, 'Bulk received');
      else {
        const delta = qty - (rows[vid] ?? 0);
        if (delta === 0) { ok++; continue; }
        res = await recordMovement(vid, delta, 'adjustment', null, `Bulk set to ${qty}`);
      }
      if (res?.error) failed++; else ok++;
    }
    await loadStock(storeId);
    setBulkBusy(false);
    setSelected(new Set());
    setBulkQty('');
    flash(`${bulkMode === 'add' ? 'Added stock to' : 'Updated'} ${ok} item${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.`);
  };

  const stockBadge = (v: ProductVariation) => {
    const tracked = Object.prototype.hasOwnProperty.call(rows, v.id);
    if (!tracked) return <span className="text-[11px] font-medium text-gray-400">Not tracked</span>;
    const q = rows[v.id];
    const cls = q <= 0 ? 'bg-red-100 text-red-700' : q <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';
    return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{q} in stock</span>;
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;

  const lowCount = visibleVarIds.filter(id => rows[id] !== undefined && rows[id] > 0 && rows[id] <= 5).length;
  const outCount = visibleVarIds.filter(id => rows[id] !== undefined && rows[id] <= 0).length;

  return (
    <div className="space-y-4 pb-28">
      {/* Toolbar */}
      <div className="bg-white rounded-2xl shadow-card p-5">
        <h2 className="font-semibold text-tpl-dark text-lg mb-1 flex items-center gap-2">
          <Boxes className="h-5 w-5 text-tpl-forest" /> Inventory
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Pick a store, filter by category, then update stock. <b>Tick items and use the bar at the bottom</b> to update many at once.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-[11px] font-medium text-gray-500">Store
            <div className="relative mt-1">
              <select value={storeId} onChange={e => { setStoreId(e.target.value); setSelected(new Set()); }}
                className="w-full appearance-none px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
                {stores.length === 0 && <option value="">No stores yet</option>}
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </label>
          <label className="text-[11px] font-medium text-gray-500">Category
            <div className="relative mt-1">
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                className="w-full appearance-none px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
                <option value="all">All categories</option>
                {categories.filter(c => !c.parent_id).map(parent => [
                  <option key={parent.id} value={parent.id}>{parent.name}</option>,
                  ...categories.filter(c => c.parent_id === parent.id).map(child => (
                    <option key={child.id} value={child.id}>&nbsp;&nbsp;— {child.name}</option>
                  )),
                ])}
                <option value={UNCAT}>Uncategorised</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </label>
          <label className="text-[11px] font-medium text-gray-500">Search
            <div className="relative mt-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Product name…"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
            </div>
          </label>
        </div>

        {storeId && (
          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-tpl-cream text-tpl-forest font-medium">{filtered.length} products</span>
            {lowCount > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{lowCount} low</span>}
            {outCount > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-medium">{outCount} out of stock</span>}
          </div>
        )}
      </div>

      {toast && <div className="bg-tpl-dark text-white text-sm px-4 py-2 rounded-xl inline-block">{toast}</div>}

      {!storeId ? (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <Boxes className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Add a store first, then come back to set stock levels.</p>
        </div>
      ) : stockLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([key, group]) => {
            const groupVarIds = group.items.flatMap(p => (p.variations ?? []).map(v => v.id));
            const allSel = groupVarIds.length > 0 && groupVarIds.every(id => selected.has(id));
            return (
              <div key={key} className="bg-white rounded-2xl shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-tpl-cream/50 border-b border-gray-100">
                  <h3 className="font-semibold text-tpl-dark text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4 text-tpl-forest/70" /> {group.name}
                    <span className="text-gray-400 font-normal">· {group.items.length}</span>
                  </h3>
                  <button onClick={() => selectGroup(group.items, !allSel)}
                    className="text-xs font-medium text-tpl-forest hover:text-tpl-mid">
                    {allSel ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="divide-y divide-gray-50">
                  {group.items.map(product => (
                    <div key={product.id} className="px-5 py-3">
                      <p className="text-sm font-semibold text-tpl-dark mb-2">{product.name}</p>
                      <div className="space-y-1.5">
                        {(product.variations ?? []).map(v => {
                          const draft = drafts[v.id];
                          const tracked = Object.prototype.hasOwnProperty.call(rows, v.id);
                          const sel = selected.has(v.id);
                          const saving = savingId === v.id;
                          return (
                            <div key={v.id}>
                              <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors ${sel ? 'bg-tpl-pale/50' : 'hover:bg-gray-50'}`}>
                                <button onClick={() => toggleSel(v.id)}
                                  className={`h-5 w-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'bg-tpl-forest border-tpl-forest' : 'border-gray-300 hover:border-tpl-forest'}`}>
                                  {sel && <Check className="h-3.5 w-3.5 text-white" />}
                                </button>
                                <span className="text-xs text-gray-600 flex-1 truncate">{v.name}</span>
                                <span className="hidden sm:block">{stockBadge(v)}</span>
                                <input type="number" min={0}
                                  value={draft !== undefined ? draft : (tracked ? String(rows[v.id]) : '')}
                                  onChange={e => setDrafts(p => ({ ...p, [v.id]: e.target.value }))}
                                  placeholder="∞"
                                  className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                                <button onClick={() => saveQty(v, draft !== undefined ? draft : String(rows[v.id] ?? 0))}
                                  disabled={saving || draft === undefined}
                                  className="text-xs px-2.5 py-1 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-30">
                                  {saving ? '…' : 'Save'}
                                </button>
                                <button onClick={() => setPanelVar(panelVar === v.id ? null : v.id)}
                                  title="Add stock, aging & history"
                                  className={`p-1.5 rounded-lg transition-colors ${panelVar === v.id ? 'text-tpl-forest bg-tpl-pale' : 'text-gray-400 hover:text-tpl-forest'}`}>
                                  <HistoryIcon className="h-4 w-4" />
                                </button>
                              </div>

                              {panelVar === v.id && (() => {
                                const mv = moves[v.id] ?? [];
                                const ag = computeAging(mv);
                                return (
                                  <div className="ml-7 mt-2 mb-1 border border-tpl-forest/20 rounded-xl bg-white p-4 space-y-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                      <div className="rounded-xl bg-tpl-cream px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Available</p><p className="text-lg font-bold text-tpl-dark">{rows[v.id] ?? 0}</p></div>
                                      <div className="rounded-xl bg-green-50 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-green-700">Under 1 mo</p><p className="text-lg font-bold text-green-700">{ag.fresh}</p></div>
                                      <div className="rounded-xl bg-amber-50 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-amber-700">1–3 months</p><p className="text-lg font-bold text-amber-700">{ag.mid}</p></div>
                                      <div className="rounded-xl bg-red-50 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-red-700">Over 3 mo</p><p className="text-lg font-bold text-red-700">{ag.old}</p></div>
                                    </div>
                                    <div className="rounded-xl border border-gray-100 p-3">
                                      <p className="flex items-center gap-1.5 text-xs font-semibold text-tpl-dark mb-2"><PackagePlus className="h-4 w-4 text-tpl-forest" /> Add received stock</p>
                                      <div className="flex flex-wrap items-end gap-2">
                                        <label className="text-[11px] text-gray-500">Quantity<input type="number" min={1} value={addQty} onChange={e => setAddQty(e.target.value)} placeholder="0" className="block w-24 mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" /></label>
                                        <label className="text-[11px] text-gray-500">Received on<input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className="block mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" /></label>
                                        <label className="text-[11px] text-gray-500 flex-1 min-w-[140px]">Note (optional)<input value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Supplier, batch #…" className="block w-full mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" /></label>
                                        <button onClick={() => addStock(v)} disabled={saving} className="text-xs px-3 py-1.5 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-40">{saving ? '…' : 'Add stock'}</button>
                                      </div>
                                    </div>
                                    <div>
                                      <p className="flex items-center gap-1.5 text-xs font-semibold text-tpl-dark mb-2"><Clock className="h-4 w-4 text-tpl-forest" /> History</p>
                                      {mv.length === 0 ? <p className="text-xs text-gray-400 italic">No stock changes recorded yet.</p> : (
                                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                                          {mv.map(m => (
                                            <div key={m.id} className="flex items-center gap-3 py-1.5 text-xs">
                                              <span className={`font-bold w-12 text-right ${m.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                                              <span className="flex-1"><span className="font-medium text-tpl-dark">{REASON_LABEL[m.reason] ?? m.reason}</span>{m.received_at && <span className="text-gray-400"> · received {new Date(m.received_at).toLocaleDateString()}</span>}{m.note && <span className="text-gray-400"> · {m.note}</span>}</span>
                                              <span className="text-gray-400 whitespace-nowrap">{new Date(m.created_at).toLocaleDateString()}{m.creator?.full_name ? ` · ${m.creator.full_name}` : ''}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                        {(product.variations ?? []).length === 0 && <p className="text-xs text-gray-400 italic">No variations</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="bg-white rounded-2xl shadow-card p-12 text-center text-gray-400">No products match this filter.</div>}
        </div>
      )}

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-3xl">
          <div className="bg-tpl-dark text-white rounded-2xl shadow-card-hover p-3 flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold px-1">{selected.size} selected</span>
            <div className="flex rounded-lg overflow-hidden border border-white/20">
              <button onClick={() => setBulkMode('add')} className={`px-3 py-1.5 text-xs font-medium ${bulkMode === 'add' ? 'bg-tpl-lime text-tpl-dark' : 'text-white/80'}`}>Add received</button>
              <button onClick={() => setBulkMode('set')} className={`px-3 py-1.5 text-xs font-medium ${bulkMode === 'set' ? 'bg-tpl-lime text-tpl-dark' : 'text-white/80'}`}>Set to</button>
            </div>
            <input type="number" min={0} value={bulkQty} onChange={e => setBulkQty(e.target.value)} placeholder="Qty"
              className="w-20 px-2 py-1.5 rounded-lg text-sm text-tpl-dark focus:outline-none" />
            {bulkMode === 'add' && (
              <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-sm text-tpl-dark focus:outline-none" />
            )}
            <button onClick={applyBulk} disabled={bulkBusy}
              className="px-4 py-1.5 bg-tpl-lime text-tpl-dark rounded-lg text-sm font-bold hover:bg-tpl-light transition-colors disabled:opacity-50 flex items-center gap-1.5">
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Apply
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto p-1.5 text-white/70 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
