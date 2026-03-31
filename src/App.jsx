import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
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
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });
  const [toast, setToast] = useState({ visible: false, message: '' });
  const validPages = ['orders', 'vendors', 'promo', 'lotid', 'payments', 'sku-po'];
  const parseHashPage = () => {
    if (typeof window === 'undefined') return 'orders';
    const raw = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    return validPages.includes(raw) ? raw : 'orders';
  };

  const [activePage, setActivePage] = useState(parseHashPage);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNextOrderModal, setShowNextOrderModal] = useState(false);
  const [isClosingNewOrderModal, setIsClosingNewOrderModal] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        setStatus('Authenticated');
      } else {
        setStatus('Not authenticated');
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
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
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
            <button 
              className="mobile-menu-toggle" 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              <span className="hamburger"></span>
              <span className="hamburger"></span>
              <span className="hamburger"></span>
            </button>
            <div className={`nav-menu ${mobileMenuOpen ? 'mobile-open' : ''}`}>
              <button onClick={() => goToPage('orders')} className={`nav-link ${activePage === 'orders' ? 'active' : ''}`}>Orders</button>
              <button onClick={() => goToPage('payments')} className={`nav-link ${activePage === 'payments' ? 'active' : ''}`}>Payments</button>
              <button onClick={() => goToPage('vendors')} className={`nav-link ${activePage === 'vendors' ? 'active' : ''}`}>Vendor Profiles</button>
              <button onClick={() => goToPage('lotid')} className={`nav-link ${activePage === 'lotid' ? 'active' : ''}`}>Lot ID Tracker</button>
              <button onClick={() => goToPage('sku-po')} className={`nav-link ${activePage === 'sku-po' ? 'active' : ''}`}>SKU PO</button>
            </div>
            <div className="nav-actions">
              <button onClick={handleSignOut} className="btn-secondary">
                Sign Out
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
              />
            </div>
          </section>
        </>
      ) : (
        <div className="main-card neon-glow">

        {/* Main Content */}
          <div className="main-content">
            <div className="page-transition" key={activePage}>
            {activePage === 'payments' ? (
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
              <LotIDTracker />
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
