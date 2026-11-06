import React from 'react';

export default function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div className="header-title-block">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
      </div>
      {children ? <div className="header-controls">{children}</div> : null}
    </header>
  );
}
