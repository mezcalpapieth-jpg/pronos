import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function Button({ as: Element = 'button', variant = 'secondary', className = '', type = 'button', ...props }) {
  return <Element className={`points-ui-button is-${variant} ${className}`} type={Element === 'button' ? type : undefined} {...props} />;
}

export const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`points-ui-input ${className}`} {...props} />;
});

export function Checkbox({ children, ...props }) {
  return (
    <label className="points-ui-checkbox">
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}

export function Pill({ as: Element = 'span', className = '', ...props }) {
  return <Element className={`points-ui-pill ${className}`} {...props} />;
}

export const Card = forwardRef(function Card({ as: Element = 'section', className = '', ...props }, ref) {
  return <Element ref={ref} className={`points-ui-card ${className}`} {...props} />;
});

export function Modal({ onDismiss, returnFocusTo, className = '', ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  return createPortal(
    <dialog
      ref={ref}
      className={`points-ui-modal ${className}`}
      onCancel={event => {
        event.preventDefault();
        onDismiss();
      }}
      {...props}
    />,
    document.body,
  );
}

export function Tabs({ label, options, value, onChange }) {
  return (
    <div className="points-ui-tabs" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
