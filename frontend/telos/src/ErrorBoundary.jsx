import { Component } from 'react';
import { AuthLayout } from './brand.jsx';

// Catches render errors so a single bad record cannot leave a blank page.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Telos UI crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <AuthLayout>
        <div className="auth" role="alert">
          <h1>Something went wrong</h1>
          <p>Telos hit an unexpected error. Reloading usually fixes it; your data is safe.</p>
          <button className="primary" onClick={() => window.location.reload()}>Reload Telos</button>
          <small className="muted">
            If this keeps happening, send the owner the time it occurred and what you were doing.
          </small>
        </div>
      </AuthLayout>
    );
  }
}
