import { useState } from 'react';
import { signInWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import './LoginForm.css';

const LoginForm = ({ onSuccess, onError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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
      <div className="auth-guest">
        <button
          type="button"
          className="btn-guest"
          onClick={handleGuestAccess}
          disabled={loading}
        >
          {loading ? 'Accessing...' : 'Guest Access (Lot Tracker Only)'}
        </button>
      </div>
    </div>
  );
};

export default LoginForm;