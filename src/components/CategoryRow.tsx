import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, CornerDownRight, Trash2, Edit2, Check, X, Plus, Package, CornerUpLeft,
} from 'lucide-react';
import { Category } from '../lib/types';

export interface RowProps {
  cat: Category;
  isChild: boolean;
  itemCount: number;
  busy: boolean;
  editing: boolean;
  editName: string;
  itemsOpen: boolean;
  dragging: boolean;
  onEditName: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  onToggleItems: () => void;
  onToggleSub: () => void;
  onMoveOut: () => void;
}

// One category line. Sortable rows animate out of the way as you drag, which is
// what makes reordering feel direct rather than fiddly.
export function CategoryRow(props: RowProps) {
  const {
    cat, isChild, itemCount, busy, editing, editName, itemsOpen, dragging,
    onEditName, onStartEdit, onCancelEdit, onRename, onDelete, onToggleItems, onToggleSub, onMoveOut,
  } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-wrap items-center justify-between gap-3 py-2.5 px-2 rounded-xl bg-white ${
        isChild ? 'ml-8' : ''
      } ${dragging ? '' : 'hover:bg-gray-50'} transition-colors`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Whole handle area is the drag grip, so a press-and-move just works. */}
        <button
          {...attributes}
          {...listeners}
          title="Drag to move"
          className="text-gray-300 hover:text-tpl-forest cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {isChild && <CornerDownRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              value={editName}
              onChange={e => onEditName(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') onRename(); if (e.key === 'Escape') onCancelEdit(); }}
              className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
            />
            <button onClick={onRename} className="p-1 text-tpl-forest hover:text-tpl-mid"><Check className="h-4 w-4" /></button>
            <button onClick={onCancelEdit} className="p-1 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <>
            <span className={`text-sm truncate ${isChild ? 'text-gray-600' : 'font-semibold text-tpl-dark'}`}>{cat.name}</span>
            {cat.is_brand && <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Brand</span>}
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={onToggleItems}
          title="Add or remove products in this category"
          className={`text-[11px] px-2 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
            itemsOpen ? 'border-tpl-forest bg-tpl-pale text-tpl-forest' : 'border-gray-200 text-gray-600 hover:border-tpl-forest hover:text-tpl-forest'
          }`}
        >
          <Package className="h-3 w-3" /> Items ({itemCount})
        </button>
        {!isChild && (
          <button onClick={onToggleSub} title="Add subcategory"
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-tpl-forest hover:text-tpl-forest transition-colors flex items-center gap-1">
            <Plus className="h-3 w-3" /> Sub
          </button>
        )}
        {isChild && (
          <button onClick={onMoveOut} title="Move out to top level"
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-tpl-forest hover:text-tpl-forest transition-colors flex items-center gap-1">
            <CornerUpLeft className="h-3 w-3" /> Move out
          </button>
        )}
        <button onClick={onStartEdit} title="Rename"
          className="p-1.5 text-gray-400 hover:text-tpl-forest transition-colors"><Edit2 className="h-3.5 w-3.5" /></button>
        <button onClick={onDelete} disabled={busy} title="Delete"
          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

// Appears under each top-level category while a drag is in progress, so
// "make this a subcategory" is an explicit place to aim at rather than a
// hidden hover state.
export function NestZone({ parent, active }: { parent: Category; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `nest:${parent.id}` });
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className={`ml-8 mb-1 rounded-lg border-2 border-dashed text-[11px] font-medium px-3 py-1.5 transition-all ${
        isOver
          ? 'border-tpl-forest bg-tpl-pale text-tpl-forest scale-[1.01]'
          : 'border-gray-200 text-gray-400'
      }`}
    >
      ↳ drop here to put it inside “{parent.name}”
    </div>
  );
}
