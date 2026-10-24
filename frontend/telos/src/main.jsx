import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { AuthProvider } from './auth.jsx';
import './styles.css';

// Embedded previews (iframes) can't use real URLs, so demo mode there keeps routes in memory.
const Router = import.meta.env.VITE_DEMO && window.top !== window ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <ErrorBoundary>
        <AuthProvider><App /></AuthProvider>
      </ErrorBoundary>
    </Router>
  </StrictMode>
);
