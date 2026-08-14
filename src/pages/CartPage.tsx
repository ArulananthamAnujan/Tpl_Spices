import { useNavigate } from 'react-router-dom';
import { Trash2, Plus, Minus, ShoppingBag, ArrowLeft, Store } from 'lucide-react';
import { useCart } from '../contexts/CartContext';
import { formatPrice } from '../lib/types';

export default function CartPage() {
  const { items, store, removeItem, updateQty, totalCents, itemCount } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-tpl-cream flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="bg-tpl-pale rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
            <ShoppingBag className="h-12 w-12 text-tpl-mid" />
          </div>
          <h2 className="font-display text-2xl font-bold text-tpl-dark mb-3">Your cart is empty</h2>
          <p className="text-gray-500 text-sm mb-6">Add items from the shop to get started.</p>
          <button onClick={() => navigate('/')} className="px-6 py-3 bg-tpl-forest text-white rounded-xl font-semibold hover:bg-tpl-mid transition-colors">
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-tpl-forest hover:text-tpl-mid text-sm font-medium mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Continue Shopping
        </button>

        <h1 className="font-display text-3xl font-bold text-tpl-dark mb-8">Your Cart</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Items */}
          <div className="lg:col-span-2 space-y-3">
            {/* Store Info */}
            {store && (
              <div className="bg-tpl-pale/60 border border-tpl-pale rounded-xl px-4 py-3 flex items-center gap-2 mb-4">
                <Store className="h-4 w-4 text-tpl-forest flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Picking up / delivering from</p>
                  <p className="text-sm font-semibold text-tpl-forest">{store.name}</p>
                </div>
              </div>
            )}

            {items.map(item => (
              <div key={item.variation_id} className="bg-white rounded-2xl shadow-card p-4 flex items-center gap-4">
                {/* Thumbnail */}
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-tpl-cream flex-shrink-0">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ShoppingBag className="h-6 w-6 text-tpl-mid/40" />
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-tpl-dark text-sm truncate">{item.product_name}</h3>
                  <p className="text-xs text-gray-400">{item.variation_name}</p>
                  <p className="text-tpl-forest font-bold text-sm mt-1">{formatPrice(item.price_cents)}</p>
                </div>

                {/* Qty Controls */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => updateQty(item.variation_id, item.quantity - 1)}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                  <button
                    onClick={() => updateQty(item.variation_id, item.quantity + 1)}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                {/* Subtotal + Remove */}
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-tpl-forest">{formatPrice(item.price_cents * item.quantity)}</p>
                  <button onClick={() => removeItem(item.variation_id)} className="mt-1 text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div>
            <div className="bg-white rounded-2xl shadow-card p-6 sticky top-24">
              <h2 className="font-semibold text-tpl-dark text-lg mb-4">Order Summary</h2>
              <div className="space-y-2 mb-4 text-sm">
                {items.map(item => (
                  <div key={item.variation_id} className="flex justify-between text-gray-600">
                    <span className="truncate mr-2">{item.product_name} × {item.quantity}</span>
                    <span className="flex-shrink-0">{formatPrice(item.price_cents * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-3 mb-6">
                <div className="flex justify-between font-bold text-tpl-dark">
                  <span>Subtotal</span>
                  <span className="text-tpl-forest text-lg">{formatPrice(totalCents)}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Delivery fee calculated at checkout</p>
              </div>
              <button
                onClick={() => navigate('/checkout')}
                className="w-full py-3 bg-tpl-forest text-white font-semibold rounded-xl hover:bg-tpl-mid transition-colors"
              >
                Proceed to Checkout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
