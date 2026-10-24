export function Logo({ className = '', sizes = '560px', sidebar = false }) {
  const src = sidebar ? '/telos-logo-sidebar.png' : '/telos-logo.png';
  const srcSet = sidebar
    ? undefined
    : '/telos-logo@1x.png 375w, /telos-logo.png 750w';

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      width={750}
      height={318}
      alt="Telos Studio"
      className={className ? `logo ${className}` : 'logo'}
      draggable="false"
      decoding="async"
    />
  );
}

export function AuthLayout({ children }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand paper-surface" aria-label="Telos Studio">
        <div className="auth-brand-lockup">
          <Logo
            className="auth-logo"
            sizes="(max-width: 900px) 220px, 560px"
          />
        </div>
        <p className="auth-foot">Telos Studio · Team Portal</p>
      </aside>
      <main className="auth-main">
        <div className="auth-panel">{children}</div>
      </main>
    </div>
  );
}
