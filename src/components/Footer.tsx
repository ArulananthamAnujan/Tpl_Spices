import { MapPin, Phone, Mail, Leaf } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-tpl-dark text-tpl-pale">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <img
                src="/WhatsApp_Image_2026-05-09_at_8.58.20_AM_(1).jpeg"
                alt="TPL Spices"
                className="h-12 w-12 rounded-full object-cover ring-2 ring-tpl-lime/40"
              />
              <div>
                <h3 className="font-display text-white font-bold text-lg">TPL Spices</h3>
                <p className="text-tpl-pale text-xs">Sri Lankan &amp; Indian Groceries</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-tpl-pale/80">
              Melbourne's premier destination for authentic Sri Lankan and Indian spices, groceries, and pantry essentials.
            </p>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white font-semibold mb-4">Contact</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 text-tpl-lime flex-shrink-0" />
                <span>No.40 David Street, Dandenong, Victoria, 3175</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-tpl-lime flex-shrink-0" />
                <a href="tel:+61449722392" className="hover:text-white transition-colors">+61 449 722 392</a>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-tpl-lime flex-shrink-0" />
                <a href="mailto:sales@tplspice.com.au" className="hover:text-white transition-colors">sales@tplspice.com.au</a>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-white transition-colors">Shop All Products</Link></li>
              <li><Link to="/cart" className="hover:text-white transition-colors">Your Cart</Link></li>
              <li><Link to="/account" className="hover:text-white transition-colors">Order History</Link></li>
              <li><Link to="/auth" className="hover:text-white transition-colors">Sign In / Register</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-tpl-mid/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-tpl-pale/60">
            &copy; {new Date().getFullYear()} TPL Spices &amp; Groceries. All rights reserved.
          </p>
          <div className="flex items-center gap-1.5 text-xs text-tpl-pale/60">
            <Leaf className="h-3.5 w-3.5 text-tpl-lime" />
            <span>Fresh. Authentic. Melbourne.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
