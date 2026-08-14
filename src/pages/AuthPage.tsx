import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, User, Eye, EyeOff, Leaf, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';

export default function AuthPage() {
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>(searchParams.get('tab') === 'register' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (user) { navigate('/'); return null; }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) { setError(error); setLoading(false); return; }
      navigate('/');
    } else {
      if (!fullName.trim()) { setError('Please enter your full name.'); setLoading(false); return; }
      const { error } = await signUp(email, password, fullName);
      if (error) { setError(error); setLoading(false); return; }
      setSuccess('Account created! You are now signed in.');
      setTimeout(() => navigate('/'), 1500);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-tpl-dark via-tpl-forest to-tpl-mid flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/WhatsApp_Image_2026-05-09_at_8.58.20_AM_(1).jpeg"
            alt="TPL Spices"
            className="h-20 w-20 rounded-full object-cover mx-auto mb-4 ring-4 ring-tpl-lime/30"
          />
          <h1 className="font-display text-2xl font-bold text-white">TPL Spices &amp; Groceries</h1>
          <p className="text-tpl-pale/70 text-sm mt-1">Melbourne's Sri Lankan &amp; Indian Grocer</p>
        </div>

        <div className="bg-white rounded-2xl shadow-card-hover overflow-hidden">
          {/* Tabs */}
          <div className="flex">
            <button
              onClick={() => { setMode('signin'); setError(''); }}
              className={`flex-1 py-4 text-sm font-semibold transition-colors ${mode === 'signin' ? 'text-tpl-forest border-b-2 border-tpl-forest bg-tpl-cream' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(''); }}
              className={`flex-1 py-4 text-sm font-semibold transition-colors ${mode === 'signup' ? 'text-tpl-forest border-b-2 border-tpl-forest bg-tpl-cream' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {mode === 'signup' && (
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Full name"
                  required
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                required
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                required
                minLength={6}
                className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-tpl-pale border border-tpl-lime/40 rounded-xl p-3">
                <p className="text-sm text-tpl-forest">{success}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-tpl-forest text-white font-semibold rounded-xl hover:bg-tpl-mid transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><LoadingSpinner size="sm" light /><span>Please wait…</span></> : (mode === 'signin' ? 'Sign In' : 'Create Account')}
            </button>
          </form>
        </div>

        <p className="text-center text-tpl-pale/50 text-xs mt-6">
          By signing in you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}
