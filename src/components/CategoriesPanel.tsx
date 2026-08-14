import { useEffect, useState, useCallback } from 'react';
import {
  Tag, Plus, Salad, Shirt, Trash2, Edit2, Check, X, Loader2, CornerDownRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Category } from '../lib/types';

type Section = 'grocery' | 'clothing';

// Two-level category manager: top-level categories per section, each with
// optional subcategories underneath.
export default function CategoriesPanel() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);

  const [newName, setNewName] = useState('');
  const [newSection, setNewSection] = useState<Section>('grocery');
  const [creating, setCreating] = useState(false);

  const [subParent, setSubParent] = useState<string | null>(null);
  const [subName, setSubName] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const flash = (msg: string, bad = false) => setToast({ msg, bad });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('categories').select('*').order('sort_order').order('name');
    setCats((data as Category[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const createCategory = async (name: string, section: Section, parentId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) { flash('Enter a category name.', true); return false; }
    // square_id is NOT NULL + unique; locally-created categories get their own key.
    const squareId = `LOCAL-CAT-${trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const { error } = await supabase.from('categories').insert({
      name: trimmed, section, parent_id: parentId, square_id: squareId,
      sort_order: cats.length + 1,
    });
    if (error) { flash(error.message, true); return false; }
    await load();
    return true;
  };

  const addTopLevel = async () => {
    setCreating(true);
    if (await createCategory(newName, newSection, null)) { setNewName(''); flash('Category added.'); }
    setCreating(false);
  };

  const addSub = async (parent: Category) => {
    setBusyId(parent.id);
    if (await createCategory(subName, parent.section, parent.id)) {
      setSubName(''); setSubParent(null); flash('Subcategory added.');
    }
    setBusyId(null);
  };

  const rename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setBusyId(id);
    const { error } = await supabase.from('categories').update({ name: trimmed }).eq('id', id);
    if (error) flash(error.message, true); else { setEditId(null); await load(); }
    setBusyId(null);
  };

  const setSection = async (id: string, section: Section) => {
    setBusyId(id);
    const { error } = await supabase.from('categories').update({ section }).eq('id', id);
    if (error) flash(error.message, true); else await load();
    setBusyId(null);
  };

  const remove = async (cat: Category) => {
    const kids = cats.filter(c => c.parent_id === cat.id).length;
    const msg = kids
      ? `Delete “${cat.name}”? Its ${kids} subcategor${kids > 1 ? 'ies' : 'y'} will move to the top level. Products stay but become uncategorised.`
      : `Delete “${cat.name}”? Products in it stay but become uncategorised.`;
    if (!window.confirm(msg)) return;
    setBusyId(cat.id);
    const { error } = await supabase.from('categories').delete().eq('id', cat.id);
    if (error) flash(error.message, true); else { flash('Category deleted.'); await load(); }
    setBusyId(null);
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;

  const sections: { key: Section; label: string; icon: typeof Salad }[] = [
    { key: 'grocery', label: 'Grocery & Spices', icon: Salad },
    { key: 'clothing', label: 'Clothing', icon: Shirt },
  ];

  const renderRow = (cat: Category, isChild: boolean) => (
    <div key={cat.id} className={`flex flex-wrap items-center justify-between gap-3 py-2.5 ${isChild ? 'pl-8' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {isChild && <CornerDownRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
        {editId === cat.id ? (
          <div className="flex items-center gap-1.5">
            <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') rename(cat.id); if (e.key === 'Escape') setEditId(null); }}
              className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
            <button onClick={() => rename(cat.id)} className="p-1 text-tpl-forest hover:text-tpl-mid"><Check className="h-4 w-4" /></button>
            <button onClick={() => setEditId(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <>
            <span className={`text-sm truncate ${isChild ? 'text-gray-600' : 'font-semibold text-tpl-dark'}`}>{cat.name}</span>
            {cat.is_brand && <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Brand</span>}
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!isChild && (
          <button onClick={() => { setSubParent(subParent === cat.id ? null : cat.id); setSubName(''); }}
            title="Add subcategory"
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-tpl-forest hover:text-tpl-forest transition-colors flex items-center gap-1">
            <Plus className="h-3 w-3" /> Sub
          </button>
        )}
        {!isChild && (
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {sections.map(s => (
              <button key={s.key} onClick={() => setSection(cat.id, s.key)} disabled={busyId === cat.id}
                title={`Move to ${s.label}`}
                className={`px-2 py-1 transition-colors ${cat.section === s.key ? 'bg-tpl-forest text-white' : 'text-gray-400 hover:text-tpl-forest'}`}>
                <s.icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}
        <button onClick={() => { setEditId(cat.id); setEditName(cat.name); }} title="Rename"
          className="p-1.5 text-gray-400 hover:text-tpl-forest transition-colors"><Edit2 className="h-3.5 w-3.5" /></button>
        <button onClick={() => remove(cat)} disabled={busyId === cat.id} title="Delete"
          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-card p-6">
        <h2 className="font-semibold text-tpl-dark text-lg mb-1 flex items-center gap-2">
          <Tag className="h-5 w-5 text-tpl-forest" /> Categories
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Each category belongs to <strong>Grocery &amp; Spices</strong> or <strong>Clothing</strong> — this controls which nav section it appears under.
          Add <strong>subcategories</strong> underneath any category (e.g. Rice → Basmati). Subcategories follow their parent's section.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-medium text-gray-500 flex-1 min-w-[180px]">New category
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTopLevel(); }}
              placeholder="e.g. Rice, Spices, Women"
              className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </label>
          <label className="text-[11px] font-medium text-gray-500">Section
            <select value={newSection} onChange={e => setNewSection(e.target.value as Section)}
              className="block mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
              <option value="grocery">Grocery &amp; Spices</option>
              <option value="clothing">Clothing</option>
            </select>
          </label>
          <button onClick={addTopLevel} disabled={creating}
            className="px-4 py-2.5 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </div>
      </div>

      {toast && (
        <div className={`text-sm px-4 py-2.5 rounded-xl ${toast.bad ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-tpl-dark text-white'}`}>
          {toast.msg}
        </div>
      )}

      {sections.map(sec => {
        const tops = cats.filter(c => c.section === sec.key && !c.parent_id);
        return (
          <div key={sec.key} className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-5 py-3 bg-tpl-cream/50 border-b border-gray-100 flex items-center gap-2">
              <sec.icon className="h-4 w-4 text-tpl-forest" />
              <h3 className="font-semibold text-tpl-dark text-sm">{sec.label}</h3>
              <span className="text-xs text-gray-400">· {tops.length} categor{tops.length === 1 ? 'y' : 'ies'}</span>
            </div>
            {tops.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No categories in this section yet.</p>
            ) : (
              <div className="px-5 divide-y divide-gray-50">
                {tops.map(cat => (
                  <div key={cat.id} className="py-1">
                    {renderRow(cat, false)}
                    {cats.filter(c => c.parent_id === cat.id).map(child => renderRow(child, true))}
                    {subParent === cat.id && (
                      <div className="pl-8 pb-2 flex items-center gap-2">
                        <input value={subName} onChange={e => setSubName(e.target.value)} autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') addSub(cat); if (e.key === 'Escape') setSubParent(null); }}
                          placeholder={`Subcategory of ${cat.name}…`}
                          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                        <button onClick={() => addSub(cat)} disabled={busyId === cat.id}
                          className="text-xs px-3 py-1.5 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-40">Add</button>
                        <button onClick={() => setSubParent(null)} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
