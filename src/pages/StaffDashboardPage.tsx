import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Clock, MapPin, ChevronRight, RefreshCw, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Order, OrderStatus, formatPrice } from '../lib/types';
import OrderStatusBadge from '../components/OrderStatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';

const STATUS_FLOW: Record<OrderStatus, OrderStatus | null> = {
  new: 'in_progress',
  in_progress: 'ready',
  ready: 'completed',
  completed: null,
  cancelled: null,
};

const STATUS_NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  new: 'Mark In Progress',
  in_progress: 'Mark Ready',
  ready: 'Mark Completed',
};

export default function StaffDashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('orders')
      .select('*, store:stores(name, address), order_items(*)')
      .order('created_at', { ascending: false });

    if (filterStatus !== 'all') query = query.eq('status', filterStatus);

    const { data } = await query;
    setOrders(data ?? []);
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const advanceStatus = async (order: Order) => {
    const next = STATUS_FLOW[order.status];
    if (!next) return;
    setUpdating(order.id);
    await supabase.from('orders').update({ status: next }).eq('id', order.id);
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: next } : o));
    setUpdating(null);
  };

  const cancelOrder = async (orderId: string) => {
    if (!window.confirm('Cancel this order?')) return;
    setUpdating(orderId);
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o));
    setUpdating(null);
  };

  const statusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-tpl-dark">Staff Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">Manage incoming orders for your store</p>
          </div>
          <button onClick={fetchOrders} className="flex items-center gap-2 px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {(['new', 'in_progress', 'ready', 'completed'] as OrderStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}
              className={`bg-white rounded-2xl shadow-card p-4 text-left transition-all hover:shadow-card-hover ${filterStatus === s ? 'ring-2 ring-tpl-forest' : ''}`}
            >
              <p className="text-2xl font-bold text-tpl-forest">{statusCounts[s] ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1 capitalize">{s.replace('_', ' ')}</p>
            </button>
          ))}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 mb-5">
          <Filter className="h-4 w-4 text-gray-400" />
          {(['all', 'new', 'in_progress', 'ready', 'completed', 'cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filterStatus === s ? 'bg-tpl-forest text-white' : 'bg-white text-gray-500 hover:bg-tpl-cream border border-gray-200'}`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-card p-12 text-center">
            <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No orders found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl shadow-card overflow-hidden">
                <div
                  className="p-5 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <OrderStatusBadge status={order.status} />
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${order.fulfillment_type === 'DELIVERY' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {order.fulfillment_type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 font-mono truncate">#{order.id.slice(0, 8)}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(order.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {order.scheduled_time && (
                        <span className="text-tpl-forest font-medium">
                          Scheduled: {new Date(order.scheduled_time).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-bold text-tpl-forest">{formatPrice(order.total_cents)}</span>
                    <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${expandedOrder === order.id ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {expandedOrder === order.id && (
                  <div className="border-t border-gray-100 px-5 pb-5 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Items</h4>
                        <div className="space-y-1.5">
                          {(order.order_items ?? []).map(item => (
                            <div key={item.id} className="flex justify-between text-sm">
                              <span className="text-gray-700">{item.name_snapshot} × {item.qty}</span>
                              <span className="text-tpl-dark font-medium">{formatPrice(item.unit_price_cents * item.qty)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {order.fulfillment_type === 'DELIVERY' && order.delivery_address && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> Delivery Address
                          </h4>
                          <p className="text-sm text-gray-700">
                            {order.delivery_address.street}<br />
                            {order.delivery_address.suburb}, {order.delivery_address.state} {order.delivery_address.postcode}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-4">
                      {STATUS_NEXT_LABEL[order.status] && (
                        <button
                          onClick={() => advanceStatus(order)}
                          disabled={updating === order.id}
                          className="px-4 py-2 bg-tpl-forest text-white text-xs font-semibold rounded-lg hover:bg-tpl-mid transition-colors disabled:opacity-50"
                        >
                          {updating === order.id ? 'Updating…' : STATUS_NEXT_LABEL[order.status]}
                        </button>
                      )}
                      {order.status !== 'cancelled' && order.status !== 'completed' && (
                        <button
                          onClick={() => cancelOrder(order.id)}
                          disabled={updating === order.id}
                          className="px-4 py-2 border border-red-300 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
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
