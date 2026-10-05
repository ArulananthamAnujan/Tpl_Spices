import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import JsBarcode from 'jsbarcode';
import { Search, Printer, Download, Trash2, ScanLine, Wand2, Loader2, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatPrice } from '../lib/types';

// Admin tool: a separate list of label products (its own tables, not the
// Square-synced shop catalogue), each with a barcode — the pack's own or a
// generated in-store EAN-13 — printed on an A4 sticker sheet or a label
// printer roll. Any USB or Bluetooth scanner reads the printed codes.

interface Biz { business_name: string; address: string; phone: string }

interface LabelProduct {
  id: string;
  name: string;
  price_cents: number;
  category: string | null;
  barcode: string;
}

type PaperMode = 'sheet' | 'roll';

const QTY_KEY = 'tpl-labels-qty';
const PAPER_KEY = 'tpl-labels-paper';
const MAX_LABELS = 1000;

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const eanCheckDigit = (d: string) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10;
};

// 200–299 prefixes are reserved for in-store use, so these never clash with
// a manufacturer's barcode.
const randomStoreCode = () => {
  const base = '200' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  return base + eanCheckDigit(base);
};

const validateCode = (code: string): string | null => {
  if (/^\d{13}$/.test(code) && Number(code[12]) !== eanCheckDigit(code)) {
    return 'That 13-digit code has a wrong check digit. Re-check the number or leave it blank.';
  }
  if (!/^[\x20-\x7e]+$/.test(code)) return 'Use letters, numbers and basic symbols only.';
  return null;
};

function BarcodeSvg({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, code, {
        format: /^\d{13}$/.test(code) ? 'EAN13' : 'CODE128',
        width: 2, height: 40, fontSize: 12, margin: 0, displayValue: true,
      });
      setBad(false);
    } catch {
      setBad(true);
    }
  }, [code]);
  return bad ? <span className="text-xs text-red-600">Invalid code</span> : <svg ref={ref} />;
}

function Label({ product, biz }: { product: LabelProduct; biz: Biz }) {
  const addr = [biz.address, biz.phone].filter(Boolean).join(' · ');
  return (
    <div className="shop-label">
      <div className="sl-biz">{biz.business_name || 'Your business name'}</div>
      {addr && <div className="sl-addr">{addr}</div>}
      <BarcodeSvg code={product.barcode} />
      <div className="sl-name">{product.name}</div>
      <div className="sl-price">{formatPrice(product.price_cents)}</div>
    </div>
  );
}

export default function BarcodeLabelsPanel() {
  const [biz, setBiz] = useState<Biz>({ business_name: '', address: '', phone: '' });
  const [bizStatus, setBizStatus] = useState('');
  const bizLoaded = useRef(false);
  const skipNextSave = useRef(false);

  const [products, setProducts] = useState<LabelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState<Record<string, number>>(() => readJson(QTY_KEY, {}));
  const [paper, setPaper] = useState<{ mode: PaperMode; w: number; h: number }>(() =>
    readJson(PAPER_KEY, { mode: 'sheet' as PaperMode, w: 50, h: 30 }));

  const [form, setForm] = useState({ name: '', price: '', category: '', code: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const [scanValue, setScanValue] = useState('');
  const [scanResult, setScanResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => writeJson(QTY_KEY, qty), [qty]);
  useEffect(() => writeJson(PAPER_KEY, paper), [paper]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const rows: LabelProduct[] = [];
    // Read in pages — Supabase returns at most 1000 rows per query.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('label_products')
        .select('id, name, price_cents, category, barcode')
        .order('name')
        .range(from, from + 999);
      if (error) { setLoadError(error.message); break; }
      rows.push(...((data as LabelProduct[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    setProducts(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProducts();
    supabase.from('label_settings').select('business_name, address, phone').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data) { skipNextSave.current = true; setBiz(data as Biz); }
        bizLoaded.current = true;
      });
  }, [loadProducts]);

  // Save business details shortly after typing stops.
  useEffect(() => {
    if (!bizLoaded.current) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setBizStatus('Saving…');
    const t = setTimeout(async () => {
      const { error } = await supabase.from('label_settings')
        .upsert({ id: 1, ...biz, updated_at: new Date().toISOString() });
      setBizStatus(error ? `Not saved: ${error.message}` : 'Saved');
    }, 600);
    return () => clearTimeout(t);
  }, [biz]);

  const generateCode = () => {
    let code = randomStoreCode();
    for (let n = 0; n < 50 && products.some(p => p.barcode === code); n++) code = randomStoreCode();
    setForm(f => ({ ...f, code }));
  };

  const addProduct = async () => {
    setFormError('');
    const name = form.name.trim();
    if (!name) { setFormError('Enter a product name.'); return; }
    let code = form.code.trim();
    if (!code) {
      code = randomStoreCode();
      for (let n = 0; n < 50 && products.some(p => p.barcode === code); n++) code = randomStoreCode();
    }
    const problem = validateCode(code);
    if (problem) { setFormError(problem); return; }
    if (products.some(p => p.barcode === code)) { setFormError('That barcode is already used by another product.'); return; }

    setSaving(true);
    const { data, error } = await supabase.from('label_products').insert({
      name,
      price_cents: Math.round((parseFloat(form.price) || 0) * 100),
      category: form.category.trim() || null,
      barcode: code,
    }).select('id, name, price_cents, category, barcode').single();
    setSaving(false);
    if (error) {
      setFormError(error.code === '23505' ? 'That barcode is already used by another product.' : error.message);
      return;
    }
    const created = data as LabelProduct;
    setProducts(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setQty(q => ({ ...q, [created.id]: 1 }));
    setForm({ name: '', price: '', category: '', code: '' });
    nameRef.current?.focus();
  };

  const deleteProduct = async (p: LabelProduct) => {
    if (!confirm(`Delete "${p.name}" from the label list?`)) return;
    const { error } = await supabase.from('label_products').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    setProducts(prev => prev.filter(x => x.id !== p.id));
    setQty(q => { const next = { ...q }; delete next[p.id]; return next; });
  };

  const runScan = () => {
    const code = scanValue.trim();
    setScanValue('');
    if (!code) return;
    const p = products.find(x => x.barcode === code);
    setScanResult(p ? { ok: true, text: `${p.name} — ${formatPrice(p.price_cents)}` } : { ok: false, text: `No product with code ${code}` });
  };

  const downloadCsv = () => {
    const rows = [['name', 'price', 'category', 'barcode'],
      ...products.map(p => [p.name, (p.price_cents / 100).toFixed(2), p.category ?? '', p.barcode])];
    const text = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'label-products.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const labels: LabelProduct[] = [];
  for (const p of products) {
    for (let k = 0; k < (qty[p.id] ?? 0) && labels.length < MAX_LABELS; k++) labels.push(p);
  }

  // Labels sent to the printer: the whole list, or just one product when its
  // row's Print button is used.
  const [printOnly, setPrintOnly] = useState<LabelProduct[] | null>(null);
  const printLabels = printOnly ?? labels;

  const print = (only?: LabelProduct[]) => {
    flushSync(() => setPrintOnly(only ?? null));
    document.body.classList.add('printing-labels');
    const done = () => {
      document.body.classList.remove('printing-labels');
      window.removeEventListener('afterprint', done);
      setPrintOnly(null);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const pageCss = paper.mode === 'roll'
    ? `@page{size:${paper.w}mm ${paper.h}mm;margin:0}`
    : '@page{size:A4;margin:10mm}';

  const visible = products.filter(p => {
    const f = filter.trim().toLowerCase();
    return !f || p.name.toLowerCase().includes(f) || p.barcode.includes(f) || (p.category ?? '').toLowerCase().includes(f);
  });

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-tpl-forest/30';
  const cardCls = 'bg-white rounded-2xl shadow-card p-5';
  const labelCls = 'block text-xs text-gray-500 mt-3 mb-1';

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* Left column */}
      <div className="space-y-6">
        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark">Business details</h2>
          <label className={labelCls}>Business name</label>
          <input className={inputCls} value={biz.business_name} onChange={e => setBiz({ ...biz, business_name: e.target.value })} />
          <label className={labelCls}>Address</label>
          <textarea className={inputCls} rows={2} placeholder="Street, suburb, state, postcode"
            value={biz.address} onChange={e => setBiz({ ...biz, address: e.target.value })} />
          <label className={labelCls}>Phone (optional)</label>
          <input className={inputCls} value={biz.phone} onChange={e => setBiz({ ...biz, phone: e.target.value })} />
          <p className="text-xs text-gray-400 mt-2">Appears on every label. {bizStatus}</p>
        </div>

        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark">New product</h2>
          <label className={labelCls}>Product name</label>
          <input ref={nameRef} className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Price ($)</label>
              <input className={inputCls} type="number" step="0.01" min="0" inputMode="decimal"
                value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <input className={inputCls} placeholder="optional" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
            </div>
          </div>
          <label className={labelCls}>Barcode number</label>
          <div className="flex gap-2">
            <input className={`${inputCls} font-mono`} placeholder="Leave blank to generate" inputMode="numeric"
              value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') addProduct(); }} />
            <button type="button" onClick={generateCode}
              className="flex items-center gap-1 px-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:text-tpl-forest">
              <Wand2 className="h-4 w-4" />Generate
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Blank = a new 13-digit store code. Or type/scan an existing code from the pack.</p>
          {formError && <p className="text-xs text-red-600 mt-2">{formError}</p>}
          <button onClick={addProduct} disabled={saving}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-tpl-forest text-white text-sm font-semibold hover:bg-tpl-mid disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Save product
          </button>
        </div>

        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark mb-3 flex items-center gap-2"><ScanLine className="h-4 w-4" />Test a scan</h2>
          <input className={inputCls} placeholder="Click here, then scan a label" autoComplete="off"
            value={scanValue} onChange={e => setScanValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runScan(); }} />
          {scanResult && (
            <p className={`mt-2 text-sm font-semibold ${scanResult.ok ? 'text-tpl-forest' : 'text-red-600'}`}>{scanResult.text}</p>
          )}
        </div>
      </div>

      {/* Right column */}
      <div className="space-y-6 min-w-0">
        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="font-semibold text-tpl-dark">Products ({products.length})</h2>
            {products.length > 0 && (
              <div className="relative w-full sm:w-64">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${inputCls} pl-9`} placeholder="Search saved products"
                  value={filter} onChange={e => setFilter(e.target.value)} />
              </div>
            )}
          </div>
          {loading ? (
            <p className="text-sm text-gray-400 py-3">Loading…</p>
          ) : loadError ? (
            <p className="text-sm text-red-600 py-3">Could not load label products: {loadError}</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">No products yet. Save your first product on the left.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-2">Product</th><th className="py-2 pr-2">Price</th>
                    <th className="py-2 pr-2">Barcode</th><th className="py-2 pr-2">Labels</th><th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(p => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-tpl-dark">{p.name}</div>
                        {p.category && <div className="text-xs text-gray-400">{p.category}</div>}
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">{formatPrice(p.price_cents)}</td>
                      <td className="py-2 pr-2 font-mono text-xs whitespace-nowrap">{p.barcode}</td>
                      <td className="py-2 pr-2">
                        <input type="number" min={0} max={500} value={qty[p.id] ?? 0}
                          aria-label={`Labels for ${p.name}`}
                          onChange={e => setQty(q => ({ ...q, [p.id]: Math.max(0, Math.min(500, parseInt(e.target.value) || 0)) }))}
                          className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-sm" />
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <button onClick={() => print(Array(Math.max(1, qty[p.id] ?? 0)).fill(p))}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-tpl-pale text-tpl-forest text-xs font-semibold hover:bg-tpl-lime/40"
                          title={`Print ${Math.max(1, qty[p.id] ?? 0)} label(s) for this product only`}>
                          <Printer className="h-3.5 w-3.5" />Print {Math.max(1, qty[p.id] ?? 0)}
                        </button>
                        <button onClick={() => deleteProduct(p)} className="p-1.5 text-gray-400 hover:text-red-600" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">
            Saved products stay here. To print more later, search for the product, set the number of labels and press its Print button,
            or set numbers for several products and use Print below.
          </p>

          <div className="grid sm:grid-cols-3 gap-3 mt-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Paper</label>
              <select className={inputCls} value={paper.mode} onChange={e => setPaper({ ...paper, mode: e.target.value as PaperMode })}>
                <option value="sheet">A4 sticker sheet (3 across)</option>
                <option value="roll">Label printer roll (one label per page)</option>
              </select>
            </div>
            {paper.mode === 'roll' && (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Width (mm)</label>
                  <input type="number" min={20} className={inputCls} value={paper.w}
                    onChange={e => setPaper({ ...paper, w: Math.max(20, Number(e.target.value) || 50) })} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Height (mm)</label>
                  <input type="number" min={15} className={inputCls} value={paper.h}
                    onChange={e => setPaper({ ...paper, h: Math.max(15, Number(e.target.value) || 30) })} />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => print()} disabled={labels.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-tpl-forest text-white text-sm font-semibold hover:bg-tpl-mid disabled:opacity-40">
              <Printer className="h-4 w-4" />Print {labels.length} label{labels.length === 1 ? '' : 's'}
            </button>
            <button onClick={downloadCsv} disabled={products.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              <Download className="h-4 w-4" />Download CSV
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            If the print dialog does not open, press Ctrl+P (Cmd+P on Mac). Set margins to None and scale to 100%.
            {labels.length >= MAX_LABELS && ` Only the first ${MAX_LABELS} labels are printed at once.`}
          </p>
        </div>

        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark mb-3">Label preview</h2>
          {labels.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">Labels will appear here.</p>
          ) : (
            <div className="shop-label-preview">
              {labels.slice(0, 60).map((p, k) => <Label key={k} product={p} biz={biz} />)}
            </div>
          )}
          {labels.length > 60 && <p className="text-xs text-gray-400 mt-2">Showing 60 of {labels.length}. All will print.</p>}
        </div>
      </div>

      {createPortal(
        <div id="label-print-root" className={paper.mode === 'roll' ? 'roll' : 'sheet'}
          style={{ ['--lw' as string]: `${paper.w}mm`, ['--lh' as string]: `${paper.h}mm` }}>
          <style>{pageCss}</style>
          {printLabels.map((p, k) => <Label key={k} product={p} biz={biz} />)}
        </div>,
        document.body,
      )}
    </div>
  );
}
