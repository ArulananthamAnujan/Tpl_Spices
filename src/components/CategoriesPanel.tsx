import { useEffect, useState, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCorners, useDroppable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import {
  Tag, Plus, Salad, Shirt, X, Loader2, Package, Search as SearchIcon, GripVertical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Category, Product } from '../lib/types';
import { CategoryRow, NestZone } from './CategoryRow';

type Section = 'grocery' | 'clothing';

const SECTIONS: { key: Section; label: string; icon: typeof Salad }[] = [
  { key: 'grocery', label: 'Grocery & Spices', icon: Salad },
  { key: 'clothing', label: 'Clothing', icon: Shirt },
];

export default function CategoriesPanel() {
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
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

  const [itemsFor, setItemsFor] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [movingProduct, setMovingProduct] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);

  const flash = (msg: string, bad = false) => setToast({ msg, bad });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const [catRes, prodRes] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order').order('name'),
      supabase.from('products').select('id, name, category_id').eq('active', true).order('name'),
    ]);
    setCats((catRes.data as Category[]) ?? []);
    setProducts((prodRes.data as Product[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const topLevel = (s: Section) => cats.filter(c => c.section === s && !c.parent_id);
  const childrenOf = (id: string) => cats.filter(c => c.parent_id === id);
  const byId = (id: string) => cats.find(c => c.id === id);
  const productsIn = (catId: string) => products.filter(p => p.category_id === catId);

  // A short press-and-move starts a drag, so ordinary clicks on the row's own
  // buttons still register as clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistOrder = async (ordered: Category[]) =>
    Promise.all(ordered.map((c, i) => supabase.from('categories').update({ sort_order: i + 1 }).eq('id', c.id)));

  // ------------------------------------------------------------------ drag
  const sectionOfDrop = (overId: string): Section | null => {
    if (overId === 'list:grocery') return 'grocery';
    if (overId === 'list:clothing') return 'clothing';
    const over = byId(overId);
    return over && !over.parent_id ? (over.section as Section) : null;
  };

  // Hop the row between lists mid-drag so it visibly lands where it will end up.
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const moving = byId(String(active.id));
    if (!moving || moving.parent_id) return;
    const target = sectionOfDrop(String(over.id));
    if (!target || target === moving.section) return;
    setCats(prev => prev.map(c => (c.id === moving.id ? { ...c, section: target } : c)));
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const moving = byId(String(active.id));
    if (!moving) return;
    const overId = String(over.id);

    // Dropped on a "put it inside this one" strip.
    if (overId.startsWith('nest:')) {
      const parentId = overId.slice(5);
      if (parentId === moving.id) return;
      if (childrenOf(moving.id).length > 0) {
        flash(`“${moving.name}” has subcategories, so it can't become one. Move those out first.`, true);
        await load();
        return;
      }
      setBusyId(moving.id);
      const { error } = await supabase.from('categories').update({ parent_id: parentId }).eq('id', moving.id);
      if (error) flash(error.message, true);
      else flash(`“${moving.name}” is now inside “${byId(parentId)?.name}”.`);
      await load();
      setBusyId(null);
      return;
    }

    const section = sectionOfDrop(overId) ?? (moving.section as Section);
    const list = topLevel(section);
    const from = list.findIndex(c => c.id === moving.id);
    const to = overId.startsWith('list:') ? list.length - 1 : list.findIndex(c => c.id === overId);

    setBusyId(moving.id);
    // Section (and un-nesting) is written first, so the ordering write lands on
    // the list the row actually belongs to.
    if (moving.section !== section || moving.parent_id) {
      const { error } = await supabase.from('categories')
        .update({ section, parent_id: null }).eq('id', moving.id);
      if (error) { flash(error.message, true); await load(); setBusyId(null); return; }
    }
    const ordered = from >= 0 && to >= 0 ? arrayMove(list, from, to) : list;
    await persistOrder(ordered);
    await load();
    setBusyId(null);
  };

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
    if (await createCategory(subName, parent.section as Section, parent.id)) {
      setSubName(''); setSubParent(null); flash('Subcategory added.');
    }
    setBusyId(null);
  };

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

  const moveOut = async (cat: Category) => {
    setBusyId(cat.id);
    const { error } = await supabase.from('categories')
      .update({ parent_id: null, section: cat.section }).eq('id', cat.id);
    if (error) flash(error.message, true); else { flash(`“${cat.name}” moved to the top level.`); await load(); }
    setBusyId(null);
  };

  // category_overridden tells the Square sync to leave this placement alone.
  const setProductCategory = async (productId: string, categoryId: string | null) => {
    setMovingProduct(productId);
    const { error } = await supabase.from('products')
      .update({ category_id: categoryId, category_overridden: true }).eq('id', productId);
    if (error) flash(error.message, true);
    else setProducts(prev => prev.map(p => (p.id === productId ? { ...p, category_id: categoryId } : p)));
    setMovingProduct(null);
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;

  const ItemsDrawer = ({ cat }: { cat: Category }) => {
    const assigned = productsIn(cat.id);
    const term = itemSearch.trim().toLowerCase();
    const candidates = term
      ? products.filter(p => p.category_id !== cat.id && p.name.toLowerCase().includes(term)).slice(0, 25)
      : [];
    return (
      <div className="ml-8 mb-2 border border-tpl-forest/20 rounded-xl bg-white p-3 space-y-3">
        <div>
          <p className="text-xs font-semibold text-tpl-dark mb-1.5">
            In “{cat.name}” · {assigned.length} item{assigned.length !== 1 ? 's' : ''}
          </p>
          {assigned.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Nothing here yet — search below to add products.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto divide-y divide-gray-50">
              {assigned.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-xs text-gray-700 truncate">{p.name}</span>
                  <button onClick={() => setProductCategory(p.id, null)} disabled={movingProduct === p.id}
                    title="Remove from this category"
                    className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input value={itemSearch} onChange={e => setItemSearch(e.target.value)}
              placeholder={`Search products to add to ${cat.name}…`}
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
          </div>
          {term && (candidates.length === 0 ? (
            <p className="text-xs text-gray-400 italic mt-2">No other products match “{itemSearch}”.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-50 mt-1.5">
              {candidates.map(p => {
                const current = p.category_id ? byId(p.category_id) : null;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-xs text-gray-700 truncate">
                      {p.name}{current && <span className="text-gray-400"> · in {current.name}</span>}
                    </span>
                    <button onClick={() => setProductCategory(p.id, cat.id)} disabled={movingProduct === p.id}
                      className="text-[11px] px-2 py-1 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-40 flex-shrink-0">
                      {movingProduct === p.id ? '…' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          <p className="text-[10px] text-gray-400 mt-1.5">Moving a product here keeps it here — the Square sync won't move it back.</p>
        </div>
      </div>
    );
  };

  const SectionList = ({ sec }: { sec: typeof SECTIONS[number] }) => {
    const tops = topLevel(sec.key);
    const { setNodeRef, isOver } = useDroppable({ id: `list:${sec.key}` });
    return (
      <div className={`bg-white rounded-2xl shadow-card overflow-hidden transition-all ${
        isOver && activeId ? 'ring-2 ring-tpl-forest' : ''
      }`}>
        <div className="px-5 py-3 bg-tpl-cream/50 border-b border-gray-100 flex items-center gap-2">
          <sec.icon className="h-4 w-4 text-tpl-forest" />
          <h3 className="font-semibold text-tpl-dark text-sm">{sec.label}</h3>
          <span className="text-xs text-gray-400">· {tops.length}</span>
        </div>
        <div ref={setNodeRef} className="px-3 py-2 min-h-[140px]">
          <SortableContext items={tops.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {tops.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">Drag a category here, or add one above.</p>
            ) : tops.map(cat => (
              <div key={cat.id}>
                <CategoryRow
                  cat={cat}
                  isChild={false}
                  itemCount={productsIn(cat.id).length}
                  busy={busyId === cat.id}
                  editing={editId === cat.id}
                  editName={editName}
                  itemsOpen={itemsFor === cat.id}
                  dragging={!!activeId}
                  onEditName={setEditName}
                  onStartEdit={() => { setEditId(cat.id); setEditName(cat.name); }}
                  onCancelEdit={() => setEditId(null)}
                  onRename={() => rename(cat.id)}
                  onDelete={() => remove(cat)}
                  onToggleItems={() => { setItemsFor(itemsFor === cat.id ? null : cat.id); setItemSearch(''); }}
                  onToggleSub={() => { setSubParent(subParent === cat.id ? null : cat.id); setSubName(''); }}
                  onMoveOut={() => moveOut(cat)}
                />
                <NestZone parent={cat} active={!!activeId && activeId !== cat.id} />
                {childrenOf(cat.id).map(child => (
                  <div key={child.id}>
                    <CategoryRow
                      cat={child}
                      isChild
                      itemCount={productsIn(child.id).length}
                      busy={busyId === child.id}
                      editing={editId === child.id}
                      editName={editName}
                      itemsOpen={itemsFor === child.id}
                      dragging={!!activeId}
                      onEditName={setEditName}
                      onStartEdit={() => { setEditId(child.id); setEditName(child.name); }}
                      onCancelEdit={() => setEditId(null)}
                      onRename={() => rename(child.id)}
                      onDelete={() => remove(child)}
                      onToggleItems={() => { setItemsFor(itemsFor === child.id ? null : child.id); setItemSearch(''); }}
                      onToggleSub={() => {}}
                      onMoveOut={() => moveOut(child)}
                    />
                    {itemsFor === child.id && <ItemsDrawer cat={child} />}
                  </div>
                ))}
                {itemsFor === cat.id && <ItemsDrawer cat={cat} />}
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
            ))}
          </SortableContext>
        </div>
      </div>
    );
  };

  const dragged = activeId ? byId(activeId) : null;

  const duplicates = (() => {
    const m = new Map<string, Category[]>();
    cats.filter(c => !c.parent_id).forEach(c => {
      const k = c.name.trim().toLowerCase();
      m.set(k, [...(m.get(k) ?? []), c]);
    });
    return [...m.values()].filter(g => g.length > 1);
  })();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-card p-6">
        <h2 className="font-semibold text-tpl-dark text-lg mb-1 flex items-center gap-2">
          <Tag className="h-5 w-5 text-tpl-forest" /> Categories
        </h2>
        <p className="text-sm text-gray-500 mb-1">
          This is exactly what shoppers see. <b>Grab the ⠿ handle</b> and drag a category to reorder it,
          drag it across to the other panel to switch section, or drop it on the
          <b> “drop here to put it inside…” </b> strip to make it a subcategory.
        </p>
        <p className="text-xs text-gray-400 mb-4">
          The order here is the order in the storefront sidebar. <b>Items (N)</b> adds and removes the products inside a category.
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

      {duplicates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">Duplicate categories</p>
          <p className="text-xs mb-2">
            These names appear twice, so shoppers see them twice in the menu. Move any products across
            with <b>Items</b>, then delete the empty one.
          </p>
          <ul className="text-xs space-y-0.5">
            {duplicates.map(g => (
              <li key={g[0].id}>
                <b>{g[0].name}</b> — {g.map(c => `${productsIn(c.id).length} items`).join(' and ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <div className={`text-sm px-4 py-2.5 rounded-xl ${toast.bad ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-tpl-dark text-white'}`}>
          {toast.msg}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {SECTIONS.map(sec => <SectionList key={sec.key} sec={sec} />)}
        </div>

        {/* The row follows the cursor, so it's always clear what's moving. */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {dragged ? (
            <div className="flex items-center gap-2 bg-white rounded-xl shadow-card-hover border-2 border-tpl-forest px-3 py-2.5 cursor-grabbing">
              <GripVertical className="h-4 w-4 text-tpl-forest" />
              <span className="text-sm font-semibold text-tpl-dark">{dragged.name}</span>
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <Package className="h-3 w-3" /> {productsIn(dragged.id).length}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
