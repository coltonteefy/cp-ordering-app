import { useState } from 'react';
import { signInWithEmailAndPassword, signInAnonymously, signOut } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import './LoginForm.css';

const LoginForm = ({ onSuccess, onError, onVendorSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [vendorPasscode, setVendorPasscode] = useState('');
  const [vendorMode, setVendorMode] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      onError('Login failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGuestAccess = async () => {
    setLoading(true);
    try {
      await signInAnonymously(auth);
    } catch (error) {
      onError('Guest access failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVendorPasscode = async (e) => {
    e.preventDefault();
    if (!vendorPasscode.trim()) return;
    setLoading(true);
    try {
      // Sign in anonymously first so Firestore rules allow the read
      await signInAnonymously(auth);
      const vendorsRef = collection(db, 'c&pVendors');
      const q = query(vendorsRef, where('passcode', '==', vendorPasscode.trim()));
      const snap = await getDocs(q);
      if (snap.empty) {
        // Wrong passcode — sign back out
        await auth.currentUser?.delete().catch(() => signOut(auth));
        onError('Invalid passcode. Please try again.');
        setLoading(false);
        return;
      }
      const vendorName = snap.docs[0].data().name;
      if (onVendorSuccess) onVendorSuccess(vendorName);
    } catch (error) {
      onError('Vendor access failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-form-container-inline">
      <h2 className="text-glow-fuchsia">ADMIN ACCESS</h2>
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label htmlFor="email">Admin ID</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@domain.net"
            required
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Admin Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="• • • • • •"
            required
            disabled={loading}
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-neon-cyan" disabled={loading}>
            {loading ? 'Accessing...' : 'Access System'}
          </button>
        </div>
      </form>
      <div className="auth-guest-divider">
        <span>or</span>
      </div>
      {vendorMode ? (
        <div className="auth-vendor">
          <form onSubmit={handleVendorPasscode} className="auth-vendor-form">
            <div className="form-group">
              <label htmlFor="vendor-passcode">Vendor Passcode</label>
              <input
                type="password"
                id="vendor-passcode"
                value={vendorPasscode}
                onChange={(e) => setVendorPasscode(e.target.value)}
                placeholder="Enter your passcode"
                required
                disabled={loading}
                autoFocus
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-neon-cyan" disabled={loading || !vendorPasscode.trim()}>
                {loading ? 'Verifying...' : 'Vendor Access'}
              </button>
              <button
                type="button"
                className="btn-guest"
                onClick={() => { setVendorMode(false); setVendorPasscode(''); }}
                disabled={loading}
              >
                Back
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="auth-guest">
          <button
            type="button"
            className="btn-neon-cyan"
            style={{ marginBottom: '0.5rem', width: '100%' }}
            onClick={() => setVendorMode(true)}
            disabled={loading}
          >
            Vendor Access
          </button>
          <button
            type="button"
            className="btn-guest"
            onClick={handleGuestAccess}
            disabled={loading}
          >
            {loading ? 'Accessing...' : 'Guest Access (Lot Tracker Only)'}
          </button>
        </div>
      )}
    </div>
  );
};

export default LoginForm;