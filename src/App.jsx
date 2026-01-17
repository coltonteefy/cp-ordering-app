import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebaseConfig';
import Modal from './components/Modal';
import LoginForm from './components/LoginForm';
import NextOrderList from './components/NextOrderList';
import SubmittedOrders from './components/SubmittedOrders';
import ProductManager from './components/ProductManager';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });
  const [showProductManager, setShowProductManager] = useState(false);

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
      {/* Navigation */}
      <nav className="app-nav">
        <div className="nav-content">
          <div className="nav-brand">
            <img src="/assets/logo.png" alt="Coffee and Peppers Logo" className="nav-logo" />
          </div>
          <div className="nav-menu">
            {user ? (
              <>
                <button onClick={() => setShowProductManager(false)} className={`nav-link ${!showProductManager ? 'active' : ''}`}>Orders</button>
                <button onClick={() => setShowProductManager(true)} className={`nav-link ${showProductManager ? 'active' : ''}`}>Products</button>
              </>
            ) : (
              <>
                <a href="#products" className="nav-link">Products</a>
                <a href="#about" className="nav-link">About</a>
              </>
            )}
          </div>
          <div className="nav-actions">
            {user ? (
              <>
                <button onClick={handleSignOut} className="btn-secondary">
                  Sign Out
                </button>
              </>
            ) : (
              <button className="nav-cart">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="cart-icon">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </nav>

      {!user ? (
        <>
          {/* Hero Section */}
          <section className="hero">
            <div className="hero-content">
              <div className="hero-text">
                <span className="hero-badge">Research-Grade Peptides</span>
                <h1 className="hero-title">
                  Premium Quality<br />
                  <span className="hero-title-highlight">Peptides</span><br />
                  for Research
                </h1>
                <p className="hero-description">
                  Discover our extensive catalog of high-purity research peptides. 
                  Every batch is third-party tested to ensure exceptional quality for your research needs.
                </p>
                <div className="hero-buttons">
                  <button className="btn-primary">
                    Shop Now
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="btn-icon">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </button>
                  <button className="btn-outline">Learn More</button>
                </div>
                <div className="hero-features">
                  <div className="feature-item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="feature-icon">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                    </svg>
                    <span>99% Purity</span>
                  </div>
                  <div className="feature-item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="feature-icon">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232 1.232 3.286 0 4.536l-1.402 1.402M5 14.5V16c0 1.88.672 3.607 1.788 4.95" />
                    </svg>
                    <span>Lab Tested</span>
                  </div>
                  <div className="feature-item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="feature-icon">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                    </svg>
                    <span>Fast Shipping</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          
          {/* Login Modal for Admin */}
          <LoginForm 
            onSuccess={showModal}
            onError={showModal}
          />
        </>
      ) : (
        <div className="main-card neon-glow">

        {/* Main Content */}
          <div className="main-content">
            {showProductManager ? (
              <ProductManager 
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
