import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Tag, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Product, ProductVariation, Store, formatPrice } from '../lib/types';
import { useCart } from '../contexts/CartContext';
import LoadingSpinner from '../components/LoadingSpinner';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariation, setSelectedVariation] = useState<ProductVariation | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const store: Store | null = (location.state as any)?.store ?? null;

  useEffect(() => {
    if (!id) return;
    supabase
      .from('products')
      .select('*, category:categories(*), variations:product_variations(*)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        setProduct(data);
        if (data?.variations?.length) setSelectedVariation(data.variations[0]);
        setLoading(false);
      });
  }, [id]);

  const handleAdd = () => {
    if (!selectedVariation || !store || !product) return;
    addItem({
      variation_id: selectedVariation.id,
      product_id: product.id,
      product_name: product.name,
      variation_name: selectedVariation.name,
      price_cents: selectedVariation.price_cents,
      quantity: qty,
      image_url: product.image_url,
    }, store);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  if (loading) return <div className="min-h-screen bg-tpl-cream flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!product) return <div className="min-h-screen bg-tpl-cream flex items-center justify-center"><p className="text-gray-500">Product not found.</p></div>;

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-tpl-forest hover:text-tpl-mid text-sm font-medium mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Shop
        </button>

        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Image */}
            <div className="aspect-square bg-tpl-cream flex items-center justify-center">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Tag className="h-24 w-24 text-tpl-mid/30" />
              )}
            </div>

            {/* Details */}
            <div className="p-8 flex flex-col">
              {product.category && (
                <span className="text-xs font-semibold text-tpl-mid bg-tpl-pale px-2 py-1 rounded-full self-start mb-3">
                  {product.category.name}
                </span>
              )}
              <h1 className="font-display text-2xl font-bold text-tpl-dark mb-3">{product.name}</h1>
              {product.description && (
                <p className="text-gray-600 text-sm leading-relaxed mb-6">{product.description}</p>
              )}

              {/* Variation Selector */}
              {product.variations && product.variations.length > 1 && (
                <div className="mb-5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Size / Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {product.variations.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVariation(v)}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${selectedVariation?.id === v.id ? 'border-tpl-forest bg-tpl-pale text-tpl-forest' : 'border-gray-200 text-gray-600 hover:border-tpl-mid'}`}
                      >
                        <div>{v.name}</div>
                        <div className="font-bold text-tpl-forest mt-0.5">{formatPrice(v.price_cents)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedVariation && (
                <div className="mb-6">
                  <span className="text-3xl font-bold text-tpl-forest">{formatPrice(selectedVariation.price_cents)}</span>
                  <span className="text-sm text-gray-400 ml-2">AUD</span>
                </div>
              )}

              {/* Quantity + Add */}
              {store ? (
                <div className="flex items-center gap-4 mt-auto">
                  <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                    <button onClick={() => setQty(q => Math.max(1, q - 1))} className="px-3 py-2 text-gray-500 hover:bg-gray-50 text-lg font-bold">−</button>
                    <span className="px-4 py-2 text-sm font-semibold min-w-[2.5rem] text-center">{qty}</span>
                    <button onClick={() => setQty(q => q + 1)} className="px-3 py-2 text-gray-500 hover:bg-gray-50 text-lg font-bold">+</button>
                  </div>
                  <button
                    onClick={handleAdd}
                    disabled={!selectedVariation}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-semibold text-sm transition-all ${added ? 'bg-tpl-lime text-tpl-dark' : 'bg-tpl-forest text-white hover:bg-tpl-mid'} disabled:opacity-40`}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    {added ? 'Added to Cart!' : 'Add to Cart'}
                  </button>
                </div>
              ) : (
                <div className="bg-tpl-pale/60 rounded-xl p-4 text-center mt-auto">
                  <p className="text-sm text-tpl-forest">Select a store on the <button onClick={() => navigate('/')} className="underline font-semibold">shop page</button> to add items.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
