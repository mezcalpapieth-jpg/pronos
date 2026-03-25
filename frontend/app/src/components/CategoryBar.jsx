import React from 'react';

const FILTERS = [
  { id: 'trending',  label: '🔥 Trending' },
  { id: 'todos',     label: 'Todos' },
  { id: 'mexico',    label: '🇲🇽 México & CDMX' },
  { id: 'politica',  label: '🌎 Política Internacional' },
  { id: 'deportes',  label: '⚽ Deportes' },
  { id: 'crypto',    label: '₿ Crypto' },
];

export default function CategoryBar({ activeFilter, onFilter }) {
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
