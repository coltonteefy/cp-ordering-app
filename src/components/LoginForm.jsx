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

  const handleVendorPasscode = async (e) => {
    e.preventDefault();
    if (!vendorPasscode.trim()) return;
    setLoading(true);
    try {
      await signInAnonymously(auth);
      const vendorsRef = collection(db, 'c&pVendors');
      const q = query(vendorsRef, where('passcode', '==', vendorPasscode.trim()));
      const snap = await getDocs(q);
      if (snap.empty) {
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
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-neon-cyan" disabled={loading || !vendorPasscode.trim()}>
              {loading ? 'Verifying...' : 'Vendor Access'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;