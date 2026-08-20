import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Leaf, ShieldCheck, Truck, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store } from '../lib/types';

export default function AboutPage() {
  const [stores, setStores] = useState<Store[]>([]);

  useEffect(() => {
    supabase.from('stores').select('*').order('name').then(({ data }) => setStores(data ?? []));
  }, []);

  return (
    <div className="min-h-screen bg-tpl-cream">
      {/* Hero */}
      <div className="bg-gradient-to-r from-tpl-dark via-tpl-forest to-tpl-mid py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="font-display text-3xl sm:text-4xl text-white font-bold leading-tight">
            Melbourne's home for <span className="text-tpl-lime">Sri Lankan &amp; Indian</span> groceries
          </h1>
          <p className="text-tpl-pale/80 mt-4 text-sm sm:text-base max-w-xl mx-auto">
            TPL Spices &amp; Groceries brings authentic pantry staples, spice blends, and everyday essentials to
            Melbourne households — sourced with the same care we'd want on our own shelves at home.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
        {/* Story */}
        <section>
          <h2 className="font-display text-2xl font-bold text-tpl-dark mb-4">Our story</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            TPL Spices &amp; Groceries started with a simple idea: Melbourne's Sri Lankan and Indian community
            deserved a grocer that carried the specific brands, spice blends, and rice varieties they grew up
            with — not just a generic "international aisle." From spices and lentils to rice, condiments, and
            everyday pantry staples, we stock what your kitchen actually needs, backed by people who know the
            difference between one curry powder and another.
          </p>
        </section>

        {/* Trust points */}
        <section>
          <h2 className="font-display text-2xl font-bold text-tpl-dark mb-4">Why shop with us</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl shadow-card p-5">
              <Leaf className="h-5 w-5 text-tpl-forest mb-3" />
              <h3 className="font-semibold text-tpl-dark text-sm mb-1">Genuinely sourced</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                We stock the authentic regional brands our customers ask for by name, not substitutes.
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow-card p-5">
              <ShieldCheck className="h-5 w-5 text-tpl-forest mb-3" />
              <h3 className="font-semibold text-tpl-dark text-sm mb-1">Secure checkout</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                Payments are processed by Square — we never see or store your full card details.
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow-card p-5">
              <Truck className="h-5 w-5 text-tpl-forest mb-3" />
              <h3 className="font-semibold text-tpl-dark text-sm mb-1">Pickup or delivery</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                Order online and collect in store, or get it delivered locally where available.
              </p>
            </div>
          </div>
        </section>

        {/* Stores */}
        <section>
          <h2 className="font-display text-2xl font-bold text-tpl-dark mb-4">Visit a store</h2>
          {stores.length === 0 ? (
            <p className="text-sm text-gray-500">Store details coming soon.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {stores.map(store => (
                <div key={store.id} className="bg-white rounded-2xl shadow-card p-5">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-tpl-lime mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-tpl-dark text-sm">{store.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{store.address}</p>
                      <div className="flex gap-2 mt-2">
                        {store.pickup_enabled && <span className="text-xs bg-tpl-pale text-tpl-forest px-2 py-0.5 rounded-full font-medium">Pickup</span>}
                        {store.delivery_enabled && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Delivery</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* CTA */}
        <section className="bg-white rounded-2xl shadow-card p-8 text-center">
          <h2 className="font-display text-xl font-bold text-tpl-dark mb-2">Ready to shop?</h2>
          <p className="text-sm text-gray-500 mb-5">Browse spices, groceries, and more from your nearest store.</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-tpl-forest text-white font-semibold rounded-xl hover:bg-tpl-mid transition-colors"
          >
            Shop Now <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
