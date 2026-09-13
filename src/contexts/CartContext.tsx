import React, { createContext, useContext, useState, useCallback } from 'react';
import { CartItem, Store } from '../lib/types';
import { effectiveUnitCents } from '../lib/pricing';

interface CartContextType {
  items: CartItem[];
  store: Store | null;
  addItem: (item: CartItem, store: Store) => void;
  selectStore: (store: Store) => void;
  removeItem: (variationId: string) => void;
  updateQty: (variationId: string, qty: number) => void;
  clearCart: () => void;
  totalCents: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [store, setStore] = useState<Store | null>(null);

  const addItem = useCallback((item: CartItem, cartStore: Store) => {
    if (store && store.id !== cartStore.id) {
      if (!window.confirm('Your cart contains items from another store. Start a new cart?')) return;
      setItems([]);
    }
    setStore(cartStore);
    setItems(prev => {
      const existing = prev.find(i => i.variation_id === item.variation_id);
      if (existing) {
        return prev.map(i =>
          i.variation_id === item.variation_id ? { ...i, quantity: i.quantity + item.quantity } : i
        );
      }
      return [...prev, item];
    });
  }, [store]);

  const selectStore = useCallback((s: Store) => {
    setStore(s);
  }, []);

  const removeItem = useCallback((variationId: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.variation_id !== variationId);
      if (next.length === 0) setStore(null);
      return next;
    });
  }, []);

  const updateQty = useCallback((variationId: string, qty: number) => {
    if (qty <= 0) {
      removeItem(variationId);
      return;
    }
    setItems(prev => prev.map(i => i.variation_id === variationId ? { ...i, quantity: qty } : i));
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setItems([]);
    setStore(null);
  }, []);

  const totalCents = items.reduce((sum, i) => sum + effectiveUnitCents(i, i.quantity) * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, store, addItem, selectStore, removeItem, updateQty, clearCart, totalCents, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
