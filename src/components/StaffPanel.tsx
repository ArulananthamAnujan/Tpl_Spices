import { useEffect, useState, useCallback } from 'react';
import {
  Users, UserPlus, Search as SearchIcon, Loader2, Trash2, KeyRound,
  ShieldCheck, Check, Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Profile, UserRole } from '../lib/types';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  staff: 'Staff',
  customer: 'Customer',
};

// Calls the admin-only manage-staff edge function (service-role work such as
// creating auth accounts can't happen from the browser).
async function callManageStaff(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-staff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  arr.forEach(n => { out += chars[n % chars.length]; });
  return out + '@1';
}

export default function StaffPanel() {
  const [team, setTeam] = useState<Profile[]>([]);
  const [customers, setCustomers] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cRole, setCRole] = useState<'staff' | 'super_admin'>('staff');
  const [cStore, setCStore] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [creating, setCreating] = useState(false);

  const [promoteSearch, setPromoteSearch] = useState('');

  const flash = (msg: string, bad = false) => setToast({ msg, bad });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const [teamRes, custRes, storeRes] = await Promise.all([
      supabase.from('profiles').select('*, store:stores(name)').neq('role', 'customer').order('full_name'),
      supabase.from('profiles').select('*').eq('role', 'customer').order('full_name'),
      supabase.from('stores').select('*').order('name'),
    ]);
    setTeam((teamRes.data as Profile[]) ?? []);
    setCustomers((custRes.data as Profile[]) ?? []);
    setStores((storeRes.data as Store[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createAccount = async () => {
    if (!cName.trim()) { flash('Enter the person\'s name.', true); return; }
    if (cPassword.length < 8) { flash('Password must be at least 8 characters.', true); return; }
    setCreating(true);
    try {
      await callManageStaff({
        action: 'create',
        email: cEmail,
        password: cPassword,
        full_name: cName,
        role: cRole,
        assigned_store_id: cStore || null,
      });
      flash(`Account created for ${cEmail}. Share the password with them — they can change it after signing in.`);
      setCName(''); setCEmail(''); setCPassword(''); setCStore(''); setCRole('staff'); setShowCreate(false);
      await load();
    } catch (e) {
      flash((e as Error).message, true);
    }
    setCreating(false);
  };

  const updateRole = async (id: string, role: UserRole, storeId: string | null) => {
    setBusyId(id);
    const { error } = await supabase.from('profiles').update({ role, assigned_store_id: storeId }).eq('id', id);
    if (error) flash(error.message, true); else await load();
    setBusyId(null);
  };

  const promote = async (id: string, role: 'staff' | 'super_admin') => {
    setBusyId(id);
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
    if (error) flash(error.message, true); else { flash('Account promoted.'); await load(); }
    setBusyId(null);
  };

  const resetPassword = async (p: Profile) => {
    const pw = window.prompt(`New password for ${p.email ?? p.full_name} (min 8 characters):`, randomPassword());
    if (!pw) return;
    setBusyId(p.id);
    try {
      await callManageStaff({ action: 'reset_password', user_id: p.id, password: pw });
      flash(`Password updated. New password: ${pw}`);
    } catch (e) { flash((e as Error).message, true); }
    setBusyId(null);
  };

  const removeAccount = async (p: Profile) => {
    if (!window.confirm(`Permanently delete the account for ${p.email ?? p.full_name}? This cannot be undone.`)) return;
    setBusyId(p.id);
    try {
      await callManageStaff({ action: 'delete', user_id: p.id });
      flash('Account deleted.');
      await load();
    } catch (e) { flash((e as Error).message, true); }
    setBusyId(null);
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-tpl-forest" /></div>;

  const promoteMatches = customers.filter(c =>
    !promoteSearch ||
    (c.full_name ?? '').toLowerCase().includes(promoteSearch.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(promoteSearch.toLowerCase()));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-tpl-dark text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-tpl-forest" /> Team
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Create staff and admin accounts directly, assign their store, reset passwords, or remove access.
            </p>
          </div>
          <button onClick={() => setShowCreate(v => !v)}
            className="px-4 py-2.5 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> {showCreate ? 'Cancel' : 'Create account'}
          </button>
        </div>

        {showCreate && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[11px] font-medium text-gray-500">Full name
                <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Jane Smith"
                  className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">Email
                <input value={cEmail} onChange={e => setCEmail(e.target.value)} type="email" placeholder="jane@tplspices.com"
                  className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
              </label>
              <label className="text-[11px] font-medium text-gray-500">Password
                <div className="relative mt-1">
                  <input value={cPassword} onChange={e => setCPassword(e.target.value)} type={showPw ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    className="w-full px-3 py-2.5 pr-20 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => { setCPassword(randomPassword()); setShowPw(true); }}
                    title="Generate a password"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-tpl-forest">
                    <KeyRound className="h-4 w-4" />
                  </button>
                </div>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[11px] font-medium text-gray-500">Role
                  <select value={cRole} onChange={e => setCRole(e.target.value as 'staff' | 'super_admin')}
                    className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
                    <option value="staff">Staff</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </label>
                <label className="text-[11px] font-medium text-gray-500">Store
                  <select value={cStore} onChange={e => setCStore(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
                    <option value="">No store</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <button onClick={createAccount} disabled={creating}
              className="mt-4 px-5 py-2.5 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors disabled:opacity-40 flex items-center gap-2">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create account
            </button>
            <p className="text-[11px] text-gray-400 mt-2">
              The account is ready to use immediately — no confirmation email. Share the password with them privately.
            </p>
          </div>
        )}
      </div>

      {toast && (
        <div className={`text-sm px-4 py-2.5 rounded-xl ${toast.bad ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-tpl-dark text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Team list */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-5 py-3 bg-tpl-cream/50 border-b border-gray-100">
          <h3 className="font-semibold text-tpl-dark text-sm">Team members ({team.length})</h3>
        </div>
        {team.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No staff yet — use “Create account” above to add your first team member.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {team.map(m => (
              <div key={m.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === 'super_admin' ? 'bg-tpl-forest text-white' : 'bg-tpl-pale text-tpl-forest'}`}>
                    {m.role === 'super_admin' ? <ShieldCheck className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-tpl-dark text-sm truncate">{m.full_name || '(No name)'}</p>
                    <p className="text-xs text-gray-400 truncate">{m.email ?? m.id.slice(0, 12)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={m.role} disabled={busyId === m.id}
                    onChange={e => updateRole(m.id, e.target.value as UserRole, m.assigned_store_id)}
                    className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
                    <option value="customer">{ROLE_LABEL.customer}</option>
                    <option value="staff">{ROLE_LABEL.staff}</option>
                    <option value="super_admin">{ROLE_LABEL.super_admin}</option>
                  </select>
                  <select value={m.assigned_store_id ?? ''} disabled={busyId === m.id}
                    onChange={e => updateRole(m.id, m.role, e.target.value || null)}
                    className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-tpl-lime">
                    <option value="">No store</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button onClick={() => resetPassword(m)} disabled={busyId === m.id} title="Reset password"
                    className="p-1.5 text-gray-400 hover:text-tpl-forest transition-colors">
                    <KeyRound className="h-4 w-4" />
                  </button>
                  <button onClick={() => removeAccount(m)} disabled={busyId === m.id} title="Delete account"
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote an existing customer */}
      <div className="bg-white rounded-2xl shadow-card p-5">
        <h3 className="font-semibold text-tpl-dark text-sm mb-1">Promote an existing account</h3>
        <p className="text-xs text-gray-500 mb-3">Already signed up as a customer? Promote them instead of creating a new account.</p>
        <div className="relative mb-3">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={promoteSearch} onChange={e => setPromoteSearch(e.target.value)} placeholder="Search by name or email…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime" />
        </div>
        {customers.length === 0 ? (
          <p className="text-sm text-gray-400 py-3 text-center">No customer accounts yet.</p>
        ) : promoteMatches.length === 0 ? (
          <p className="text-sm text-gray-400 py-3 text-center">No accounts match your search.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
            {promoteMatches.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-tpl-dark truncate">{c.full_name || '(No name)'}</p>
                  <p className="text-[11px] text-gray-400 truncate">{c.email ?? c.id.slice(0, 12)}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => promote(c.id, 'staff')} disabled={busyId === c.id}
                    className="text-xs px-3 py-1.5 bg-tpl-forest text-white rounded-lg font-medium hover:bg-tpl-mid transition-colors disabled:opacity-40">
                    Make staff
                  </button>
                  <button onClick={() => promote(c.id, 'super_admin')} disabled={busyId === c.id}
                    className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-40">
                    Make admin
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
