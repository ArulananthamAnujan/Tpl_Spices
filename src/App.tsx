import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import Header from './components/Header';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import StorefrontPage from './pages/StorefrontPage';
import ProductDetailPage from './pages/ProductDetailPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import AuthPage from './pages/AuthPage';
import AccountPage from './pages/AccountPage';
import StaffDashboardPage from './pages/StaffDashboardPage';
import AdminDashboardPage from './pages/AdminDashboardPage';

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Routes>
            {/* Public auth page — no header/footer */}
            <Route path="/auth" element={<AuthPage />} />

            {/* All other pages wrapped in layout */}
            <Route
              path="/*"
              element={
                <Layout>
                  <Routes>
                    <Route path="/" element={<StorefrontPage />} />
                    <Route path="/product/:id" element={<ProductDetailPage />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route
                      path="/checkout"
                      element={
                        <ProtectedRoute>
                          <CheckoutPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/account"
                      element={
                        <ProtectedRoute>
                          <AccountPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/staff"
                      element={
                        <ProtectedRoute requiredRole="staff">
                          <StaffDashboardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin"
                      element={
                        <ProtectedRoute requiredRole="super_admin">
                          <AdminDashboardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="*" element={<StorefrontPage />} />
                  </Routes>
                </Layout>
              }
            />
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
