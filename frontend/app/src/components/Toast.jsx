import React, { useEffect } from 'react';

/**
 * Toast notification component.
 * Props: message, type ('success'|'error'|'info'), onClose
 */
export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  const colors = {
    success: 'var(--green)',
    error: 'var(--red)',
    info: 'var(--text-secondary)',
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '32px',
        right: '32px',
        zIndex: 9999,
        background: 'var(--surface2)',
        border: `1px solid ${colors[type]}`,
        borderRadius: '10px',
        padding: '14px 20px',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        color: colors[type],
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        maxWidth: '340px',
        animation: 'modal-in 0.25s ease',
      }}
    >
      {message}
    </div>
  );
}
