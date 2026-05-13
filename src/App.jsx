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

const NavIcon = ({ type }) => {
  if (type === 'orders') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16 L10 10 L14 14 L20 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 8 H20 V12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'payments') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 10 H21" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (type === 'vendors') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 18 V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 18 V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 18 V13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 18 H20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'tools') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18 V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.8 7.5 L6.9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.1 15 L19.2 16.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 12 H6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 12 H21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.8 16.5 L6.9 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.1 9 L19.2 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
};

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem('sidebarCollapsed');
    if (saved === null) return true;
    return saved === 'true';
  });
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

  useEffect(() => {
    window.localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const goToPage = (page) => {
    if (!validPages.includes(page)) return;
    if (isGuest && page !== 'lotid') return;
    setActivePage(page);
    setToolsMenuOpen(false);
  };

  const isToolsPage = ['lotid', 'sku-po', 'coa-lookup'].includes(activePage);

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
        <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <aside className="app-sidebar">
            <button
              className="sidebar-edge-toggle"
              onClick={() => {
                setSidebarCollapsed((prev) => !prev);
                if (!sidebarCollapsed) {
                  setToolsMenuOpen(false);
                }
              }}
              aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              <svg
                aria-hidden="true"
                className={`sidebar-edge-toggle-icon ${sidebarCollapsed ? 'collapsed' : ''}`}
                viewBox="0 0 20 20"
              >
                <path d="M12.5 5.5 L8 10 L12.5 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="sidebar-body">

            <div className="sidebar-header">
              <div className="sidebar-brand">
                <img src="/assets/logo.png" alt="Coffee and Peppers Logo" className="nav-logo" />
              </div>
            </div>

            {sidebarCollapsed ? (
              <div className="sidebar-menu sidebar-icon-menu">
                {isGuest ? (
                  <button onClick={() => goToPage('lotid')} className={`nav-link nav-icon-link ${activePage === 'lotid' ? 'active' : ''}`} title="Lot ID Tracker" aria-label="Lot ID Tracker">
                    <NavIcon type="tools" />
                  </button>
                ) : (
                  <>
                    <button onClick={() => goToPage('orders')} className={`nav-link nav-icon-link ${activePage === 'orders' ? 'active' : ''}`} title="Orders" aria-label="Orders"><NavIcon type="orders" /></button>
                    <button onClick={() => goToPage('payments')} className={`nav-link nav-icon-link ${activePage === 'payments' ? 'active' : ''}`} title="Payments" aria-label="Payments"><NavIcon type="payments" /></button>
                    <button onClick={() => goToPage('vendors')} className={`nav-link nav-icon-link ${activePage === 'vendors' ? 'active' : ''}`} title="Vendor Profiles" aria-label="Vendor Profiles"><NavIcon type="vendors" /></button>
                    <button onClick={() => goToPage('lotid')} className={`nav-link nav-icon-link ${activePage === 'lotid' ? 'active' : ''}`} title="Lot Track" aria-label="Lot Track"><NavIcon type="tools" /></button>
                    <button onClick={() => goToPage('sku-po')} className={`nav-link nav-icon-link ${activePage === 'sku-po' ? 'active' : ''}`} title="SKU PO" aria-label="SKU PO"><NavIcon type="orders" /></button>
                    <button onClick={() => goToPage('coa-lookup')} className={`nav-link nav-icon-link ${activePage === 'coa-lookup' ? 'active' : ''}`} title="COA Lookup" aria-label="COA Lookup"><NavIcon type="payments" /></button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="sidebar-menu">
                  <button onClick={() => goToPage('orders')} className={`nav-link ${activePage === 'orders' ? 'active' : ''}`}>Orders</button>
                  <button onClick={() => goToPage('payments')} className={`nav-link ${activePage === 'payments' ? 'active' : ''}`}>Payments</button>
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
                    <button onClick={() => goToPage('sku-po')} className={`nav-link nav-sublink ${activePage === 'sku-po' ? 'active' : ''}`}>SKU PO</button>
                    <button onClick={() => goToPage('coa-lookup')} className={`nav-link nav-sublink ${activePage === 'coa-lookup' ? 'active' : ''}`}>COA Lookup</button>
                  </div>
                </div>
              </>
            )}

            <div className={`sidebar-footer ${sidebarCollapsed ? 'collapsed' : ''}`}>
              {sidebarCollapsed ? (
                <>
                  {!isGuest && (
                    <button
                      onClick={() => setShowAddUserModal(true)}
                      className="nav-link nav-icon-link"
                      title="Add User"
                      aria-label="Add User"
                    >
                      <NavIcon type="vendors" />
                    </button>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="nav-link nav-icon-link"
                    title={isGuest ? 'Exit Guest' : 'Sign Out'}
                    aria-label={isGuest ? 'Exit Guest' : 'Sign Out'}
                  >
                    <NavIcon type="settings" />
                  </button>
                </>
              ) : (
                <>
                  {!isGuest && (
                    <button onClick={() => setShowAddUserModal(true)} className="btn-secondary sidebar-action-btn">
                      Add User
                    </button>
                  )}
                  <button onClick={handleSignOut} className="btn-secondary sidebar-action-btn">
                    {isGuest ? 'Exit Guest' : 'Sign Out'}
                  </button>
                </>
              )}
            </div>
            </div>
          </aside>

          <div className="app-main-area">
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
