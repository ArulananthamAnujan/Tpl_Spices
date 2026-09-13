import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ShoppingCart, Menu, X, ChevronDown, Search, Salad, Shirt, ChefHat, Flame } from 'lucide-react';import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import { supabase } from '../lib/supabase';
import { Category, formatPrice } from '../lib/types';

const NAV_SECTIONS: { id: Category['section']; label: string; icon: typeof Salad }[] = [
  { id: 'grocery', label: 'Grocery & Spices', icon: Salad },
  { id: 'kitchen', label: 'Kitchen Essentials', icon: ChefHat },
  { id: 'pooja', label: 'Pooja Essentials', icon: Flame },
  { id: 'clothing', label: 'Clothing', icon: Shirt },
];

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const { itemCount, totalCents } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      setCategories(data ?? []);
    });
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    setUserMenuOpen(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setMenuOpen(false);
    }
  };

  const isActive = (path: string) => location.pathname === path;

  const brands = categories.filter(c => c.is_brand);
  const categoriesBySection = (section: Category['section']) => categories.filter(c => c.section === section && !c.is_brand);

  return (
    <header className="sticky top-0 z-50 shadow-lg">
      {/* Top bar */}
      <div className="bg-tpl-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 flex-shrink-0">
              <img
                src="/logo.jpg"
                alt="TPL Spices"
                className="h-10 w-10 rounded-full object-cover ring-2 ring-tpl-lime/50"
              />
              <div className="hidden sm:block">
                <span className="font-display text-white font-bold text-lg leading-tight block tracking-wide">
                  TPL SPICES
                </span>
                <span className="text-tpl-lime text-xs leading-tight block tracking-widest uppercase">
                  &amp; Groceries
                </span>
              </div>
            </Link>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-lg hidden md:flex">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search spices, lentils, rice, clothing..."
                  className="w-full pl-9 pr-4 py-2 bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime focus:bg-white/15 transition-all"
                />
              </div>
            </form>

            {/* Cart + User */}
            <div className="flex items-center gap-2">
              <Link
                to="/cart"
                className="flex items-center gap-2 px-3 py-2 text-tpl-pale hover:text-white hover:bg-white/10 rounded-xl transition-colors group"
              >
                <div className="relative">
                  <ShoppingCart className="h-5 w-5" />
                  {itemCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-tpl-lime text-tpl-dark text-xs font-bold min-w-[18px] min-h-[18px] rounded-full flex items-center justify-center leading-none px-0.5">
                      {itemCount > 9 ? '9+' : itemCount}
                    </span>
                  )}
                </div>
                {itemCount > 0 && (
                  <span className="hidden sm:block text-sm font-semibold text-tpl-lime whitespace-nowrap">
                    {formatPrice(totalCents)}
                  </span>
                )}
              </Link>

              {user ? (
                <div className="relative" ref={userRef}>
                  <button
                    onClick={() => setUserMenuOpen(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-2 text-tpl-pale hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-tpl-lime flex items-center justify-center text-tpl-dark font-bold text-xs flex-shrink-0">
                      {(profile?.full_name ?? 'U')[0].toUpperCase()}
                    </div>
                    <span className="hidden sm:block text-sm font-medium max-w-[100px] truncate">
                      {profile?.full_name?.split(' ')[0] ?? 'Account'}
                    </span>
                    <ChevronDown className={`h-3 w-3 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-1 w-52 bg-white rounded-2xl shadow-card-hover border border-gray-100 py-1 z-50">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-xs text-gray-400 uppercase tracking-wide">Signed in as</p>
                        <p className="text-sm font-semibold text-tpl-forest truncate mt-0.5">{profile?.full_name ?? 'Customer'}</p>
                        <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                          profile?.role === 'super_admin' ? 'bg-amber-100 text-amber-800' :
                          profile?.role === 'staff' ? 'bg-blue-100 text-blue-700' :
                          'bg-tpl-pale text-tpl-forest'
                        }`}>
                          {profile?.role === 'super_admin' ? 'Super Admin' : profile?.role === 'staff' ? 'Staff' : 'Customer'}
                        </span>
                      </div>
                      <Link to="/account" onClick={() => setUserMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-tpl-cream transition-colors">My Orders</Link>
                      {profile?.role === 'super_admin' && (
                        <Link to="/admin" onClick={() => setUserMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-tpl-cream transition-colors">Admin Dashboard</Link>
                      )}
                      {(profile?.role === 'staff' || profile?.role === 'super_admin') && (
                        <Link to="/staff" onClick={() => setUserMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-tpl-cream transition-colors">Staff Dashboard</Link>
                      )}
                      <div className="border-t border-gray-100 mt-1">
                        <button onClick={handleSignOut} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">Sign Out</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link to="/auth" className="px-3 py-1.5 text-tpl-pale hover:text-white text-sm font-medium transition-colors">Login</Link>
                  <Link to="/auth?tab=register" className="px-3 py-1.5 bg-tpl-lime text-tpl-dark text-sm font-semibold rounded-lg hover:bg-tpl-light transition-colors">Register</Link>
                </div>
              )}

              <button className="md:hidden p-2 text-tpl-pale hover:text-white transition-colors rounded-lg" onClick={() => setMenuOpen(v => !v)}>
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Nav bar */}
      <div className="bg-tpl-forest">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="hidden md:flex items-center h-11 gap-0.5">

            {NAV_SECTIONS.map(s => (
              <Link
                key={s.id}
                to={`/?section=${s.id}`}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors h-9 ${
                  location.search.includes(`section=${s.id}`) ? 'bg-white/20 text-white' : 'text-white/90 hover:text-white hover:bg-white/15'
                }`}
              >
                <s.icon className="h-4 w-4 text-tpl-lime" />
                {s.label}
              </Link>
            ))}

            <div className="w-px h-5 bg-white/20 mx-1" />

            <Link
              to="/"
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors h-9 flex items-center ${
                isActive('/') && !location.search ? 'bg-white/20 text-white' : 'text-white/80 hover:text-white hover:bg-white/15'
              }`}
            >
              Home
            </Link>

            <Link
              to="/?promo=1"
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors h-9 flex items-center text-tpl-lime hover:text-white hover:bg-white/15"
            >
              Promotions
            </Link>

            <Link
              to="/about"
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors h-9 flex items-center text-white/80 hover:text-white hover:bg-white/15"
            >
              About
            </Link>

            {brands.length > 0 && (
              <Link
                to="/?brands=1"
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors h-9 flex items-center text-white/80 hover:text-white hover:bg-white/15"
              >
                All Brands
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile nav panel */}
      {menuOpen && (
        <div className="md:hidden bg-tpl-dark border-t border-white/10 px-4 py-3 space-y-1">
          <form onSubmit={handleSearch} className="mb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search products..."
                className="w-full pl-9 pr-4 py-2.5 bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
              />
            </div>
          </form>
          <Link to="/" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-tpl-pale hover:text-white rounded-lg text-sm font-medium">Home</Link>
          {NAV_SECTIONS.map(s => (
            <div key={s.id}>
              <Link to={`/?section=${s.id}`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-tpl-lime hover:text-white rounded-lg text-sm font-semibold">
                <s.icon className="h-4 w-4" /> {s.label}
              </Link>
              {categoriesBySection(s.id).map(cat => (
                <Link key={cat.id} to={`/?section=${s.id}&category=${cat.id}`} onClick={() => setMenuOpen(false)} className="block px-6 py-1.5 text-white/70 hover:text-white rounded-lg text-sm">
                  {cat.name}
                </Link>
              ))}
            </div>
          ))}
          <Link to="/?promo=1" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-white/80 hover:text-white rounded-lg text-sm">Promotions</Link>
          <Link to="/about" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-white/80 hover:text-white rounded-lg text-sm">About</Link>
          {profile?.role === 'super_admin' && (
            <Link to="/admin" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-white/80 hover:text-white rounded-lg text-sm">Admin Dashboard</Link>
          )}
          {(profile?.role === 'staff' || profile?.role === 'super_admin') && (
            <Link to="/staff" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-white/80 hover:text-white rounded-lg text-sm">Staff Dashboard</Link>
          )}
        </div>
      )}
    </header>
  );
}
