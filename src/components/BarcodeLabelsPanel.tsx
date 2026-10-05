import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JsBarcode from 'jsbarcode';
import { Search, Printer, Download, Trash2, ScanLine, Wand2, Save, Loader2, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatPrice } from '../lib/types';

// Admin tool: give products a barcode (the pack's own, or a generated in-store
// EAN-13), then print shelf/pack labels on an A4 sticker sheet or a label
// printer roll. Any USB or Bluetooth scanner reads the printed codes.

interface Biz { name: string; addr: string; phone: string }

interface LabelItem {
  variationId: string;
  productName: string;
  variationName: string;
  priceCents: number;
  barcode: string | null;
  qty: number;
}

interface SearchRow {
  id: string;
  name: string;
  price_cents: number;
  barcode: string | null;
  product: { name: string } | { name: string }[] | null;
}

type PaperMode = 'sheet' | 'roll';

const BIZ_KEY = 'tpl-labels-biz';
const LIST_KEY = 'tpl-labels-list';
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
    return 'That 13-digit code has a wrong check digit. Re-check the number or generate one.';
  }
  if (!/^[\x20-\x7e]+$/.test(code)) return 'Use letters, numbers and basic symbols only.';
  return null;
};

const productNameOf = (row: SearchRow) =>
  (Array.isArray(row.product) ? row.product[0]?.name : row.product?.name) ?? 'Unknown';

function BarcodeSvg({ code, height = 40 }: { code: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, code, {
        format: /^\d{13}$/.test(code) ? 'EAN13' : 'CODE128',
        width: 2, height, fontSize: 12, margin: 0, displayValue: true,
      });
      setBad(false);
    } catch {
      setBad(true);
    }
  }, [code, height]);
  return bad ? <span className="text-xs text-red-600">Invalid code</span> : <svg ref={ref} />;
}

function Label({ item, biz }: { item: LabelItem; biz: Biz }) {
  const addr = [biz.addr, biz.phone].filter(Boolean).join(' · ');
  const showVariation = item.variationName && item.variationName !== 'Regular';
  return (
    <div className="shop-label">
      <div className="sl-biz">{biz.name || 'Your business name'}</div>
      {addr && <div className="sl-addr">{addr}</div>}
      {item.barcode && <BarcodeSvg code={item.barcode} />}
      <div className="sl-name">{item.productName}{showVariation ? ` — ${item.variationName}` : ''}</div>
      {item.priceCents > 0 && <div className="sl-price">{formatPrice(item.priceCents)}</div>}
    </div>
  );
}

export default function BarcodeLabelsPanel() {
  const [biz, setBiz] = useState<Biz>(() =>
    readJson<Biz>(BIZ_KEY, { name: 'TPL Spices & Groceries', addr: '', phone: '' }));
  const [items, setItems] = useState<LabelItem[]>(() => readJson<LabelItem[]>(LIST_KEY, []));
  const [paper, setPaper] = useState<{ mode: PaperMode; w: number; h: number }>(() =>
    readJson(PAPER_KEY, { mode: 'sheet' as PaperMode, w: 50, h: 30 }));

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [codeErrors, setCodeErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const [scanValue, setScanValue] = useState('');
  const [scanResult, setScanResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => writeJson(BIZ_KEY, biz), [biz]);
  useEffect(() => writeJson(LIST_KEY, items), [items]);
  useEffect(() => writeJson(PAPER_KEY, paper), [paper]);

  // Search by product name, or by an exact barcode (so a pack can be scanned
  // straight into the search box).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const select = 'id, name, price_cents, barcode, product:products!inner(name, active)';
      const [byName, byCode] = await Promise.all([
        supabase.from('product_variations').select(select)
          .eq('product.active', true).ilike('product.name', `%${q}%`).limit(40),
        supabase.from('product_variations').select(select).eq('barcode', q).limit(5),
      ]);
      if (cancelled) return;
      const seen = new Set<string>();
      const rows = [...(byCode.data ?? []), ...(byName.data ?? [])].filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }) as unknown as SearchRow[];
      rows.sort((a, b) => productNameOf(a).localeCompare(productNameOf(b)));
      setResults(rows);
      setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const addItem = (row: SearchRow) => {
    setItems(prev => prev.some(i => i.variationId === row.id)
      ? prev.map(i => i.variationId === row.id ? { ...i, qty: i.qty + 1 } : i)
      : [...prev, {
          variationId: row.id,
          productName: productNameOf(row),
          variationName: row.name,
          priceCents: row.price_cents,
          barcode: row.barcode,
          qty: 1,
        }]);
  };

  const setQty = (id: string, qty: number) =>
    setItems(prev => prev.map(i => i.variationId === id ? { ...i, qty: Math.max(0, Math.min(500, qty)) } : i));

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.variationId !== id));

  const generateCode = async (id: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomStoreCode();
      const { data } = await supabase.from('product_variations').select('id').eq('barcode', code).limit(1);
      if (!data?.length) {
        setCodeDrafts(d => ({ ...d, [id]: code }));
        setCodeErrors(e => ({ ...e, [id]: '' }));
        return;
      }
    }
    setCodeErrors(e => ({ ...e, [id]: 'Could not generate a free code — try again.' }));
  };

  const saveCode = async (id: string) => {
    const code = (codeDrafts[id] ?? '').trim();
    if (!code) { setCodeErrors(e => ({ ...e, [id]: 'Type or scan a code, or press Generate.' })); return; }
    const problem = validateCode(code);
    if (problem) { setCodeErrors(e => ({ ...e, [id]: problem })); return; }
    setSavingId(id);
    const { error } = await supabase.from('product_variations').update({ barcode: code }).eq('id', id);
    setSavingId(null);
    if (error) {
      const msg = error.code === '23505' ? 'That barcode is already used by another product.' : error.message;
      setCodeErrors(e => ({ ...e, [id]: msg }));
      return;
    }
    setItems(prev => prev.map(i => i.variationId === id ? { ...i, barcode: code } : i));
    setResults(prev => prev.map(r => r.id === id ? { ...r, barcode: code } : r));
    setCodeErrors(e => ({ ...e, [id]: '' }));
  };

  const clearCode = async (id: string) => {
    const { error } = await supabase.from('product_variations').update({ barcode: null }).eq('id', id);
    if (error) { setCodeErrors(e => ({ ...e, [id]: error.message })); return; }
    setItems(prev => prev.map(i => i.variationId === id ? { ...i, barcode: null } : i));
    setResults(prev => prev.map(r => r.id === id ? { ...r, barcode: null } : r));
  };

  const runScan = async () => {
    const code = scanValue.trim();
    setScanValue('');
    if (!code) return;
    const { data } = await supabase
      .from('product_variations')
      .select('id, name, price_cents, barcode, product:products(name)')
      .eq('barcode', code)
      .limit(1);
    const row = data?.[0] as unknown as SearchRow | undefined;
    setScanResult(row
      ? { ok: true, text: `${productNameOf(row)}${row.name !== 'Regular' ? ` (${row.name})` : ''} — ${row.price_cents > 0 ? formatPrice(row.price_cents) : 'price on request'}` }
      : { ok: false, text: `No product with code ${code}` });
  };

  const downloadCsv = () => {
    const rows = [['product', 'variation', 'price', 'barcode', 'labels'],
      ...items.map(i => [i.productName, i.variationName, (i.priceCents / 100).toFixed(2), i.barcode ?? '', String(i.qty)])];
    const text = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'barcode-labels.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Only items with a barcode get labels; expand by quantity, capped so a typo
  // in a quantity box can't render thousands of SVGs.
  const labels: LabelItem[] = [];
  for (const item of items) {
    if (!item.barcode) continue;
    for (let k = 0; k < item.qty && labels.length < MAX_LABELS; k++) labels.push(item);
  }
  const missingCodes = items.filter(i => !i.barcode).length;

  const print = () => {
    document.body.classList.add('printing-labels');
    const done = () => {
      document.body.classList.remove('printing-labels');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const pageCss = paper.mode === 'roll'
    ? `@page{size:${paper.w}mm ${paper.h}mm;margin:0}`
    : '@page{size:A4;margin:10mm}';

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-tpl-forest/30';
  const cardCls = 'bg-white rounded-2xl shadow-card p-5';

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* Left column */}
      <div className="space-y-6">
        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark mb-3">Business details</h2>
          <label className="block text-xs text-gray-500 mb-1">Business name</label>
          <input className={inputCls} value={biz.name} onChange={e => setBiz({ ...biz, name: e.target.value })} />
          <label className="block text-xs text-gray-500 mt-3 mb-1">Address</label>
          <textarea className={inputCls} rows={2} placeholder="Street, suburb, state, postcode"
            value={biz.addr} onChange={e => setBiz({ ...biz, addr: e.target.value })} />
          <label className="block text-xs text-gray-500 mt-3 mb-1">Phone (optional)</label>
          <input className={inputCls} value={biz.phone} onChange={e => setBiz({ ...biz, phone: e.target.value })} />
          <p className="text-xs text-gray-400 mt-2">Saved on this device. Appears on every label.</p>
        </div>

        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark mb-3">Find products</h2>
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={`${inputCls} pl-9`} placeholder="Product name or scan a barcode"
              value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-gray-100">
            {searching && <p className="text-sm text-gray-400 py-2">Searching…</p>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="text-sm text-gray-400 py-2">No products found.</p>
            )}
            {results.map(r => (
              <div key={r.id} className="flex items-center gap-2 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-tpl-dark truncate">{productNameOf(r)}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {r.name} · {r.price_cents > 0 ? formatPrice(r.price_cents) : 'on request'} · {r.barcode ?? 'no barcode'}
                  </p>
                </div>
                <button onClick={() => addItem(r)}
                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-tpl-pale text-tpl-forest hover:bg-tpl-lime/40">
                  <Plus className="h-3.5 w-3.5" />Add
                </button>
              </div>
            ))}
          </div>
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
          <h2 className="font-semibold text-tpl-dark mb-3">Labels to print</h2>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">No products yet. Find a product on the left and press Add.</p>
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
                  {items.map(i => (
                    <tr key={i.variationId} className="border-b border-gray-50 align-top">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-tpl-dark">{i.productName}</div>
                        {i.variationName !== 'Regular' && <div className="text-xs text-gray-400">{i.variationName}</div>}
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">{i.priceCents > 0 ? formatPrice(i.priceCents) : 'On request'}</td>
                      <td className="py-2 pr-2">
                        {i.barcode ? (
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className="font-mono text-xs">{i.barcode}</span>
                            <button onClick={() => clearCode(i.variationId)} className="text-xs text-gray-400 hover:text-red-600 underline">change</button>
                          </div>
                        ) : (
                          <div className="min-w-[220px]">
                            <div className="flex gap-1">
                              <input className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 text-xs font-mono"
                                placeholder="Type / scan pack code"
                                value={codeDrafts[i.variationId] ?? ''}
                                onChange={e => setCodeDrafts(d => ({ ...d, [i.variationId]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') saveCode(i.variationId); }} />
                              <button title="Generate a store code" onClick={() => generateCode(i.variationId)}
                                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-tpl-forest">
                                <Wand2 className="h-3.5 w-3.5" />
                              </button>
                              <button title="Save barcode" onClick={() => saveCode(i.variationId)} disabled={savingId === i.variationId}
                                className="p-1.5 rounded-lg bg-tpl-forest text-white disabled:opacity-50">
                                {savingId === i.variationId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                            {codeErrors[i.variationId] && <p className="text-xs text-red-600 mt-1">{codeErrors[i.variationId]}</p>}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" min={0} max={500} value={i.qty}
                          onChange={e => setQty(i.variationId, parseInt(e.target.value) || 0)}
                          className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-sm" />
                      </td>
                      <td className="py-2">
                        <button onClick={() => removeItem(i.variationId)} className="p-1.5 text-gray-400 hover:text-red-600" title="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {missingCodes > 0 && (
            <p className="text-xs text-tpl-amber mt-2">
              {missingCodes} product{missingCodes > 1 ? 's need' : ' needs'} a barcode before {missingCodes > 1 ? 'they' : 'it'} can be printed.
              Scan the code on the pack, or press the wand to generate a store code, then save.
            </p>
          )}

          <div className="grid sm:grid-cols-3 gap-3 mt-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Paper</label>
              <select className={inputCls} value={paper.mode} onChange={e => setPaper({ ...paper, mode: e.target.value as PaperMode })}>
                <option value="sheet">A4 sticker sheet (3 across)</option>
                <option value="roll">Label printer roll (one per label)</option>
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
            <button onClick={print} disabled={labels.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-tpl-forest text-white text-sm font-semibold hover:bg-tpl-mid disabled:opacity-40">
              <Printer className="h-4 w-4" />Print {labels.length} label{labels.length === 1 ? '' : 's'}
            </button>
            <button onClick={downloadCsv} disabled={items.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              <Download className="h-4 w-4" />Download CSV
            </button>
            {items.length > 0 && (
              <button onClick={() => setItems([])} className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-red-600">Clear list</button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            In the print dialog, set margins to None and scale to 100%.
            {labels.length >= MAX_LABELS && ` Only the first ${MAX_LABELS} labels are printed at once.`}
          </p>
        </div>

        <div className={cardCls}>
          <h2 className="font-semibold text-tpl-dark mb-3">Label preview</h2>
          {labels.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">Labels will appear here.</p>
          ) : (
            <div className="shop-label-preview">
              {labels.slice(0, 60).map((item, k) => <Label key={k} item={item} biz={biz} />)}
            </div>
          )}
          {labels.length > 60 && <p className="text-xs text-gray-400 mt-2">Showing 60 of {labels.length}. All will print.</p>}
        </div>
      </div>

      {createPortal(
        <div id="label-print-root" className={paper.mode === 'roll' ? 'roll' : 'sheet'}
          style={{ ['--lw' as string]: `${paper.w}mm`, ['--lh' as string]: `${paper.h}mm` }}>
          <style>{pageCss}</style>
          {labels.map((item, k) => <Label key={k} item={item} biz={biz} />)}
        </div>,
        document.body,
      )}
    </div>
  );
}
