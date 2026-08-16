import { useEffect, useState, useCallback } from 'react';
import { Star, Loader2, Trash2, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Review = {
  id: string;
  customer_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  created_at: string;
  reviewer?: { full_name: string | null } | null;
};

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  const px = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`${px} ${i <= Math.round(value) ? 'text-amber-400 fill-current' : 'text-gray-300'}`}
        />
      ))}
    </span>
  );
}

export default function ProductReviews({ productId }: { productId: string }) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('product_reviews')
      .select('id, customer_id, rating, title, body, created_at, reviewer:profiles(full_name)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    // PostgREST types the embedded profile as an array; it's a single row here.
    setReviews((data as unknown as Review[]) ?? []);
    setLoading(false);
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  // Prefill the form when the shopper already reviewed this product.
  const mine = reviews.find(r => r.customer_id === user?.id);
  useEffect(() => {
    if (mine) { setRating(mine.rating); setTitle(mine.title ?? ''); setBody(mine.body ?? ''); }
  }, [mine?.id]);

  const count = reviews.length;
  const average = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  const spread = [5, 4, 3, 2, 1].map(star => ({
    star,
    n: reviews.filter(r => r.rating === star).length,
  }));

  const submit = async () => {
    if (rating < 1) { setError('Pick a star rating first.'); return; }
    setSaving(true); setError('');
    const { error: err } = await supabase
      .from('product_reviews')
      .upsert(
        { product_id: productId, customer_id: user!.id, rating, title: title.trim() || null, body: body.trim() || null },
        { onConflict: 'product_id,customer_id' },
      );
    if (err) setError(err.message);
    else await load();
    setSaving(false);
  };

  const removeMine = async () => {
    if (!mine || !window.confirm('Delete your review?')) return;
    setSaving(true);
    const { error: err } = await supabase.from('product_reviews').delete().eq('id', mine.id);
    if (err) setError(err.message);
    else { setRating(0); setTitle(''); setBody(''); await load(); }
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-card border border-tpl-dark/8 p-6 mt-6">
      <h2 className="font-display text-lg font-bold text-tpl-dark mb-4 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-tpl-forest" /> Ratings &amp; reviews
      </h2>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-tpl-forest" /></div>
      ) : (
        <>
          {/* Summary */}
          {count > 0 && (
            <div className="flex flex-wrap items-center gap-6 pb-5 mb-5 border-b border-gray-100">
              <div className="text-center">
                <p className="text-3xl font-bold text-tpl-dark">{average.toFixed(1)}</p>
                <Stars value={average} />
                <p className="text-xs text-gray-400 mt-1">{count} review{count !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex-1 min-w-[180px] space-y-1">
                {spread.map(s => (
                  <div key={s.star} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500 w-6">{s.star}★</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400" style={{ width: count ? `${(s.n / count) * 100}%` : '0%' }} />
                    </div>
                    <span className="text-gray-400 w-6 text-right">{s.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Write a review */}
          {user ? (
            <div className="mb-6">
              <p className="text-sm font-semibold text-tpl-dark mb-2">
                {mine ? 'Your review' : 'Write a review'}
              </p>
              <div className="flex items-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <button key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>
                    <Star className={`h-6 w-6 transition-colors ${i <= (hover || rating) ? 'text-amber-400 fill-current' : 'text-gray-300 hover:text-amber-300'}`} />
                  </button>
                ))}
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)"
                className="w-full mb-2 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={3}
                placeholder="What did you think of this product?"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
              {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
              <div className="flex items-center gap-3 mt-3">
                <button onClick={submit} disabled={saving}
                  className="px-4 py-2 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-50">
                  {saving ? 'Saving…' : mine ? 'Update review' : 'Submit review'}
                </button>
                {mine && (
                  <button onClick={removeMine} disabled={saving}
                    className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-6">
              <a href="/auth" className="text-tpl-forest font-semibold hover:underline">Sign in</a> to leave a review.
            </p>
          )}

          {/* Existing reviews */}
          {count === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No reviews yet — be the first to review this product.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {reviews.map(r => (
                <div key={r.id} className="py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Stars value={r.rating} />
                    <span className="text-sm font-medium text-tpl-dark">{r.reviewer?.full_name || 'Customer'}</span>
                    {r.customer_id === user?.id && (
                      <span className="text-[10px] bg-tpl-pale text-tpl-forest px-1.5 py-0.5 rounded-full font-semibold">You</span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {r.title && <p className="text-sm font-semibold text-tpl-dark">{r.title}</p>}
                  {r.body && <p className="text-sm text-gray-600 leading-relaxed">{r.body}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
