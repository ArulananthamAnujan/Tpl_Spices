import { useState } from 'react';
import { Wallet, TrendingUp, PackageMinus, ShoppingBag, Store as StoreIcon } from 'lucide-react';
import { Product, formatPrice } from '../lib/types';

// Admin → Inventory: what the tracked stock in this store is worth, how much
// has gone out (online orders, in-store sales via Square, manual reductions),
// what came in, and which items sell the most. Values use each item's current
// selling price from the catalogue.

export interface SummaryMove {
  variation_id: string;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
}

interface Props {
  products: Product[];
  stock: Record<string, number>; // variation_id -> tracked quantity
  moves: Record<string, SummaryMove[]>; // variation_id -> movements
}

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'All time' },
];

const SQUARE_NOTE = 'Square inventory sync';

export default function InventorySummary({ products, stock, moves }: Props) {
  const [days, setDays] = useState(30);

  const info: Record<string, { name: string; price: number }> = {};
  for (const p of products) {
    for (const v of p.variations ?? []) {
      const multi = (p.variations ?? []).length > 1 && v.name && v.name !== 'Regular';
      info[v.id] = { name: multi ? `${p.name} — ${v.name}` : p.name, price: v.price_cents };
    }
  }
  const priceOf = (id: string) => info[id]?.price ?? 0;

  // Stock on hand right now.
  let stockValue = 0, stockUnits = 0, tracked = 0, outOfStock = 0, unpriced = 0;
  for (const [id, qty] of Object.entries(stock)) {
    if (!info[id]) continue;
    tracked++;
    if (qty <= 0) { outOfStock++; continue; }
    stockUnits += qty;
    stockValue += qty * priceOf(id);
    if (priceOf(id) === 0) unpriced++;
  }

  // Movements in the chosen period.
  const since = days ? Date.now() - days * 86400000 : 0;
  const t = { online: 0, onlineU: 0, store: 0, storeU: 0, other: 0, otherU: 0, received: 0, receivedU: 0 };
  const sold: Record<string, { units: number; value: number }> = {};
  for (const [id, list] of Object.entries(moves)) {
    if (!info[id]) continue;
    for (const m of list) {
      if (since && new Date(m.created_at).getTime() < since) continue;
      const value = Math.abs(m.delta) * priceOf(id);
      if (m.delta > 0) {
        if (m.reason === 'received' || m.note === SQUARE_NOTE) { t.received += value; t.receivedU += m.delta; }
        continue;
      }
      if (m.delta === 0) continue;
      const units = -m.delta;
      const isOnline = m.reason === 'sale';
      const isStore = !isOnline && m.note === SQUARE_NOTE;
      if (isOnline) { t.online += value; t.onlineU += units; }
      else if (isStore) { t.store += value; t.storeU += units; }
      else { t.other += value; t.otherU += units; }
      if (isOnline || isStore) {
        const s = (sold[id] = sold[id] ?? { units: 0, value: 0 });
        s.units += units;
        s.value += value;
      }
    }
  }
  const soldValue = t.online + t.store;
  const soldUnits = t.onlineU + t.storeU;
  const top = Object.entries(sold).sort((a, b) => b[1].units - a[1].units || b[1].value - a[1].value).slice(0, 10);
  const maxUnits = top[0]?.[1].units ?? 1;
  const periodText = days ? `last ${PERIODS.find(p => p.days === days)?.label}` : 'all time';

  const tile = 'rounded-xl px-4 py-3';
  const small = 'text-[11px] uppercase tracking-wide';

  return (
    <div className="bg-white rounded-2xl shadow-card p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-tpl-dark text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5 text-tpl-forest" />Money in stock &amp; sales
        </h2>
        <div className="flex flex-wrap gap-1">
          {PERIODS.map(p => (
            <button key={p.days} onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${days === p.days ? 'bg-tpl-forest text-white' : 'bg-tpl-cream text-gray-600 hover:text-tpl-forest'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`${tile} bg-tpl-forest text-white`}>
          <p className={`${small} text-white/70`}>Stock value now</p>
          <p className="text-2xl font-bold">{formatPrice(stockValue)}</p>
          <p className="text-xs text-white/70">{stockUnits.toLocaleString()} units · {tracked} items tracked</p>
        </div>
        <div className={`${tile} bg-green-50`}>
          <p className={`${small} text-green-700`}>Sold · {periodText}</p>
          <p className="text-2xl font-bold text-green-700">{formatPrice(soldValue)}</p>
          <p className="text-xs text-green-700/80">{soldUnits.toLocaleString()} units</p>
        </div>
        <div className={`${tile} bg-blue-50`}>
          <p className={`${small} text-blue-700`}>Stock received · {periodText}</p>
          <p className="text-2xl font-bold text-blue-700">{formatPrice(t.received)}</p>
          <p className="text-xs text-blue-700/80">{t.receivedU.toLocaleString()} units</p>
        </div>
        <div className={`${tile} bg-amber-50`}>
          <p className={`${small} text-amber-700`}>Out of stock</p>
          <p className="text-2xl font-bold text-amber-700">{outOfStock}</p>
          <p className="text-xs text-amber-700/80">tracked items at 0</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="text-sm font-semibold text-tpl-dark mb-2">Where the stock went · {periodText}</p>
          <div className="divide-y divide-gray-100 text-sm">
            <Row icon={<ShoppingBag className="h-4 w-4" />} label="Online orders" units={t.onlineU} value={t.online} />
            <Row icon={<StoreIcon className="h-4 w-4" />} label="In-store sales (Square)" units={t.storeU} value={t.store} />
            <Row icon={<PackageMinus className="h-4 w-4" />} label="Other reductions (manual edits, damage, etc.)" units={t.otherU} value={t.other} />
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-tpl-dark mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-tpl-forest" />Best sellers · {periodText}
          </p>
          {top.length === 0 ? (
            <p className="text-sm text-gray-400">No sales recorded in this period.</p>
          ) : (
            <ol className="space-y-1.5">
              {top.map(([id, s], i) => (
                <li key={id} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="w-5 text-right text-xs text-gray-400">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate text-tpl-dark">{info[id].name}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{s.units} sold</span>
                    <span className="w-20 text-right font-semibold whitespace-nowrap">{formatPrice(s.value)}</span>
                  </div>
                  <div className="ml-7 mt-0.5 h-1.5 rounded-full bg-tpl-cream overflow-hidden">
                    <div className="h-full bg-tpl-forest/70 rounded-full" style={{ width: `${(s.units / maxUnits) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Values use each item's current selling price. Only items with a tracked quantity are counted
        {unpriced > 0 && <> ({unpriced} in-stock item{unpriced === 1 ? ' has' : 's have'} no price, so add $0)</>}.
        In-store sales and stock added in Square come from the Square stock sync, so they show up after each sync.
      </p>
    </div>
  );
}

function Row({ icon, label, units, value }: { icon: React.ReactNode; label: string; units: number; value: number }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="text-tpl-forest">{icon}</span>
      <span className="flex-1 text-gray-700">{label}</span>
      <span className="text-xs text-gray-500 whitespace-nowrap">{units.toLocaleString()} units</span>
      <span className="w-24 text-right font-semibold whitespace-nowrap">{formatPrice(value)}</span>
    </div>
  );
}
