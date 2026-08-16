import { useEffect, useState } from 'react';
import {
  DollarSign, Package, AlertTriangle, TrendingUp, Users, Loader2, Boxes, Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Order, formatPrice } from '../lib/types';

type LowStock = { name: string; variation: string; store: string; qty: number };
type TopSeller = { name: string; units: number; revenue: number };

// At-a-glance health of the business: today's takings, order pipeline,
// what's about to run out, and what's selling.
export default function OverviewPanel() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const [topSellers, setTopSellers] = useState<TopSeller[]>([]);
  const [customerCount, setCustomerCount] = useState(0);

  useEffect(() => {
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const [ordersRes, invRes, custRes] = await Promise.all([
        supabase
          .from('orders')
          .select('*, order_items(*)')
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('store_inventory')
          .select('quantity, variation:product_variations(name, product:products(name)), store:stores(name)')
          .lte('quantity', 5)
          .order('quantity'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
      ]);

      const os = (ordersRes.data as Order[]) ?? [];
      setOrders(os);
      setCustomerCount(custRes.count ?? 0);

      setLowStock(
        ((invRes.data as any[]) ?? []).map(r => ({
          name: r.variation?.product?.name ?? 'Unknown product',
          variation: r.variation?.name ?? '',
          store: r.store?.name ?? '',
          qty: r.quantity,
        })),
      );

      // Best sellers by units over the same window.
      const tally = new Map<string, TopSeller>();
      for (const o of os) {
        if (o.status === 'cancelled') continue;
        for (const it of o.order_items ?? []) {
          const row = tally.get(it.name_snapshot) ?? { name: it.name_snapshot, units: 0, revenue: 0 };
          row.units += it.qty;
          row.revenue += it.unit_price_cents * it.qty;
          tally.set(it.name_snapshot, row);
        }
      }
      setTopSellers([...tally.values()].sort((a, b) => b.units - a.units).slice(0, 8));
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const paid = orders.filter(o => o.status !== 'cancelled');
  const todays = paid.filter(o => new Date(o.created_at) >= startOfToday);
  const todayRevenue = todays.reduce((s, o) => s + o.total_cents, 0);
  const monthRevenue = paid.reduce((s, o) => s + o.total_cents, 0);
  const openOrders = orders.filter(o => o.status === 'new' || o.status === 'in_progress').length;
  const readyOrders = orders.filter(o => o.status === 'ready').length;
  const avgOrder = paid.length ? Math.round(monthRevenue / paid.length) : 0;

  const tiles = [
    { label: "Today's sales", value: formatPrice(todayRevenue), sub: `${todays.length} order${todays.length !== 1 ? 's' : ''}`, icon: DollarSign, tone: 'bg-green-50 text-green-700' },
    { label: 'Last 30 days', value: formatPrice(monthRevenue), sub: `${paid.length} orders · avg ${formatPrice(avgOrder)}`, icon: TrendingUp, tone: 'bg-tpl-pale text-tpl-forest' },
    { label: 'Needs action', value: String(openOrders), sub: `${readyOrders} ready for pickup`, icon: Package, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Customers', value: String(customerCount), sub: 'registered accounts', icon: Users, tone: 'bg-sky-50 text-sky-700' },
  ];

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="bg-white rounded-2xl shadow-card p-5">
            <div className="flex items-start justify-between">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{t.label}</p>
              <span className={`h-8 w-8 rounded-xl flex items-center justify-center ${t.tone}`}>
                <t.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="text-2xl font-bold text-tpl-dark mt-2">{t.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Low stock */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="px-5 py-3 bg-tpl-cream/50 border-b border-gray-100 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="font-semibold text-tpl-dark text-sm">Running low</h3>
            <span className="text-xs text-gray-400">· 5 or fewer left</span>
          </div>
          {lowStock.length === 0 ? (
            <div className="p-8 text-center">
              <Boxes className="h-10 w-10 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Nothing running low. Stock levels look healthy.</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {lowStock.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-tpl-dark truncate">{r.name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{r.variation}{r.store ? ` · ${r.store}` : ''}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${r.qty <= 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.qty <= 0 ? 'Out' : `${r.qty} left`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top sellers */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="px-5 py-3 bg-tpl-cream/50 border-b border-gray-100 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-tpl-forest" />
            <h3 className="font-semibold text-tpl-dark text-sm">Best sellers</h3>
            <span className="text-xs text-gray-400">· last 30 days</span>
          </div>
          {topSellers.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="h-10 w-10 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No sales yet in the last 30 days.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topSellers.map((t, i) => (
                <div key={t.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                  <p className="text-sm font-medium text-tpl-dark truncate flex-1">{t.name}</p>
                  <span className="text-xs text-gray-400">{t.units} sold</span>
                  <span className="text-sm font-semibold text-tpl-forest w-20 text-right">{formatPrice(t.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
