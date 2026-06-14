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
import CostAnalytics from './components/CostAnalytics';
import AffiliatePayouts from './components/AffiliatePayouts';
import './App.css';

const NavIcon = ({ type }) => {
  const sw = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (type === 'orders') {
    // Clipboard / order list
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="2" {...sw} />
        <path d="M9 3 a3 3 0 0 1 6 0" {...sw} />
        <path d="M9 12 h6" {...sw} />
        <path d="M9 16 h4" {...sw} />
      </svg>
    );
  }
  if (type === 'payments') {
    // Credit card
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="5" width="20" height="14" rx="2" {...sw} />
        <path d="M2 10 H22" {...sw} />
        <path d="M6 15 h4" {...sw} />
      </svg>
    );
  }
  if (type === 'vendors') {
    // Person / user
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4" {...sw} />
        <path d="M4 20 a8 8 0 0 1 16 0" {...sw} />
      </svg>
    );
  }
  if (type === 'coa') {
    // Magnifying glass
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" {...sw} />
        <path d="M16.5 16.5 L21 21" {...sw} />
      </svg>
    );
  }
  if (type === 'sku') {
    // Tag / label
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.59 13.41 l-7.17 7.17 a2 2 0 0 1 -2.83 0 L4 14 V4 h10 l6.59 6.59 a2 2 0 0 1 0 2.82 z" {...sw} />
        <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (type === 'shipping') {
    // Delivery truck
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="7" width="14" height="10" rx="1" {...sw} />
        <path d="M15 9 h4 l3 4 v4 h-7 V9 z" {...sw} />
        <circle cx="5.5" cy="19" r="1.5" {...sw} />
        <circle cx="18.5" cy="19" r="1.5" {...sw} />
      </svg>
    );
  }
  if (type === 'add-user') {
    // Person with plus
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10" cy="8" r="4" {...sw} />
        <path d="M2 20 a8 8 0 0 1 14.32 -3.32" {...sw} />
        <path d="M19 16 v6" {...sw} />
        <path d="M16 19 h6" {...sw} />
      </svg>
    );
  }
  if (type === 'tools') {
    // Wrench
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.7 6.3 a1 1 0 0 0 0 1.4 l1.6 1.6 a1 1 0 0 0 1.4 0 l3.77 -3.77 a6 6 0 0 1 -7.94 7.94 l-6.91 6.91 a2.12 2.12 0 0 1 -3 -3 l6.91 -6.91 a6 6 0 0 1 7.94 -7.94 l-3.76 3.76 z" {...sw} />
      </svg>
    );
  }
  // Settings — sliders
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6 H20" {...sw} />
      <path d="M4 12 H20" {...sw} />
      <path d="M4 18 H20" {...sw} />
      <circle cx="8" cy="6" r="2" fill="var(--sidebar-bg, #fff)" {...sw} />
      <circle cx="16" cy="12" r="2" fill="var(--sidebar-bg, #fff)" {...sw} />
      <circle cx="10" cy="18" r="2" fill="var(--sidebar-bg, #fff)" {...sw} />
    </svg>
  );
};

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });
  const [toast, setToast] = useState({ visible: false, message: '' });
  const validPages = ['orders', 'vendors', 'promo', 'lotid', 'payments', 'sku-po', 'coa-lookup', 'cost-analytics', 'affiliates'];
  const parseHashPage = () => {
    if (typeof window === 'undefined') return 'orders';
    const raw = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    return validPages.includes(raw) ? raw : 'orders';
  };

  const [activePage, setActivePage] = useState(parseHashPage);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
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
    setToolsMenuOpen(false);
  };

  const isToolsPage = ['lotid', 'sku-po', 'coa-lookup', 'cost-analytics'].includes(activePage);

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
        <div className="app-shell">
          <aside className="app-sidebar">
            <div className="sidebar-body">
              <div className="sidebar-header">
                <div className="sidebar-brand">
                  <img src="/assets/logo.png" alt="Coffee and Peppers Logo" className="nav-logo" />
                </div>
              </div>

              {isGuest ? (
                <div className="sidebar-menu">
                  <button onClick={() => goToPage('lotid')} className={`nav-link ${activePage === 'lotid' ? 'active' : ''}`}>Lot ID Tracker</button>
                </div>
              ) : (
                <>
                  <div className="sidebar-menu">
                    <button onClick={() => goToPage('orders')} className={`nav-link ${activePage === 'orders' ? 'active' : ''}`}>Orders</button>
                    <button onClick={() => goToPage('payments')} className={`nav-link ${activePage === 'payments' ? 'active' : ''}`}>Payments</button>
                    <button onClick={() => goToPage('affiliates')} className={`nav-link ${activePage === 'affiliates' ? 'active' : ''}`}>Affiliates</button>
                    <button onClick={() => goToPage('vendors')} className={`nav-link ${activePage === 'vendors' ? 'active' : ''}`}>Vendor Profiles</button>
                  </div>

                  <div className={`sidebar-dropdown ${isToolsPage ? 'active' : ''} ${toolsMenuOpen ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="nav-link tools-trigger"
                      onClick={() => setToolsMenuOpen((prev) => !prev)}
                      aria-haspopup="true"
                      aria-expanded={toolsMenuOpen}
                    >
                      Tools
                    </button>
                    <div className="sidebar-dropdown-menu">
                      <button onClick={() => goToPage('lotid')} className={`nav-link nav-sublink ${activePage === 'lotid' ? 'active' : ''}`}>Lot Track</button>
                      <button onClick={() => goToPage('sku-po')} className={`nav-link nav-sublink ${activePage === 'sku-po' ? 'active' : ''}`}>Package Slip</button>
                      <button onClick={() => goToPage('coa-lookup')} className={`nav-link nav-sublink ${activePage === 'coa-lookup' ? 'active' : ''}`}>COA Lookup</button>
                      <button onClick={() => goToPage('cost-analytics')} className={`nav-link nav-sublink ${activePage === 'cost-analytics' ? 'active' : ''}`}>Cost Tool</button>
                    </div>
                  </div>
                </>
              )}

              <div className="sidebar-footer">
                {!isGuest && (
                  <button onClick={() => setShowAddUserModal(true)} className="btn-secondary sidebar-action-btn">
                    Add User
                  </button>
                )}
                <button onClick={handleSignOut} className="btn-secondary sidebar-action-btn">
                  {isGuest ? 'Exit Guest' : 'Sign Out'}
                </button>
              </div>
            </div>
          </aside>

          <div className="app-main-area">
            <div className="main-card neon-glow">
              {/* Main Content */}
              <div className="main-content">
                <div className="page-transition" key={activePage}>
            {activePage === 'affiliates' ? (
              <AffiliatePayouts
                onSuccess={showToast}
                onError={showModal}
              />
            ) : activePage === 'coa-lookup' ? (
              <CoaLookup />
            ) : activePage === 'cost-analytics' ? (
              <CostAnalytics />
            ) : activePage === 'payments' ? (
              <PaymentTracker
                onSuccess={showToast}
                onError={showModal}
              />
            ) : activePage === 'sku-po' ? (
              <SkuPoPage
                onSuccess={showToast}
                onError={showModal}
                user={user}
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
