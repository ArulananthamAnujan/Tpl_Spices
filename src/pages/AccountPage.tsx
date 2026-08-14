import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, RotateCcw, ChevronRight, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Order, formatPrice } from '../lib/types';
import OrderStatusBadge from '../components/OrderStatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';

export default function AccountPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    supabase
      .from('orders')
      .select('*, store:stores(name, address), order_items(*)')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders(data ?? []); setLoading(false); });
  }, [user]);

  const handleReorder = (_order: Order) => {
    navigate('/');
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
                    <button
                      onClick={() => handleReorder(order)}
                      className="flex items-center gap-1.5 text-xs text-tpl-forest font-semibold hover:text-tpl-mid transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reorder
                    </button>
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
