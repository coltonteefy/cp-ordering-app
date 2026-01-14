import { useEffect } from 'react';
import './Modal.css';

const Modal = ({ isOpen, title, message, onClose }) => {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className={`modal-backdrop ${isOpen ? 'is-open' : ''}`} onClick={onClose}></div>
      <div className={`modal-main ${isOpen ? 'is-open' : ''}`}>
        <h2 className="modal-title">{title}</h2>
        <p className="modal-message">{message}</p>
        <button onClick={onClose} className="btn-neon-cyan">OK</button>
      </div>
    </>
  );
};

export default Modal;
