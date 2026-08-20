import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  updated: string;
  children: React.ReactNode;
}

export default function LegalPage({ title, updated, children }: Props) {
  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/" className="flex items-center gap-2 text-tpl-forest hover:text-tpl-mid text-sm font-medium mb-6 transition-colors w-fit">
          <ArrowLeft className="h-4 w-4" /> Back to Shop
        </Link>

        <div className="bg-white rounded-2xl shadow-card p-8 sm:p-10">
          <h1 className="font-display text-3xl font-bold text-tpl-dark mb-1">{title}</h1>
          <p className="text-xs text-gray-400 mb-6">Last updated: {updated}</p>

          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800 leading-relaxed">
              This page is a general-purpose starting template, not final legal copy — it hasn't been reviewed by a
              lawyer and should be checked against your actual business practices, ABN/entity details, and
              Australian Consumer Law obligations before you rely on it in production.
            </p>
          </div>

          <div className="prose-legal text-sm text-gray-700 leading-relaxed space-y-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
