import { useEffect, useState, useCallback } from 'react';
import {
  Tag, Plus, Salad, Shirt, Trash2, Edit2, Check, X, Loader2, CornerDownRight, GripVertical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Category } from '../lib/types';

type Section = 'grocery' | 'clothing';

const SECTIONS: { key: Section; label: string; icon: typeof Salad }[] = [
  { key: 'grocery', label: 'Grocery & Spices', icon: Salad },
  { key: 'clothing', label: 'Clothing', icon: Shirt },
];

// Drag-and-drop category organiser. What you arrange here is exactly what
// shoppers see: the section decides which nav tab a category lives under, the
// order decides the order in the sidebar, and nesting creates subcategories.
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

  // Drag state: what's moving, and where it would land.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overNest, setOverNest] = useState<string | null>(null);   // drop onto a row -> nest under it
  const [overGap, setOverGap] = useState<string | null>(null);     // drop in a gap -> reorder before this id
  const [overSection, setOverSection] = useState<Section | null>(null);

  const flash = (msg: string, bad = false) => setToast({ msg, bad });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('categories').select('*').order('sort_order').order('name');
    setCats((data as Category[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const topLevel = (s: Section) => cats.filter(c => c.section === s && !c.parent_id);
  const childrenOf = (id: string) => cats.filter(c => c.parent_id === id);
  const byId = (id: string) => cats.find(c => c.id === id);

  // ---------------------------------------------------------------- create
  const createCategory = async (name: string, section: Section, parentId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) { flash('Enter a category name.', true); return false; }
    const squareId = `LOCAL-CAT-${trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const { error } = await supabase.from('categories').insert({
      name: trimmed, section, parent_id: parentId, square_id: squareId, sort_order: cats.length + 1,
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

  // ------------------------------------------------------- rename / delete
  const rename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setBusyId(id);
    // name_overridden stops the Square sync renaming it back.
    const { error } = await supabase.from('categories').update({ name: trimmed, name_overridden: true }).eq('id', id);
    if (error) flash(error.message, true); else { setEditId(null); await load(); }
    setBusyId(null);
  };

  const remove = async (cat: Category) => {
    const kids = childrenOf(cat.id).length;
    const msg = kids
      ? `Delete “${cat.name}”? Its ${kids} subcategor${kids > 1 ? 'ies' : 'y'} will move to the top level. Products stay but become uncategorised.`
      : `Delete “${cat.name}”? Products in it stay but become uncategorised.`;
    if (!window.confirm(msg)) return;
    setBusyId(cat.id);
    const { error } = await supabase.from('categories').delete().eq('id', cat.id);
    if (error) flash(error.message, true); else { flash('Category deleted.'); await load(); }
    setBusyId(null);
  };

  // ------------------------------------------------------------ drag drop
  // Write a whole list's positions in one go so the order is stable.
  const persistOrder = async (ordered: Category[]) => {
    await Promise.all(
      ordered.map((c, i) =>
        supabase.from('categories').update({ sort_order: i + 1 }).eq('id', c.id)),
    );
  };

  const dropToSection = async (section: Section) => {
    const moving = dragId ? byId(dragId) : null;
    if (!moving) return;
    setBusyId(moving.id);
    const { error } = await supabase.from('categories')
      .update({ section, parent_id: null }).eq('id', moving.id);
    if (error) flash(error.message, true);
    else {
      const rest = topLevel(section).filter(c => c.id !== moving.id);
      await persistOrder([...rest, { ...moving, section, parent_id: null }]);
      flash(`Moved “${moving.name}” to ${SECTIONS.find(s => s.key === section)!.label}.`);
      await load();
    }
    setBusyId(null);
  };

  const dropToNest = async (parent: Category) => {
    const moving = dragId ? byId(dragId) : null;
    if (!moving || moving.id === parent.id) return;
    if (parent.parent_id) { flash('Categories can only be nested one level deep.', true); return; }
    if (childrenOf(moving.id).length > 0) {
      flash(`“${moving.name}” has subcategories, so it can't become one itself. Move its subcategories out first.`, true);
      return;
    }
    setBusyId(moving.id);
    // The database trigger also pulls the child into its parent's section.
    const { error } = await supabase.from('categories')
      .update({ parent_id: parent.id }).eq('id', moving.id);
    if (error) flash(error.message, true);
    else { flash(`“${moving.name}” is now under “${parent.name}”.`); await load(); }
    setBusyId(null);
  };

  const dropToGap = async (beforeId: string, section: Section) => {
    const moving = dragId ? byId(dragId) : null;
    if (!moving || moving.id === beforeId) return;
    setBusyId(moving.id);

    if (moving.section !== section || moving.parent_id) {
      const { error } = await supabase.from('categories')
        .update({ section, parent_id: null }).eq('id', moving.id);
      if (error) { flash(error.message, true); setBusyId(null); return; }
    }

    const list = topLevel(section).filter(c => c.id !== moving.id);
    const at = list.findIndex(c => c.id === beforeId);
    const next = [...list];
    next.splice(at < 0 ? next.length : at, 0, { ...moving, section, parent_id: null });
    await persistOrder(next);
    await load();
    setBusyId(null);
  };

  const clearDrag = () => { setDragId(null); setOverNest(null); setOverGap(null); setOverSection(null); };

  // ------------------------------------------------------------------ view
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;

  const Gap = ({ beforeId, section }: { beforeId: string; section: Section }) => (
    <div
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOverGap(beforeId); setOverNest(null); }}
      onDragLeave={() => setOverGap(g => (g === beforeId ? null : g))}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); dropToGap(beforeId, section); clearDrag(); }}
      className={`h-2 -my-1 rounded transition-colors ${overGap === beforeId ? 'bg-tpl-lime' : 'bg-transparent'}`}
    />
  );

  const Row = ({ cat, isChild, section }: { cat: Category; isChild: boolean; section: Section }) => {
    const dragging = dragId === cat.id;
    const nestTarget = overNest === cat.id && dragId && dragId !== cat.id;
    return (
      <div
        draggable={editId !== cat.id}
        onDragStart={e => { e.stopPropagation(); setDragId(cat.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={clearDrag}
        onDragOver={e => {
          if (isChild || !dragId || dragId === cat.id) return;
          e.preventDefault(); e.stopPropagation(); setOverNest(cat.id); setOverGap(null);
        }}
        onDragLeave={() => setOverNest(n => (n === cat.id ? null : n))}
        onDrop={e => {
          if (isChild) return;
          e.preventDefault(); e.stopPropagation(); dropToNest(cat); clearDrag();
        }}
        className={`flex flex-wrap items-center justify-between gap-3 py-2.5 px-2 rounded-xl transition-all ${
          isChild ? 'ml-8' : ''
        } ${dragging ? 'opacity-40' : ''} ${nestTarget ? 'ring-2 ring-tpl-forest bg-tpl-pale/50' : 'hover:bg-gray-50'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="h-4 w-4 text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0" />
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
              {nestTarget && <span className="text-[10px] font-bold text-tpl-forest">drop to nest inside</span>}
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
          {isChild && (
            <button
              onClick={async () => {
                setBusyId(cat.id);
                const { error } = await supabase.from('categories').update({ parent_id: null, section }).eq('id', cat.id);
                if (error) flash(error.message, true); else { flash(`“${cat.name}” moved to the top level.`); await load(); }
                setBusyId(null);
              }}
              title="Move out to top level"
              className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-tpl-forest hover:text-tpl-forest transition-colors">
              Move out
            </button>
          )}
          <button onClick={() => { setEditId(cat.id); setEditName(cat.name); }} title="Rename"
            className="p-1.5 text-gray-400 hover:text-tpl-forest transition-colors"><Edit2 className="h-3.5 w-3.5" /></button>
          <button onClick={() => remove(cat)} disabled={busyId === cat.id} title="Delete"
            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Add + how it works */}
      <div className="bg-white rounded-2xl shadow-card p-6">
        <h2 className="font-semibold text-tpl-dark text-lg mb-1 flex items-center gap-2">
          <Tag className="h-5 w-5 text-tpl-forest" /> Categories
        </h2>
        <p className="text-sm text-gray-500 mb-1">
          This is exactly what shoppers see. <b>Drag a category</b> to reorder it, drop it on the other
          panel to switch it between <b>Grocery &amp; Spices</b> and <b>Clothing</b>, or drop it
          <b> on top of another category</b> to make it a subcategory.
        </p>
        <p className="text-xs text-gray-400 mb-4">The order here is the order in the storefront sidebar. Subcategories always follow their parent's section.</p>

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

      {/* Two drop panels, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {SECTIONS.map(sec => {
          const tops = topLevel(sec.key);
          const active = overSection === sec.key && dragId;
          return (
            <div
              key={sec.key}
              onDragOver={e => { if (!dragId) return; e.preventDefault(); setOverSection(sec.key); }}
              onDragLeave={() => setOverSection(s => (s === sec.key ? null : s))}
              onDrop={e => { e.preventDefault(); dropToSection(sec.key); clearDrag(); }}
              className={`bg-white rounded-2xl shadow-card overflow-hidden transition-all ${
                active ? 'ring-2 ring-tpl-forest' : ''
              }`}
            >
              <div className="px-5 py-3 bg-tpl-cream/50 border-b border-gray-100 flex items-center gap-2">
                <sec.icon className="h-4 w-4 text-tpl-forest" />
                <h3 className="font-semibold text-tpl-dark text-sm">{sec.label}</h3>
                <span className="text-xs text-gray-400">· {tops.length}</span>
                {active && <span className="ml-auto text-[11px] font-bold text-tpl-forest">drop here</span>}
              </div>

              <div className="px-3 py-2 min-h-[120px]">
                {tops.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">
                    Nothing here yet — drag a category across, or add one above.
                  </p>
                ) : (
                  tops.map(cat => (
                    <div key={cat.id}>
                      <Gap beforeId={cat.id} section={sec.key} />
                      <Row cat={cat} isChild={false} section={sec.key} />
                      {childrenOf(cat.id).map(child => (
                        <Row key={child.id} cat={child} isChild section={sec.key} />
                      ))}
                      {subParent === cat.id && (
                        <div className="ml-8 pb-2 flex items-center gap-2">
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
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
