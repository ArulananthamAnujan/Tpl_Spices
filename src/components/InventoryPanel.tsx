import { useCallback, useEffect, useState } from 'react';
import {
  Boxes, Search, X, History as HistoryIcon, Clock, PackagePlus, PackageMinus, Wallet, TrendingUp,
  AlertTriangle, Snail, ShoppingBag, Store as StoreIcon, Salad, ChefHat, Flame, Shirt, Tag, Loader2, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Product, Category, formatPrice } from '../lib/types';

// Admin → Inventory. One place to run the shop's stock:
//  * what the stock is worth, per section (grocery, kitchen, pooja, clothing)
//  * what sold and where it went (online, in store via Square, other)
//  * what needs restocking and roughly how many to order
//  * slow stock tying up money
//  * a filterable table of every item to set quantities, add received stock
//    and see each item's history and age.
// Money values use each item's current selling price.

type Section = Category['section'] | 'other';
type StatusFilter = 'all' | 'restock' | 'out' | 'instock' | 'slow' | 'untracked';
type SortKey = 'name' | 'value' | 'stock' | 'sold' | 'days';

interface Move {
  id: string;
  variation_id: string;
  delta: number;
  reason: string;
  received_at: string | null;
  created_at: string;
  note: string | null;
  creator?: { full_name: string | null } | null;
}

interface Row {
  id: string;
  product: string;
  size: string;
  section: Section;
  category: string;
  price: number;
  tracked: boolean;
  qty: number;
  value: number;
  soldU: number; // in the chosen period
  soldV: number;
  sold30: number;
  perDay: number;
  daysLeft: number | null; // null = not selling
  needsRestock: boolean;
  orderQty: number;
  slow: boolean; // in stock but nothing sold for 90 days
}

const SECTIONS: { id: Section; label: string; icon: typeof Salad }[] = [
  { id: 'grocery', label: 'Grocery', icon: Salad },
  { id: 'clothing', label: 'Clothing', icon: Shirt },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat },
  { id: 'pooja', label: 'Pooja', icon: Flame },
  { id: 'other', label: 'Other', icon: Tag },
];

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'All time' },
];

const REASON_LABEL: Record<string, string> = {
  received: 'Received', sale: 'Online sale', adjustment: 'Adjusted', initial: 'Opening balance',
};

const SQUARE_NOTE = 'Square inventory sync';
const DAY = 86400000;
const PAGE = 50;

const isSale = (m: Move) => m.delta < 0 && (m.reason === 'sale' || m.note === SQUARE_NOTE);

const readLocal = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const writeLocal = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

// Supabase returns at most 1000 rows per request; page through the rest.
async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data as T[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// FIFO aging: the oldest received batches are used up first.
function computeAging(moves: Move[]) {
  const inflows = moves
    .filter(m => m.delta > 0)
    .map(m => ({ when: m.received_at || m.created_at, remaining: m.delta }))
    .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  let out = moves.filter(m => m.delta < 0).reduce((s, m) => s - m.delta, 0);
  for (const b of inflows) {
    if (out <= 0) break;
    const take = Math.min(b.remaining, out);
    b.remaining -= take;
    out -= take;
  }
  const bk = { fresh: 0, mid: 0, old: 0 };
  for (const b of inflows) {
    if (b.remaining <= 0) continue;
    const days = (Date.now() - new Date(b.when).getTime()) / DAY;
    if (days < 30) bk.fresh += b.remaining;
    else if (days < 90) bk.mid += b.remaining;
    else bk.old += b.remaining;
  }
  return bk;
}

export default function InventoryPanel() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(() => readLocal('tpl-inv-store', ''));
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [moves, setMoves] = useState<Record<string, Move[]>>({});
  const [loading, setLoading] = useState(true);
  const [stockLoading, setStockLoading] = useState(false);
  const [error, setError] = useState('');

  const [days, setDays] = useState(30);
  const [lowLevel, setLowLevel] = useState(() => Number(readLocal('tpl-inv-low', '5')) || 5);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<Section | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [shown, setShown] = useState(PAGE);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addQty, setAddQty] = useState('');
  const [addDate, setAddDate] = useState('');
  const [addNote, setAddNote] = useState('');

  useEffect(() => writeLocal('tpl-inv-low', String(lowLevel)), [lowLevel]);
  useEffect(() => { if (storeId) writeLocal('tpl-inv-store', storeId); }, [storeId]);
  useEffect(() => setShown(PAGE), [search, section, status, sort]);

  useEffect(() => {
    (async () => {
      try {
        const [storeRes, prods] = await Promise.all([
          supabase.from('stores').select('*').order('name'),
          fetchAll<Product>(() => supabase.from('products')
            .select('*, category:categories(name, section), variations:product_variations(*)')
            .eq('active', true).order('name')),
        ]);
        const list = (storeRes.data as Store[]) ?? [];
        setStores(list);
        setProducts(prods);
        setStoreId(id => (list.some(s => s.id === id) ? id : list[0]?.id ?? ''));
      } catch (e) {
        setError((e as Error).message);
      }
      setLoading(false);
    })();
  }, []);

  const loadStock = useCallback(async (id: string) => {
    if (!id) return;
    setStockLoading(true);
    try {
      const [inv, mv] = await Promise.all([
        fetchAll<{ variation_id: string; quantity: number }>(() =>
          supabase.from('store_inventory').select('variation_id, quantity').eq('store_id', id).order('variation_id')),
        fetchAll<Move>(() =>
          supabase.from('inventory_movements')
            .select('id, variation_id, delta, reason, received_at, created_at, note, creator:profiles(full_name)')
            .eq('store_id', id).order('created_at', { ascending: false }).order('id')),
      ]);
      const s: Record<string, number> = {};
      inv.forEach(r => { s[r.variation_id] = r.quantity; });
      const m: Record<string, Move[]> = {};
      mv.forEach(x => { (m[x.variation_id] = m[x.variation_id] ?? []).push(x); });
      setStock(s);
      setMoves(m);
      setDrafts({});
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setStockLoading(false);
  }, []);

  useEffect(() => { loadStock(storeId); }, [storeId, loadStock]);

  const saveQty = async (variationId: string) => {
    const raw = drafts[variationId];
    if (raw === undefined) return;
    const qty = Math.max(0, Math.floor(Number(raw)));
    if (raw.trim() === '' || !Number.isFinite(qty)) return;
    const delta = qty - (stock[variationId] ?? 0);
    if (delta === 0 && variationId in stock) {
      setDrafts(d => { const n = { ...d }; delete n[variationId]; return n; });
      return;
    }
    setSavingId(variationId);
    const { error: err } = await supabase.rpc('record_inventory_movement', {
      p_store_id: storeId, p_variation_id: variationId, p_delta: delta,
      p_reason: 'adjustment', p_note: `Set quantity to ${qty}`,
    });
    if (err) alert(err.message); else await loadStock(storeId);
    setSavingId(null);
  };

  const addStock = async (variationId: string) => {
    const qty = Math.floor(Number(addQty));
    if (!Number.isFinite(qty) || qty <= 0) { alert('Enter a quantity greater than 0.'); return; }
    setSavingId(variationId);
    const { error: err } = await supabase.rpc('record_inventory_movement', {
      p_store_id: storeId, p_variation_id: variationId, p_delta: qty, p_reason: 'received',
      p_received_at: addDate ? new Date(addDate).toISOString() : null, p_note: addNote || null,
    });
    if (err) alert(err.message);
    else { setAddQty(''); setAddDate(''); setAddNote(''); await loadStock(storeId); }
    setSavingId(null);
  };

  const untrack = async (variationId: string) => {
    if (!confirm('Stop counting stock for this item? It will show as always available.')) return;
    setSavingId(variationId);
    const { error: err } = await supabase.from('store_inventory').delete().eq('store_id', storeId).eq('variation_id', variationId);
    if (err) alert(err.message);
    else setStock(s => { const n = { ...s }; delete n[variationId]; return n; });
    setSavingId(null);
  };

  // ---- Build one row per item/size with its numbers ----
  const now = Date.now();
  const since = days ? now - days * DAY : 0;
  const t = { online: 0, onlineU: 0, store: 0, storeU: 0, other: 0, otherU: 0, received: 0, receivedU: 0 };
  const rows: Row[] = [];
  for (const p of products) {
    const vars = p.variations ?? [];
    const sec = ((p.category as Category | undefined)?.section ?? 'other') as Section;
    for (const v of vars) {
      const tracked = v.id in stock;
      const qty = stock[v.id] ?? 0;
      let soldU = 0, sold30 = 0, sold90 = 0;
      for (const m of moves[v.id] ?? []) {
        const at = new Date(m.created_at).getTime();
        const inPeriod = !since || at >= since;
        const units = Math.abs(m.delta);
        const val = units * v.price_cents;
        if (isSale(m)) {
          if (at >= now - 30 * DAY) sold30 += units;
          if (at >= now - 90 * DAY) sold90 += units;
          if (inPeriod) soldU += units;
        }
        if (!inPeriod || m.delta === 0) continue;
        if (m.delta > 0) {
          if (m.reason === 'received' || m.note === SQUARE_NOTE) { t.received += val; t.receivedU += units; }
        } else if (m.reason === 'sale') { t.online += val; t.onlineU += units; }
        else if (m.note === SQUARE_NOTE) { t.store += val; t.storeU += units; }
        else { t.other += val; t.otherU += units; }
      }
      const perDay = sold30 / 30;
      const daysLeft = perDay > 0 ? Math.floor(Math.max(qty, 0) / perDay) : null;
      const needsRestock = tracked && (qty <= 0 || qty <= lowLevel || (daysLeft !== null && daysLeft < 14));
      const target = Math.max(Math.ceil(perDay * 30), lowLevel * 2);
      rows.push({
        id: v.id,
        product: p.name,
        size: vars.length > 1 || (v.name && v.name !== 'Regular') ? v.name : '',
        section: SECTIONS.some(s => s.id === sec) ? sec : 'other',
        category: (p.category as Category | undefined)?.name ?? '',
        price: v.price_cents,
        tracked,
        qty,
        value: tracked ? Math.max(qty, 0) * v.price_cents : 0,
        soldU,
        soldV: soldU * v.price_cents,
        sold30,
        perDay,
        daysLeft,
        needsRestock,
        orderQty: needsRestock ? Math.max(target - Math.max(qty, 0), 1) : 0,
        slow: tracked && qty > 0 && sold90 === 0,
      });
    }
  }

  const tracked = rows.filter(r => r.tracked);
  const stockValue = tracked.reduce((s, r) => s + r.value, 0);
  const stockUnits = tracked.reduce((s, r) => s + Math.max(r.qty, 0), 0);
  const restock = rows.filter(r => r.needsRestock);
  const outCount = restock.filter(r => r.qty <= 0).length;
  const slow = rows.filter(r => r.slow);
  const slowValue = slow.reduce((s, r) => s + r.value, 0);
  const soldValue = t.online + t.store;
  const soldUnits = t.onlineU + t.storeU;
  const periodText = days ? `last ${PERIODS.find(p => p.days === days)?.label}` : 'all time';

  const bySection = SECTIONS.map(s => {
    const list = rows.filter(r => r.section === s.id);
    const tr = list.filter(r => r.tracked);
    return {
      ...s,
      items: list.length,
      trackedItems: tr.length,
      units: tr.reduce((a, r) => a + Math.max(r.qty, 0), 0),
      value: tr.reduce((a, r) => a + r.value, 0),
      sold: list.reduce((a, r) => a + r.soldV, 0),
      restock: list.filter(r => r.needsRestock).length,
    };
  }).filter(s => s.items > 0);

  const restockTop = [...restock].sort((a, b) =>
    (a.qty <= 0 ? 0 : 1) - (b.qty <= 0 ? 0 : 1) || b.sold30 - a.sold30 || a.qty - b.qty).slice(0, 8);
  const bestTop = rows.filter(r => r.soldU > 0).sort((a, b) => b.soldU - a.soldU || b.soldV - a.soldV).slice(0, 8);

  // ---- Table filtering ----
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = rows.filter(r => {
    if (section !== 'all' && r.section !== section) return false;
    if (status === 'restock' && !r.needsRestock) return false;
    if (status === 'out' && !(r.tracked && r.qty <= 0)) return false;
    if (status === 'instock' && !(r.tracked && r.qty > 0)) return false;
    if (status === 'slow' && !r.slow) return false;
    if (status === 'untracked' && r.tracked) return false;
    const hay = `${r.product} ${r.size} ${r.category}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }).sort((a, b) => {
    switch (sort) {
      case 'value': return b.value - a.value;
      case 'stock': return (b.tracked ? b.qty : -1) - (a.tracked ? a.qty : -1);
      case 'sold': return b.soldU - a.soldU;
      case 'days': return (a.tracked ? a.daysLeft ?? 1e9 : 2e9) - (b.tracked ? b.daysLeft ?? 1e9 : 2e9);
      default: return a.product.localeCompare(b.product) || a.size.localeCompare(b.size);
    }
  });

  const jumpTo = (st: StatusFilter, sec: Section | 'all' = 'all') => {
    setStatus(st);
    setSection(sec);
    document.getElementById('inv-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const card = 'bg-white rounded-2xl shadow-card p-5 sm:p-6';
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${active ? 'bg-tpl-forest text-white' : 'bg-tpl-cream text-gray-600 hover:text-tpl-forest'}`;

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;
  if (!stores.length) {
    return (
      <div className={`${card} text-center py-12`}>
        <Boxes className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">{error || 'Add a store first, then come back to set stock levels.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className={card}>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-gray-500">
            Store
            <select value={storeId} onChange={e => setStoreId(e.target.value)}
              className="block mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="text-xs text-gray-500">
            Sales period
            <div className="flex flex-wrap gap-1 mt-1">
              {PERIODS.map(p => <button key={p.days} onClick={() => setDays(p.days)} className={chip(days === p.days)}>{p.label}</button>)}
            </div>
          </div>
          <label className="text-xs text-gray-500" title="Items at or below this count are flagged to restock">
            Low stock at
            <input type="number" min={0} value={lowLevel} onChange={e => setLowLevel(Math.max(0, Number(e.target.value) || 0))}
              className="block mt-1 w-20 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </label>
          {stockLoading && <Loader2 className="h-5 w-5 animate-spin text-tpl-forest mb-2" />}
        </div>
        {error && <p className="text-sm text-red-600 mt-3">Could not load stock: {error}</p>}
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile tone="dark" icon={<Wallet className="h-4 w-4" />} label="Stock value now" value={formatPrice(stockValue)}
          sub={`${stockUnits.toLocaleString()} units · ${tracked.length} items counted`} />
        <Tile tone="green" icon={<TrendingUp className="h-4 w-4" />} label={`Sold · ${periodText}`} value={formatPrice(soldValue)}
          sub={`${soldUnits.toLocaleString()} units sold`} />
        <Tile tone="red" icon={<AlertTriangle className="h-4 w-4" />} label="Need restocking" value={String(restock.length)}
          sub={`${outCount} out of stock · tap to see`} onClick={() => jumpTo('restock')} />
        <Tile tone="amber" icon={<Snail className="h-4 w-4" />} label="Slow stock (no sale 90 days)" value={formatPrice(slowValue)}
          sub={`${slow.length} item${slow.length === 1 ? '' : 's'} · tap to see`} onClick={() => jumpTo('slow')} />
      </div>

      {/* By section */}
      <div className={card}>
        <h2 className="font-semibold text-tpl-dark mb-3">By section</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {bySection.map(s => (
            <button key={s.id} onClick={() => jumpTo('all', s.id)}
              className="text-left rounded-xl border border-gray-100 hover:border-tpl-forest/40 hover:bg-tpl-cream/50 p-4 transition-colors">
              <p className="flex items-center gap-2 font-semibold text-tpl-dark"><s.icon className="h-4 w-4 text-tpl-forest" />{s.label}</p>
              <p className="text-2xl font-bold text-tpl-dark mt-1">{s.units.toLocaleString()} <span className="text-sm font-medium text-gray-500">in stock</span></p>
              <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-gray-500">Stock value</dt><dd className="text-right font-semibold">{formatPrice(s.value)}</dd>
                <dt className="text-gray-500">Sold ({days ? PERIODS.find(p => p.days === days)?.label : 'all'})</dt><dd className="text-right font-semibold">{formatPrice(s.sold)}</dd>
                <dt className="text-gray-500">Items counted</dt><dd className="text-right">{s.trackedItems} of {s.items}</dd>
                <dt className="text-gray-500">Need restock</dt>
                <dd className={`text-right font-semibold ${s.restock ? 'text-red-600' : 'text-gray-400'}`}>{s.restock}</dd>
              </dl>
            </button>
          ))}
        </div>
      </div>

      {/* Restock + best sellers */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-tpl-dark flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-600" />Restock now</h2>
            {restock.length > 0 && <button onClick={() => jumpTo('restock')} className="text-xs font-semibold text-tpl-forest hover:underline">See all {restock.length}</button>}
          </div>
          {restockTop.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing needs restocking. Items you count stock for will appear here when they run low.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {restockTop.map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-tpl-dark">{r.product}{r.size && <span className="text-gray-500"> · {r.size}</span>}</p>
                    <p className="text-xs text-gray-500">
                      {r.qty <= 0 ? <span className="text-red-600 font-semibold">Out of stock</span> : `${r.qty} left`}
                      {r.sold30 > 0 && ` · sells ~${r.sold30}/month`}
                    </p>
                  </div>
                  <span className="text-xs font-semibold bg-red-50 text-red-700 rounded-lg px-2 py-1 whitespace-nowrap">Order ~{r.orderQty}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={card}>
          <h2 className="font-semibold text-tpl-dark mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-tpl-forest" />Best sellers · {periodText}</h2>
          {bestTop.length === 0 ? (
            <p className="text-sm text-gray-400">No sales recorded in this period.</p>
          ) : (
            <ol className="space-y-2">
              {bestTop.map((r, i) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="w-4 text-right text-xs text-gray-400">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate text-tpl-dark">{r.product}{r.size && <span className="text-gray-500"> · {r.size}</span>}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{r.soldU} sold</span>
                    <span className="w-20 text-right font-semibold">{formatPrice(r.soldV)}</span>
                  </div>
                  <div className="ml-6 mt-1 h-1.5 rounded-full bg-tpl-cream overflow-hidden">
                    <div className="h-full bg-tpl-forest/70 rounded-full" style={{ width: `${(r.soldU / bestTop[0].soldU) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-xs">
            <Mini icon={<ShoppingBag className="h-3.5 w-3.5" />} label="Online" units={t.onlineU} value={t.online} />
            <Mini icon={<StoreIcon className="h-3.5 w-3.5" />} label="In store" units={t.storeU} value={t.store} />
            <Mini icon={<PackageMinus className="h-3.5 w-3.5" />} label="Other out" units={t.otherU} value={t.other} />
          </div>
        </div>
      </div>

      {/* All items */}
      <div id="inv-table" className={`${card} scroll-mt-4`}>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-semibold text-tpl-dark mr-auto">All items</h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, size or category"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select value={section} onChange={e => setSection(e.target.value as Section | 'all')}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
            <option value="all">All sections</option>
            {SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {([
            ['all', 'All'], ['restock', `Need restock (${restock.length})`], ['out', 'Out of stock'],
            ['instock', 'In stock'], ['slow', 'Slow'], ['untracked', 'Not counted'],
          ] as [StatusFilter, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} className={chip(status === k)}>{l}</button>
          ))}
          <label className="ml-auto text-xs text-gray-500 flex items-center gap-1">
            Sort
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
              <option value="name">Name</option>
              <option value="value">Stock value</option>
              <option value="stock">Quantity</option>
              <option value="sold">Most sold</option>
              <option value="days">Running out first</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-400 mb-2">{filtered.length} item{filtered.length === 1 ? '' : 's'}. Type a number in "In stock" and press Save to start counting an item.</p>

        <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_80px_160px_100px_90px_90px_120px_64px] gap-3 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
          <span>Item</span><span className="text-right">Price</span><span>In stock</span><span className="text-right">Value</span>
          <span className="text-right">Sold</span><span className="text-right">Lasts</span><span>Status</span><span />
        </div>
        <div className="divide-y divide-gray-100">
          {filtered.slice(0, shown).map(r => {
            const draft = drafts[r.id];
            const saving = savingId === r.id;
            return (
              <div key={r.id}>
                <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_80px_160px_100px_90px_90px_120px_64px] gap-x-3 gap-y-1.5 items-center px-3 py-2.5 text-sm">
                  <div className="col-span-2 lg:col-span-1 min-w-0">
                    <p className="font-medium text-tpl-dark truncate">{r.product}{r.size && <span className="text-gray-500"> · {r.size}</span>}</p>
                    <p className="text-xs text-gray-400 truncate">{SECTIONS.find(s => s.id === r.section)?.label}{r.category && ` · ${r.category}`}</p>
                  </div>
                  <Cell label="Price" className="lg:text-right">{formatPrice(r.price)}</Cell>
                  <Cell label="In stock">
                    <span className="inline-flex items-center gap-1.5">
                      <input type="number" min={0} inputMode="numeric"
                        value={draft !== undefined ? draft : r.tracked ? String(r.qty) : ''}
                        placeholder="—" aria-label={`Stock for ${r.product} ${r.size}`}
                        onChange={e => setDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveQty(r.id); }}
                        className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                      <button onClick={() => saveQty(r.id)} disabled={saving || draft === undefined}
                        className="text-xs px-2 py-1 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid disabled:opacity-30">
                        {saving ? '…' : 'Save'}
                      </button>
                    </span>
                  </Cell>
                  <Cell label="Value" className="lg:text-right font-semibold">{r.tracked ? formatPrice(r.value) : '—'}</Cell>
                  <Cell label={`Sold (${days ? PERIODS.find(p => p.days === days)?.label : 'all'})`} className="lg:text-right">{r.soldU || '—'}</Cell>
                  <Cell label="Lasts" className="lg:text-right">
                    {!r.tracked ? '—' : r.qty <= 0 ? '0 days' : r.daysLeft === null ? 'No sales' : r.daysLeft > 365 ? '1 yr+' : `${r.daysLeft} days`}
                  </Cell>
                  <Cell label="Status"><StatusBadge row={r} /></Cell>
                  <div className="flex items-center justify-end gap-1 col-span-2 lg:col-span-1">
                    <button onClick={() => setOpenId(id => (id === r.id ? null : r.id))} title="Add received stock, history & age"
                      className={`p-1.5 rounded-lg ${openId === r.id ? 'text-tpl-forest bg-tpl-cream' : 'text-gray-400 hover:text-tpl-forest'}`}>
                      <HistoryIcon className="h-4 w-4" />
                    </button>
                    {r.tracked && (
                      <button onClick={() => untrack(r.id)} disabled={saving} title="Stop counting this item"
                        className="p-1.5 text-gray-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>
                {openId === r.id && (
                  <Details row={r} moves={moves[r.id] ?? []} saving={saving} onClose={() => setOpenId(null)}
                    addQty={addQty} setAddQty={setAddQty} addDate={addDate} setAddDate={setAddDate}
                    addNote={addNote} setAddNote={setAddNote} onAdd={() => addStock(r.id)} />
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No items match.</p>}
        </div>
        {filtered.length > shown && (
          <button onClick={() => setShown(n => n + PAGE)}
            className="mt-3 w-full flex items-center justify-center gap-1 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            <ChevronDown className="h-4 w-4" />Show more ({filtered.length - shown} left)
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400 px-1">
        Money values use each item's current selling price. Only items with a stock count are included in stock value.
        In-store sales and stock added in Square appear after each Square sync. "Lasts" and "Order ~" are based on the last 30 days of sales.
      </p>
    </div>
  );
}

function Tile({ tone, icon, label, value, sub, onClick }: {
  tone: 'dark' | 'green' | 'red' | 'amber'; icon: React.ReactNode; label: string; value: string; sub: string; onClick?: () => void;
}) {
  const tones = {
    dark: 'bg-tpl-forest text-white',
    green: 'bg-green-50 text-green-800',
    red: 'bg-red-50 text-red-800',
    amber: 'bg-amber-50 text-amber-800',
  };
  const Box = onClick ? 'button' : 'div';
  return (
    <Box onClick={onClick} className={`text-left rounded-2xl px-4 py-3 ${tones[tone]} ${onClick ? 'hover:ring-2 hover:ring-current/20 transition' : ''}`}>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide opacity-80">{icon}{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
      <p className="text-xs opacity-75">{sub}</p>
    </Box>
  );
}

function Mini({ icon, label, units, value }: { icon: React.ReactNode; label: string; units: number; value: number }) {
  return (
    <div className="rounded-lg bg-tpl-cream px-2 py-1.5">
      <p className="flex items-center gap-1 text-gray-500">{icon}{label}</p>
      <p className="font-semibold text-tpl-dark">{formatPrice(value)}</p>
      <p className="text-gray-400">{units} units</p>
    </div>
  );
}

function Cell({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-2 lg:block ${className}`}>
      <span className="lg:hidden text-xs text-gray-400">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function StatusBadge({ row }: { row: Row }) {
  const b = (cls: string, text: string) => <span className={`inline-block text-xs font-semibold rounded-lg px-2 py-0.5 ${cls}`}>{text}</span>;
  if (!row.tracked) return b('bg-gray-100 text-gray-500', 'Not counted');
  if (row.qty <= 0) return b('bg-red-100 text-red-700', 'Out of stock');
  if (row.needsRestock) return b('bg-amber-100 text-amber-800', `Low · order ~${row.orderQty}`);
  if (row.slow) return b('bg-orange-50 text-orange-700', 'Slow');
  return b('bg-green-100 text-green-700', 'OK');
}

function Details({ row, moves, saving, onClose, addQty, setAddQty, addDate, setAddDate, addNote, setAddNote, onAdd }: {
  row: Row; moves: Move[]; saving: boolean; onClose: () => void;
  addQty: string; setAddQty: (v: string) => void; addDate: string; setAddDate: (v: string) => void;
  addNote: string; setAddNote: (v: string) => void; onAdd: () => void;
}) {
  const ag = computeAging(moves);
  const input = 'block mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime';
  return (
    <div className="mx-3 mb-3 border border-tpl-forest/20 rounded-xl bg-tpl-cream/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-tpl-dark">{row.product}{row.size && ` · ${row.size}`}</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Age cls="bg-white text-tpl-dark" label="In stock" n={row.tracked ? row.qty : '—'} />
        <Age cls="bg-green-50 text-green-700" label="Under 1 month old" n={ag.fresh} />
        <Age cls="bg-amber-50 text-amber-700" label="1–3 months old" n={ag.mid} />
        <Age cls="bg-red-50 text-red-700" label="Over 3 months old" n={ag.old} />
      </div>
      <div className="rounded-xl bg-white border border-gray-100 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-tpl-dark mb-2"><PackagePlus className="h-4 w-4 text-tpl-forest" />Add received stock</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-gray-500">Quantity
            <input type="number" min={1} value={addQty} onChange={e => setAddQty(e.target.value)} placeholder="0" className={`${input} w-24`} />
          </label>
          <label className="text-[11px] text-gray-500">Received on
            <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className={input} />
          </label>
          <label className="text-[11px] text-gray-500 flex-1 min-w-[140px]">Note (optional)
            <input value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Supplier, batch #…" className={`${input} w-full`} />
          </label>
          <button onClick={onAdd} disabled={saving}
            className="text-xs px-3 py-1.5 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid disabled:opacity-40">
            {saving ? '…' : 'Add stock'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">Leave the date blank to use today. The age figures above use the received date.</p>
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-tpl-dark mb-2"><Clock className="h-4 w-4 text-tpl-forest" />History</p>
        {moves.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No stock changes recorded yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 bg-white rounded-xl px-3">
            {moves.map(m => (
              <div key={m.id} className="flex items-center gap-3 py-1.5 text-xs">
                <span className={`font-bold w-12 text-right ${m.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-tpl-dark">
                    {m.note === SQUARE_NOTE ? (m.delta < 0 ? 'In-store sale (Square)' : 'Added in Square') : REASON_LABEL[m.reason] ?? m.reason}
                  </span>
                  {m.received_at && <span className="text-gray-400"> · received {new Date(m.received_at).toLocaleDateString()}</span>}
                  {m.note && m.note !== SQUARE_NOTE && <span className="text-gray-400"> · {m.note}</span>}
                </span>
                <span className="text-gray-400 whitespace-nowrap">
                  {new Date(m.created_at).toLocaleDateString()}{m.creator?.full_name ? ` · ${m.creator.full_name}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Age({ cls, label, n }: { cls: string; label: string; n: number | string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-bold">{n}</p>
    </div>
  );
}
