import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signOut, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from './firebaseConfig';
import Modal from './components/Modal';
import LoginForm from './components/LoginForm';
import OrdersTabs from './components/OrdersTabs';
import NextOrderList from './components/NextOrderList';
import ProductManager from './components/ProductManager';
import PromoSchedule from './components/PromoSchedule';
import LotIDTracker from './components/LotIDTracker';
import PaymentTracker from './components/PaymentTracker';
import IncomingProducts from './components/IncomingProducts';
import SkuPoPage from './components/SkuPoPage';
import CoaLookup from './components/CoaLookup';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });
  const [toast, setToast] = useState({ visible: false, message: '' });
  const validPages = ['orders', 'vendors', 'promo', 'lotid', 'payments', 'sku-po', 'coa-lookup'];
  const parseHashPage = () => {
    if (typeof window === 'undefined') return 'orders';
    const raw = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    return validPages.includes(raw) ? raw : 'orders';
  };

  const [activePage, setActivePage] = useState(parseHashPage);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNextOrderModal, setShowNextOrderModal] = useState(false);
  const [isClosingNewOrderModal, setIsClosingNewOrderModal] = useState(false);

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addUserEmail, setAddUserEmail] = useState('');
  const [addUserPassword, setAddUserPassword] = useState('');
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [vendorGuest, setVendorGuest] = useState(null);
  const vendorGuestRef = useRef(null);

  const isGuest = Boolean(user?.isAnonymous);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser?.isAnonymous && vendorGuestRef.current) {
        setVendorGuest(vendorGuestRef.current);
        vendorGuestRef.current = null;
      }
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        setStatus('Authenticated');
        if (currentUser.isAnonymous) {
          setActivePage('lotid');
        }
      } else {
        setStatus('Not authenticated');
        setVendorGuest(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const showModal = (message, title = 'Notice') => {
    setModal({ isOpen: true, title, message });
  };

  const closeModal = () => {
    setModal({ isOpen: false, title: '', message: '' });
  };

  const showToast = (message) => {
    setToast({ visible: true, message });
    setTimeout(() => setToast({ visible: false, message: '' }), 3000);
  };

  // Keep URL hash in sync with active page and respond to hash changes (acts like lightweight routing)
  useEffect(() => {
    const handleHashChange = () => {
      const next = parseHashPage();
      setActivePage(next);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const desiredHash = `#/${activePage}`;
    if (window.location.hash !== desiredHash) {
      window.history.replaceState(null, '', desiredHash);
    }
  }, [activePage]);

  const goToPage = (page) => {
    if (!validPages.includes(page)) return;
    if (isGuest && page !== 'lotid') return;
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setAddUserLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, addUserEmail, addUserPassword);
      setAddUserEmail('');
      setAddUserPassword('');
      setShowAddUserModal(false);
      showToast('New admin user created successfully.');
    } catch (error) {
      showModal('Failed to create user: ' + error.message, 'Error');
    } finally {
      setAddUserLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setVendorGuest(null);
    } catch (error) {
      showModal('Sign out failed: ' + error.message, 'Error');
    }
  };

  const handleNewOrderSubmitted = () => {
    closeNewOrderModal();
  };

  const openNewOrderModal = () => {
    setIsClosingNewOrderModal(false);
    setShowNextOrderModal(true);
  };

  const closeNewOrderModal = () => {
    if (!showNextOrderModal || isClosingNewOrderModal) return;
    setIsClosingNewOrderModal(true);
    setTimeout(() => {
      setShowNextOrderModal(false);
      setIsClosingNewOrderModal(false);
    }, 220);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (showNextOrderModal) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showNextOrderModal]);

  if (loading) {
    return (
      <div className="app-container">
        <div className="main-card">
          <div className="loading">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Navigation - Only show when logged in */}
      {user && (
        <nav className="app-nav">
          <div className="nav-content">
            <div className="nav-brand">
              <img src="/assets/logo.png" alt="Coffee and Peppers Logo" className="nav-logo" />
            </div>
            {!isGuest && (
              <button 
                className="mobile-menu-toggle" 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
              >
                <span className="hamburger"></span>
                <span className="hamburger"></span>
                <span className="hamburger"></span>
              </button>
            )}
            {isGuest ? (
              <div className="nav-menu">
                <span className="nav-link active">Lot ID Tracker</span>
              </div>
            ) : (
              <div className={`nav-menu ${mobileMenuOpen ? 'mobile-open' : ''}`}>
                <button onClick={() => goToPage('orders')} className={`nav-link ${activePage === 'orders' ? 'active' : ''}`}>Orders</button>
                <button onClick={() => goToPage('payments')} className={`nav-link ${activePage === 'payments' ? 'active' : ''}`}>Payments</button>
                <button onClick={() => goToPage('vendors')} className={`nav-link ${activePage === 'vendors' ? 'active' : ''}`}>Vendor Profiles</button>
                <button onClick={() => goToPage('lotid')} className={`nav-link ${activePage === 'lotid' ? 'active' : ''}`}>Lot ID Tracker</button>
                <button onClick={() => goToPage('sku-po')} className={`nav-link ${activePage === 'sku-po' ? 'active' : ''}`}>SKU PO</button>
                <button onClick={() => goToPage('coa-lookup')} className={`nav-link ${activePage === 'coa-lookup' ? 'active' : ''}`}>COA Lookup</button>
              </div>
            )}
            <div className="nav-actions">
              {!isGuest && (
                <button onClick={() => setShowAddUserModal(true)} className="btn-secondary">
                  Add User
                </button>
              )}
              <button onClick={handleSignOut} className="btn-secondary">
                {isGuest ? 'Exit Guest' : 'Sign Out'}
              </button>
            </div>
          </div>
        </nav>
      )}

      {!user ? (
        <>
          {/* Login Section */}
          <section className="hero">
            <div className="hero-content">
              <LoginForm 
                onSuccess={showToast}
                onError={showModal}
                onVendorSuccess={(vendorName) => {
                  vendorGuestRef.current = vendorName;
                  setVendorGuest(vendorName);
                }}
              />
            </div>
          </section>
        </>
      ) : (
        <div className="main-card neon-glow">

        {/* Main Content */}
          <div className="main-content">
            <div className="page-transition" key={activePage}>
            {activePage === 'coa-lookup' ? (
              <CoaLookup />
            ) : activePage === 'payments' ? (
              <PaymentTracker
                onSuccess={showToast}
                onError={showModal}
              />
            ) : activePage === 'sku-po' ? (
              <SkuPoPage
                onSuccess={showToast}
                onError={showModal}
              />
            ) : activePage === 'vendors' ? (
              <ProductManager 
                onSuccess={showToast}
                onError={showModal}
              />
            ) : activePage === 'promo' ? (
              <PromoSchedule 
                onSuccess={showToast}
                onError={showModal}
              />
            ) : activePage === 'lotid' ? (
              <LotIDTracker isGuest={isGuest} vendorGuest={vendorGuest} />
            ) : (
              <>
                <div className="orders-page-actions">
                  <button
                    className="orders-next-order-btn"
                    onClick={openNewOrderModal}
                  >
                    + New Order
                  </button>
                </div>
                <OrdersTabs 
                  onSuccess={showToast}
                  onError={showModal}
                />
            </>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.visible && (
        <div className="app-toast">{toast.message}</div>
      )}

      {showNextOrderModal && (
        <div
          className={`next-order-modal-overlay ${isClosingNewOrderModal ? 'closing' : 'open'}`}
          onClick={closeNewOrderModal}
        >
          <div className="next-order-modal" onClick={(e) => e.stopPropagation()}>
            <div className="next-order-modal-header">
              <h3>New Order</h3>
              <button
                className="next-order-modal-close"
                onClick={closeNewOrderModal}
                aria-label="Close New Order"
              >
                Cancel
              </button>
            </div>
            <div className="next-order-modal-body">
              <NextOrderList onSuccess={showToast} onError={showModal} onSubmitted={handleNewOrderSubmitted} />
            </div>
          </div>
        </div>
      )}

      {showAddUserModal && (
        <div
          className="next-order-modal-overlay open"
          onClick={() => setShowAddUserModal(false)}
        >
          <div className="next-order-modal" onClick={(e) => e.stopPropagation()}>
            <div className="next-order-modal-header">
              <h3>Add New Admin User</h3>
              <button
                className="next-order-modal-close"
                onClick={() => setShowAddUserModal(false)}
              >
                Cancel
              </button>
            </div>
            <div className="next-order-modal-body">
              <form onSubmit={handleAddUser} className="auth-form">
                <div className="form-group">
                  <label htmlFor="add-user-email">Email</label>
                  <input
                    type="email"
                    id="add-user-email"
                    value={addUserEmail}
                    onChange={(e) => setAddUserEmail(e.target.value)}
                    placeholder="admin@domain.net"
                    required
                    disabled={addUserLoading}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="add-user-password">Password</label>
                  <input
                    type="password"
                    id="add-user-password"
                    value={addUserPassword}
                    onChange={(e) => setAddUserPassword(e.target.value)}
                    placeholder="• • • • • •"
                    required
                    minLength={6}
                    disabled={addUserLoading}
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn-neon-cyan" disabled={addUserLoading}>
                    {addUserLoading ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      <Modal
        isOpen={modal.isOpen}
        title={modal.title}
        message={modal.message}
        onClose={closeModal}
      />
    </div>
  );
}

export default App;
