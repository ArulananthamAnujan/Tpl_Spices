import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, MapPin, Clock, Truck, Store as StoreIcon, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { FulfillmentType, DeliveryAddress, formatPrice, Store } from '../lib/types';
import { effectiveUnitCents } from '../lib/pricing';
import LoadingSpinner from '../components/LoadingSpinner';

const SQUARE_ENV = import.meta.env.VITE_SQUARE_ENV === 'production' ? 'production' : 'sandbox';
const SQUARE_SDK_URL = SQUARE_ENV === 'production'
  ? 'https://web.squarecdn.com/v1/square.js'
  : 'https://sandbox.web.squarecdn.com/v1/square.js';

function loadSquareSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).Square) { resolve((window as any).Square); return; }
    const existing = document.querySelector(`script[src="${SQUARE_SDK_URL}"]`) as HTMLScriptElement | null;
    const onLoad = () => (window as any).Square ? resolve((window as any).Square) : reject(new Error('Square SDK loaded but is unavailable.'));
    const onError = () => reject(new Error('Square SDK failed to load.'));
    if (existing) {
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = SQUARE_SDK_URL;
    script.async = true;
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.appendChild(script);
  });
}

export default function CheckoutPage() {
  const { items, store, selectStore, totalCents, clearCart } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stores, setStores] = useState<Store[]>([]);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('PICKUP');
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({ street: '', suburb: '', state: 'VIC', postcode: '' });
  const [scheduledTime, setScheduledTime] = useState('');
  const [notes, setNotes] = useState('');
  const [cardError, setCardError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [squareReady, setSquareReady] = useState(false);
  const cardRef = useRef<any>(null);
  const paymentsRef = useRef<any>(null);

  const deliveryFeeCents = fulfillmentType === 'DELIVERY' ? (store?.delivery_fee_cents ?? 0) : 0;
  const grandTotalCents = totalCents + deliveryFeeCents;

  useEffect(() => {
    if (items.length === 0) { navigate('/cart'); return; }
    if (!user) { navigate('/auth'); return; }
  }, [items, user]);

  useEffect(() => {
    supabase.from('stores').select('*').order('name').then(({ data }) => {
      setStores(data ?? []);
    });
  }, []);

  useEffect(() => {
    if (!store || !items.length) return;
    const appId = import.meta.env.VITE_SQUARE_APP_ID as string | undefined;
    if (!appId) {
      setCardError(`Payments aren't configured yet — set VITE_SQUARE_APP_ID (currently running in ${SQUARE_ENV} mode).`);
      return;
    }
    const init = async () => {
      try {
        const SquareSdk = await loadSquareSdk();
        const payments = SquareSdk.payments(appId, store.square_location_id);
        paymentsRef.current = payments;
        const card = await payments.card();
        await card.attach('#card-container');
        cardRef.current = card;
        setSquareReady(true);
      } catch (err: any) {
        setCardError('Could not initialise payment form. ' + (err.message || ''));
      }
    };
    init();
  }, [store]);

  useEffect(() => {
    if (store) {
      if (!store.delivery_enabled && store.pickup_enabled) setFulfillmentType('PICKUP');
      if (!store.pickup_enabled && store.delivery_enabled) setFulfillmentType('DELIVERY');
    }
  }, [store]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardRef.current || !store || !user) return;
    setError('');
    setSubmitting(true);

    try {
      const tokenResult = await cardRef.current.tokenize();
      if (tokenResult.status !== 'OK') {
        setError(tokenResult.errors?.[0]?.message ?? 'Card tokenisation failed.');
        setSubmitting(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-order`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            store_id: store.id,
            fulfillment_type: fulfillmentType,
            items: items.map(i => ({ variation_id: i.variation_id, qty: i.quantity, name_snapshot: `${i.product_name} – ${i.variation_name}` })),
            delivery_address: fulfillmentType === 'DELIVERY' ? deliveryAddress : null,
            scheduled_time: scheduledTime || null,
            notes: notes || null,
            payment_token: tokenResult.token,
          }),
        }
      );

      const body = await res.json();
      if (!res.ok || body.error) {
        setError(body.error || 'Order failed. Please try again.');
        setSubmitting(false);
        return;
      }

      clearCart();
      setOrderId(body.order_id);
    } catch (err: any) {
      setError(err.message || 'Unexpected error.');
      setSubmitting(false);
    }
  };

  if (orderId) {
    return (
      <div className="min-h-screen bg-tpl-cream flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-card p-10 max-w-md w-full text-center">
          <div className="bg-tpl-pale w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="h-10 w-10 text-tpl-mid" />
          </div>
          <h2 className="font-display text-2xl font-bold text-tpl-dark mb-2">Order Placed!</h2>
          <p className="text-gray-500 text-sm mb-1">Your order has been received.</p>
          <p className="text-xs text-gray-400 font-mono break-all mb-6">#{orderId}</p>
          <div className="flex gap-3">
            <button onClick={() => navigate('/account')} className="flex-1 py-3 bg-tpl-forest text-white rounded-xl font-semibold hover:bg-tpl-mid transition-colors text-sm">
              View Orders
            </button>
            <button onClick={() => navigate('/')} className="flex-1 py-3 border border-tpl-forest text-tpl-forest rounded-xl font-semibold hover:bg-tpl-cream transition-colors text-sm">
              Keep Shopping
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!store) return null;

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate('/cart')} className="flex items-center gap-2 text-tpl-forest hover:text-tpl-mid text-sm font-medium mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Cart
        </button>
        <h1 className="font-display text-3xl font-bold text-tpl-dark mb-8">Checkout</h1>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              {/* Pickup Location */}
              {stores.length > 1 && (
                <div className="bg-white rounded-2xl shadow-card p-6">
                  <h2 className="font-semibold text-tpl-dark mb-4 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-tpl-forest" /> Pickup Location
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {stores.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => selectStore(s)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${store?.id === s.id ? 'border-tpl-forest bg-tpl-pale/50' : 'border-gray-200 hover:border-tpl-mid'}`}
                      >
                        <p className="font-semibold text-sm text-tpl-dark">{s.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.address}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fulfillment */}
              <div className="bg-white rounded-2xl shadow-card p-6">
                <h2 className="font-semibold text-tpl-dark mb-4">Fulfillment Method</h2>
                <div className="grid grid-cols-2 gap-3">
                  {store.pickup_enabled && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType('PICKUP')}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${fulfillmentType === 'PICKUP' ? 'border-tpl-forest bg-tpl-pale/50' : 'border-gray-200 hover:border-tpl-mid'}`}
                    >
                      <StoreIcon className={`h-5 w-5 mb-2 ${fulfillmentType === 'PICKUP' ? 'text-tpl-forest' : 'text-gray-400'}`} />
                      <p className="font-semibold text-sm text-tpl-dark">Pickup</p>
                      <p className="text-xs text-gray-500 mt-0.5">Collect in store</p>
                    </button>
                  )}
                  {store.delivery_enabled && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType('DELIVERY')}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${fulfillmentType === 'DELIVERY' ? 'border-tpl-forest bg-tpl-pale/50' : 'border-gray-200 hover:border-tpl-mid'}`}
                    >
                      <Truck className={`h-5 w-5 mb-2 ${fulfillmentType === 'DELIVERY' ? 'text-tpl-forest' : 'text-gray-400'}`} />
                      <p className="font-semibold text-sm text-tpl-dark">Delivery</p>
                      <p className="text-xs text-gray-500 mt-0.5">Within {store.delivery_radius_km}km</p>
                    </button>
                  )}
                </div>
              </div>

              {/* Delivery Address */}
              {fulfillmentType === 'DELIVERY' && (
                <div className="bg-white rounded-2xl shadow-card p-6">
                  <h2 className="font-semibold text-tpl-dark mb-4 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-tpl-forest" /> Delivery Address
                  </h2>
                  <div className="space-y-3">
                    <input required value={deliveryAddress.street} onChange={e => setDeliveryAddress(a => ({ ...a, street: e.target.value }))} placeholder="Street address" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                    <div className="grid grid-cols-2 gap-3">
                      <input required value={deliveryAddress.suburb} onChange={e => setDeliveryAddress(a => ({ ...a, suburb: e.target.value }))} placeholder="Suburb" className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                      <input required value={deliveryAddress.postcode} onChange={e => setDeliveryAddress(a => ({ ...a, postcode: e.target.value }))} placeholder="Postcode" className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                    </div>
                    <select value={deliveryAddress.state} onChange={e => setDeliveryAddress(a => ({ ...a, state: e.target.value }))} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime bg-white">
                      {['VIC','NSW','QLD','SA','WA','TAS','ACT','NT'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Scheduled Time */}
              <div className="bg-white rounded-2xl shadow-card p-6">
                <h2 className="font-semibold text-tpl-dark mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-tpl-forest" />
                  {fulfillmentType === 'PICKUP' ? 'Pickup Time' : 'Delivery Time'} <span className="text-gray-400 text-xs font-normal">(optional)</span>
                </h2>
                <input
                  type="datetime-local"
                  value={scheduledTime}
                  onChange={e => setScheduledTime(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                />
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Special instructions (optional)"
                  rows={2}
                  className="w-full mt-3 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime resize-none"
                />
              </div>

              {/* Payment */}
              <div className="bg-white rounded-2xl shadow-card p-6">
                <h2 className="font-semibold text-tpl-dark mb-4 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-tpl-forest" /> Payment
                </h2>
                {!squareReady && !cardError && (
                  <div className="flex items-center gap-3 py-6 justify-center text-gray-400">
                    <LoadingSpinner size="sm" /> <span className="text-sm">Loading payment form…</span>
                  </div>
                )}
                <div id="card-container" className={squareReady ? '' : 'hidden'} />
                {cardError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mt-3">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-700">{cardError}</p>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            {/* Order Summary */}
            <div>
              <div className="bg-white rounded-2xl shadow-card p-6 sticky top-24">
                <h2 className="font-semibold text-tpl-dark mb-4">Order Summary</h2>
                <div className="space-y-2 mb-4">
                  {items.map(item => (
                    <div key={item.variation_id} className="flex justify-between text-sm">
                      <span className="text-gray-600 truncate mr-2">{item.product_name} ×{item.quantity}</span>
                      <span className="text-tpl-dark font-medium flex-shrink-0">{formatPrice(effectiveUnitCents(item, item.quantity) * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Subtotal</span><span>{formatPrice(totalCents)}</span>
                  </div>
                  {fulfillmentType === 'DELIVERY' && (
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Delivery</span>
                      <span className="text-tpl-forest">{deliveryFeeCents > 0 ? formatPrice(deliveryFeeCents) : 'Free'}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-tpl-dark border-t border-gray-100 pt-2">
                    <span>Total</span>
                    <span className="text-tpl-forest text-lg">{formatPrice(grandTotalCents)}</span>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting || !squareReady}
                  className="mt-6 w-full py-3.5 bg-tpl-forest text-white font-semibold rounded-xl hover:bg-tpl-mid transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <><LoadingSpinner size="sm" light /><span>Processing…</span></> : `Pay ${formatPrice(grandTotalCents)}`}
                </button>
                <p className="text-xs text-gray-400 text-center mt-3">
                  Powered by Square. Your card details are encrypted and secure.
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
