import React from 'react';

export function Pill({ tone = 'default', children, className = '' }) {
  return <span className={`pill ${tone === 'default' ? '' : tone} ${className}`}>{children}</span>;
}

export function SectionHeader({ title, detail, children }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {children ?? (detail ? <span>{detail}</span> : null)}
    </div>
  );
}

export function Segmented({ options, value, onChange, ariaLabel, className = '' }) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const id = typeof option === 'string' ? option : option.id;
        const label = typeof option === 'string' ? option : option.label;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={value === id}
            className={value === id ? 'is-active' : ''}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Card({ children, className = '', style }) {
  return (
    <div className={`card-surface ${className}`} style={style}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, unit, note, accent = false }) {
  return (
    <Card className={`kpi-card ${accent ? 'is-accent' : ''}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">
        {value}
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </strong>
      {note ? <span className="kpi-note">{note}</span> : null}
    </Card>
  );
}

export function EmptyState({ icon, title, children }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </div>
  );
}
