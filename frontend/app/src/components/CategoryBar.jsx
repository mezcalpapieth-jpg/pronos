import React from 'react';
import { useT } from '../lib/i18n.js';

export default function CategoryBar({ activeFilter, onFilter }) {
  const t = useT();
  const FILTERS = [
    { id: 'trending',  label: t('cat.trending') },
    { id: 'todos',     label: t('cat.all') },
    { id: 'mexico',    label: t('cat.mexico') },
    { id: 'politica',  label: t('cat.politica') },
    { id: 'deportes',  label: t('cat.deportes') },
    { id: 'finanzas',  label: t('cat.finanzas') },
    { id: 'crypto',    label: t('cat.crypto') },
    { id: 'resueltos', label: t('cat.resueltos') },
  ];

  return (
    <div className="category-bar">
      <div className="category-bar-inner">
        <div className="market-filters">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={`filter-btn${activeFilter === f.id ? ' active' : ''}`}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
