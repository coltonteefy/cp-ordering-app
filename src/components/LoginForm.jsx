import { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import './LoginForm.css';

const LoginForm = ({ onError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleLogin = async (e) => {
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

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      onError('Enter your email address first, then click Forgot Password.');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch (error) {
      onError('Could not send reset email: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-form-container-inline">
      <form onSubmit={handleLogin} className="auth-form">
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            required
            disabled={loading}
            autoComplete="email"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="• • • • • •"
            required
            disabled={loading}
            autoComplete="current-password"
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-neon-cyan" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </form>
      <div className="login-forgot-row">
        {resetSent ? (
          <span className="login-reset-sent">Password reset email sent!</span>
        ) : (
          <button type="button" className="login-forgot-btn" onClick={handleForgotPassword} disabled={loading}>
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
};

export default LoginForm;
