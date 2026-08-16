import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, RotateCcw, ChevronRight, Clock, Check, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Order, OrderStatus, formatPrice } from '../lib/types';
import { useCart } from '../contexts/CartContext';
import OrderStatusBadge from '../components/OrderStatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';

// Customer-facing progress for an order. Cancelled orders show their own state.
const TRACK_STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'new', label: 'Placed' },
  { key: 'in_progress', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
];

function OrderTracker({ status }: { status: OrderStatus }) {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        <AlertCircle className="h-4 w-4" /> This order was cancelled.
      </div>
    );
  }
  const current = TRACK_STEPS.findIndex(s => s.key === status);
  return (
    <div className="mb-5">
      <div className="flex items-center">
        {TRACK_STEPS.map((step, i) => {
          const done = i <= current;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                  done ? 'bg-tpl-forest text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={`text-[10px] mt-1 whitespace-nowrap ${done ? 'text-tpl-forest font-semibold' : 'text-gray-400'}`}>
                  {step.label}
                </span>
              </div>
              {i < TRACK_STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 -mt-4 ${i < current ? 'bg-tpl-forest' : 'bg-gray-100'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);
  const [reorderNote, setReorderNote] = useState<{ id: string; msg: string; bad?: boolean } | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    supabase
      .from('orders')
      .select('*, store:stores(name, address), order_items(*)')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders(data ?? []); setLoading(false); });
  }, [user]);

  // Rebuild the cart from a past order, re-checking today's prices, whether
  // each item is still listed, and stock at that store. Anything unavailable is
  // skipped and reported rather than silently dropped.
  const handleReorder = async (order: Order) => {
    setReordering(order.id);
    setReorderNote(null);

    const items = (order.order_items ?? []).filter(i => i.variation_id);
    const variationIds = items.map(i => i.variation_id as string);
    if (variationIds.length === 0) {
      setReorderNote({ id: order.id, msg: 'This order has no items that can be re-added.', bad: true });
      setReordering(null);
      return;
    }

    const [storeRes, varsRes, invRes] = await Promise.all([
      supabase.from('stores').select('*').eq('id', order.store_id).maybeSingle(),
      supabase
        .from('product_variations')
        .select('*, product:products(id, name, image_url, active)')
        .in('id', variationIds),
      supabase
        .from('store_inventory')
        .select('variation_id, quantity')
        .eq('store_id', order.store_id)
        .in('variation_id', variationIds),
    ]);

    const store = storeRes.data;
    if (!store) {
      setReorderNote({ id: order.id, msg: 'That store is no longer available.', bad: true });
      setReordering(null);
      return;
    }

    const varById = new Map((varsRes.data ?? []).map((v: any) => [v.id, v]));
    const stockById = new Map((invRes.data ?? []).map((r: any) => [r.variation_id, r.quantity]));

    let added = 0;
    const skipped: string[] = [];

    for (const item of items) {
      const v: any = varById.get(item.variation_id as string);
      if (!v || v.product?.active === false) { skipped.push(item.name_snapshot); continue; }

      const stock = stockById.get(item.variation_id as string);
      const qty = stock === undefined ? item.qty : Math.min(item.qty, stock);
      if (qty <= 0) { skipped.push(item.name_snapshot); continue; }

      addItem({
        variation_id: v.id,
        product_id: v.product_id,
        product_name: v.product?.name ?? item.name_snapshot,
        variation_name: v.name,
        price_cents: v.price_cents,
        quantity: qty,
        image_url: v.product?.image_url ?? null,
        wholesale_price_cents: v.wholesale_price_cents,
        wholesale_min_qty: v.wholesale_min_qty,
        promo_type: v.promo_type,
        promo_value: v.promo_value,
        promo_start: v.promo_start,
        promo_end: v.promo_end,
      }, store);
      added++;
    }

    setReordering(null);

    if (added === 0) {
      setReorderNote({ id: order.id, msg: 'None of these items are available right now.', bad: true });
      return;
    }
    if (skipped.length > 0) {
      setReorderNote({
        id: order.id,
        msg: `Added ${added} item${added > 1 ? 's' : ''}. Unavailable: ${skipped.join(', ')}.`,
      });
      return;
    }
    navigate('/cart');
  };

  if (loading) return <div className="min-h-screen bg-tpl-cream flex items-center justify-center"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-tpl-forest to-tpl-mid rounded-2xl p-6 mb-8 text-white">
          <h1 className="font-display text-2xl font-bold mb-1">My Account</h1>
          <p className="text-tpl-pale/80 text-sm">{profile?.full_name || 'Welcome back!'}</p>
        </div>

        <h2 className="font-semibold text-tpl-dark text-lg mb-4">Order History</h2>

        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-card p-12 text-center">
            <ShoppingBag className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="font-semibold text-gray-600 mb-2">No orders yet</h3>
            <p className="text-sm text-gray-400 mb-6">Your order history will appear here once you place your first order.</p>
            <button onClick={() => navigate('/')} className="px-6 py-2.5 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors">
              Start Shopping
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl shadow-card overflow-hidden">
                <button
                  className="w-full text-left p-5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                >
                  <div className="flex items-start gap-4">
                    <div className="bg-tpl-pale rounded-xl p-2.5 flex-shrink-0">
                      <ShoppingBag className="h-5 w-5 text-tpl-forest" />
                    </div>
                    <div>
                      <p className="font-semibold text-tpl-dark text-sm">
                        {order.store?.name ?? 'TPL Store'}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <OrderStatusBadge status={order.status} />
                        <span className="text-xs text-gray-400 capitalize">{order.fulfillment_type.toLowerCase()}</span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(order.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-bold text-tpl-forest">{formatPrice(order.total_cents)}</span>
                    <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${expandedOrder === order.id ? 'rotate-90' : ''}`} />
                  </div>
                </button>

                {expandedOrder === order.id && (
                  <div className="border-t border-gray-100 px-5 pb-5 pt-4">
                    <OrderTracker status={order.status} />
                    <div className="space-y-2 mb-4">
                      {(order.order_items ?? []).map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-gray-600">{item.name_snapshot} × {item.qty}</span>
                          <span className="text-tpl-dark font-medium">{formatPrice(item.unit_price_cents * item.qty)}</span>
                        </div>
                      ))}
                    </div>
                    {order.delivery_address && (
                      <p className="text-xs text-gray-400 mb-3">
                        Deliver to: {order.delivery_address.street}, {order.delivery_address.suburb} {order.delivery_address.postcode}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => handleReorder(order)}
                        disabled={reordering === order.id}
                        className="flex items-center gap-1.5 px-4 py-2 bg-tpl-forest text-white rounded-xl text-xs font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-50"
                      >
                        {reordering === order.id
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</>
                          : <><RotateCcw className="h-3.5 w-3.5" /> Buy these again</>}
                      </button>
                      {reorderNote?.id === order.id && (
                        <span className={`text-xs ${reorderNote.bad ? 'text-red-600' : 'text-tpl-forest'}`}>
                          {reorderNote.msg}
                          {!reorderNote.bad && (
                            <button onClick={() => navigate('/cart')} className="ml-1.5 underline font-semibold">View cart</button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
