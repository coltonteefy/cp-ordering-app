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
            <img src="/assets/design.png" alt="Coffee and Peppers Logo" className="nav-logo" />
          </div>
          {user && (
            <>
              <div className="nav-status">
                <div className="status">Status: {status}</div>
                <div className="user-id">User: {user.email}</div>
              </div>
              <div className="nav-actions">
                <button 
                  onClick={() => setShowProductManager(!showProductManager)} 
                  className="btn-neon-lime"
                >
                  {showProductManager ? 'Show Orders' : 'Manage Products'}
                </button>
                <button onClick={handleSignOut} className="btn-neon-cyan">
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

      <div className="main-card neon-glow">

        {/* Main Content */}
        {!user ? (
          <LoginForm 
            onSuccess={showModal}
            onError={showModal}
          />
        ) : (
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
        )}
      </div>

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
