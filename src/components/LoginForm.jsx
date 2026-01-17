import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import './LoginForm.css';

const LoginForm = ({ onSuccess, onError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      onError((isSignUp ? 'Sign up failed: ' : 'Login failed: ') + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!showLogin) {
    return (
      <button 
        className="admin-login-trigger"
        onClick={() => setShowLogin(true)}
      >
        Admin Login
      </button>
    );
  }

  return (
    <div className="login-form-overlay" onClick={() => setShowLogin(false)}>
      <div className="login-form-container" onClick={(e) => e.stopPropagation()}>
        <button className="close-login" onClick={() => setShowLogin(false)}>×</button>
      <h2 className="text-glow-fuchsia">{isSignUp ? 'CREATE ADMIN ACCOUNT' : 'ADMIN ACCESS'}</h2>
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
            {loading ? (isSignUp ? 'Creating Account...' : 'Accessing...') : (isSignUp ? 'Create Account' : 'Access System')}
          </button>
        </div>
      </form>
      <div className="auth-toggle">
        <button 
          type="button" 
          onClick={() => setIsSignUp(!isSignUp)} 
          className="toggle-btn"
        >
          {isSignUp ? 'Already have an account? Sign In' : 'Create New Admin Account'}
        </button>
      </div>
      </div>    </div>
  );
};

export default LoginForm;