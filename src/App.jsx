import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebaseConfig';
import Modal from './components/Modal';
import LoginForm from './components/LoginForm';
import NextOrderList from './components/NextOrderList';
import SubmittedOrders from './components/SubmittedOrders';
import ProductManager from './components/ProductManager';
import PromoSchedule from './components/PromoSchedule';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });
  const [activePage, setActivePage] = useState('orders');

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

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      showModal('Sign out failed: ' + error.message, 'Error');
    }
  };

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
            <div className="nav-menu">
              <button onClick={() => setActivePage('orders')} className={`nav-link ${activePage === 'orders' ? 'active' : ''}`}>Orders</button>
              <button onClick={() => setActivePage('products')} className={`nav-link ${activePage === 'products' ? 'active' : ''}`}>Products</button>
              <button onClick={() => setActivePage('promo')} className={`nav-link ${activePage === 'promo' ? 'active' : ''}`}>Promo Schedule</button>
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
                onSuccess={showModal}
                onError={showModal}
              />
            </div>
          </section>
        </>
      ) : (
        <div className="main-card neon-glow">

        {/* Main Content */}
          <div className="main-content">
            {activePage === 'products' ? (
              <ProductManager 
                onSuccess={showModal}
                onError={showModal}
              />
            ) : activePage === 'promo' ? (
              <PromoSchedule 
                onSuccess={showModal}
                onError={showModal}
              />
            ) : (
              <>
                <NextOrderList 
                  onSuccess={showModal}
                  onError={showModal}
                />
                <SubmittedOrders 
                  onSuccess={showModal}
                  onError={showModal}
                />
              </>
            )}
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
