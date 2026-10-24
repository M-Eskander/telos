import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Loading } from '../ui.jsx';

const API_SCRIPT = '/web-apps/apps/api/documents/api.js';
const OPEN_TIMEOUT_MS = 30000;
const CONFIG_TIMEOUT_MS = 30000;
let apiPromise = null;

// The editor's own script is served by the self-hosted Document Server through
// Caddy, on this same origin. Load it once per page and keep the promise so a
// React StrictMode remount does not add a second script tag.
function loadOnlyOfficeApi() {
  if (window.DocsAPI) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (error) {
        apiPromise = null;
        reject(error);
      } else if (window.DocsAPI) {
        resolve();
      } else {
        apiPromise = null;
        reject(new Error('The ONLYOFFICE API loaded without DocsAPI.'));
      }
    };
    const timer = window.setTimeout(
      () => finish(new Error('The ONLYOFFICE API took too long to load.')),
      20000
    );
    script.src = API_SCRIPT;
    script.async = true;
    script.onload = () => finish(null);
    script.onerror = () => finish(new Error('The ONLYOFFICE API could not be loaded.'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

function editorCopy(error, isContract = false) {
  const doc = isContract ? 'contract layout' : 'workbook';
  const where = isContract ? 'the Contracts tab' : 'the quick grid';
  if (!error) {
    return {
      title: 'The full editor didn’t open',
      message: `ONLYOFFICE could not start. Your ${doc} is still in the project and available in ${where}.`
    };
  }
  if (error.status === 403) {
    return {
      title: isContract ? 'You can’t edit this contract layout here' : 'You can’t edit this workbook here',
      message: `Only project managers can open the full editor. You can still read the ${doc} in ${where}.`
    };
  }
  if (error.status === 401) {
    return {
      title: 'Your session has expired',
      message: `Sign in again to open the full editor. Your ${doc} is still in the project.`
    };
  }
  if (error.status === 503) {
    return {
      title: 'The full editor isn’t set up yet',
      message: `The studio server has not finished the ONLYOFFICE configuration. Your ${doc} is safe in ${where}.`
    };
  }
  if (error.status === 422 || error.status === 404) {
    return isContract
      ? {
        title: 'This project has no Word layout',
        message: 'Upload a Word file in the Contracts tab first, then open the layout editor.'
      }
      : {
        title: 'This project has no workbook to open',
        message: 'Import an .xlsx file in the quick grid first, then open the full editor.'
      };
  }
  if (error.status === 0) {
    return {
      title: 'The editor couldn’t reach the server',
      message: `Check your connection and try again. Your ${doc} is still in the project.`
    };
  }
  if (String(error.message || '').includes('taking too long')) {
    return {
      title: 'The editor is taking too long',
      message: `ONLYOFFICE did not finish opening the ${doc}. Try again, or use ${where} in the meantime.`
    };
  }
  if (String(error.message || '').includes('ONLYOFFICE')) {
    return {
      title: 'ONLYOFFICE didn’t load',
      message: `The editor assets could not be loaded. Your ${doc} is safe in ${where}, and you can try again.`
    };
  }
  return {
    title: 'The full editor didn’t open',
    message: `Something went wrong while starting the editor. Your ${doc} is still in the project and available in ${where}.`
  };
}

function LegalFooter() {
  return (
    <footer className="full-editor-legal">
      Full editor powered by{' '}
      <a href="https://www.onlyoffice.com" target="_blank" rel="noreferrer">ONLYOFFICE Docs</a>{' '}
      9.4.0.1 (Community Edition, unmodified), © 2009–2026 Ascensio System SIA.{' '}
      <a
        href="https://github.com/ONLYOFFICE/DocumentServer/blob/v9.4.0/LICENSE"
        target="_blank"
        rel="noreferrer"
      >
        AGPLv3 and additional terms
      </a>
      {' · '}
      <a href="https://github.com/ONLYOFFICE/DocumentServer" target="_blank" rel="noreferrer">Source</a>
      {' · '}
      <a href="https://www.onlyoffice.com/trademark-policy" target="_blank" rel="noreferrer">Trademark policy</a>
    </footer>
  );
}

function EditorFallback({ title, message, backPath, backLabel, note, onRetry }) {
  return (
    <div className="full-editor-fallback">
      <div className="card">
        <p className="full-editor-eyebrow">Full editor</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="row wrap">
          {onRetry ? (
            <button type="button" className="button-like" onClick={onRetry}>Try again</button>
          ) : null}
          <Link className="button-like" to={backPath}>{backLabel}</Link>
        </div>
        <p className="full-editor-fallback-note">
          {note || 'Your document is still in the project and available in the quick grid.'}
        </p>
      </div>
    </div>
  );
}

function EditorPageFrame({ backPath, backLabel, title, projectName, status, children }) {
  return (
    <div className="full-editor">
      <header className="full-editor-bar">
        <div className="full-editor-heading">
          <Link className="full-editor-back" to={backPath}>{backLabel}</Link>
          <span className="full-editor-title">{title}</span>
          {projectName ? <span className="full-editor-project">{projectName}</span> : null}
        </div>
        {status ? (
          <div className="row">
            <span className="full-editor-status" role="status" aria-live="polite">{status}</span>
          </div>
        ) : null}
      </header>
      <div className="full-editor-body">{children}</div>
      <LegalFooter />
    </div>
  );
}

function FullEditorLoading({ label }) {
  return (
    <div className="full-editor">
      <div className="full-editor-body">
        <div className="onlyoffice-loading">
          <Loading label={label} />
        </div>
      </div>
    </div>
  );
}

export default function ProjectSheetEditor({ kind = 'sheet' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const isContract = kind === 'contract';
  const pageTitle = isContract ? 'Contract layout' : 'Full editor';
  const backPath = isContract ? `/projects/${id}?tab=contracts` : `/projects/${id}?tab=sheet`;
  const backLabel = isContract ? '← Contracts' : '← Quick grid';
  const configPath = isContract
    ? `/projects/${id}/contract-template/onlyoffice/config`
    : `/projects/${id}/onlyoffice/config`;
  const editorPath = isContract
    ? `/projects/${id}/contract-template/editor`
    : `/projects/${id}/sheet/editor`;
  const [config, setConfig] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState(null);
  const [opened, setOpened] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  // React must never own the editor's children: ONLYOFFICE moves/replaces the
  // iframe node, and a later React removeChild would crash the whole page.
  const hostRef = useRef(null);

  useEffect(() => {
    const previous = document.title;
    document.title = `${pageTitle} · Telos`;
    return () => { document.title = previous; };
  }, [pageTitle]);

  useEffect(() => {
    if (!ready || !user || DEMO) return undefined;
    let cancelled = false;
    let timer = null;
    setError(null);
    setConfig(null);
    setOpened(false);
    setAppReady(false);
    setSaving(false);

    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error('ONLYOFFICE is taking too long to configure the editor.')),
        CONFIG_TIMEOUT_MS
      );
    });
    Promise.race([api(configPath), timeout])
      .then((response) => {
        if (cancelled) return;
        setProjectName(response.projectName || '');
        setConfig(response.config);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError);
      })
      .finally(() => {
        if (timer) window.clearTimeout(timer);
      });
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [configPath, ready, user]);

  useEffect(() => {
    if (!config || DEMO) return undefined;
    let cancelled = false;
    let openedHere = false;
    let timer = null;

    const fail = (reason) => {
      if (cancelled) return;
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      const failure = reason instanceof Error
        ? reason
        : new Error(`ONLYOFFICE could not open this ${isContract ? 'contract layout' : 'workbook'}.`);
      console.error('[onlyoffice]', failure);
      setError(failure);
      try { editorRef.current?.destroyEditor?.(); } catch { /* the editor is already gone */ }
      editorRef.current = null;
      try { hostRef.current?.replaceChildren(); } catch { /* React will remove the empty host */ }
    };

    loadOnlyOfficeApi()
      .then(() => {
        if (cancelled) return;
        if (!window.DocsAPI) throw new Error('The ONLYOFFICE API is not available.');
        const host = hostRef.current;
        if (!host) throw new Error('The editor container is not ready.');

        // Only React owns this host div. The editor node below is created and
        // destroyed imperatively so React never sees the iframe it becomes.
        host.replaceChildren();
        const editorId = `onlyoffice-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const editorNode = document.createElement('div');
        editorNode.id = editorId;
        editorNode.className = 'onlyoffice-editor-instance';
        host.appendChild(editorNode);

        editorRef.current = new window.DocsAPI.DocEditor(editorId, {
          ...config,
          events: {
            onAppReady: () => {
              if (!cancelled) setAppReady(true);
            },
            onDocumentReady: () => {
              if (cancelled) return;
              openedHere = true;
              if (timer) window.clearTimeout(timer);
              setOpened(true);
            },
            onDocumentStateChange: (event) => {
              if (!cancelled) setSaving(Boolean(event && event.data));
            },
            onRequestClose: () => {
              if (!cancelled) navigate(backPath);
            },
            onError: (event) => {
              console.error('[onlyoffice] editor error', event);
              fail(new Error(`ONLYOFFICE could not open this ${isContract ? 'contract layout' : 'workbook'}.`));
            }
          }
        });

        timer = window.setTimeout(() => {
          if (!cancelled && !openedHere) {
            fail(new Error('ONLYOFFICE is taking too long to start.'));
          }
        }, OPEN_TIMEOUT_MS);
      })
      .catch((loadError) => fail(loadError));

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      try { editorRef.current?.destroyEditor?.(); } catch { /* the editor is already gone */ }
      editorRef.current = null;
      try { hostRef.current?.replaceChildren(); } catch { /* React will remove the empty host */ }
    };
  }, [config, backPath, isContract, navigate]);

  if (DEMO) {
    return (
      <EditorPageFrame
        backPath={backPath}
        backLabel={backLabel}
        title={pageTitle}
        projectName="Preview"
        status="Preview"
      >
        <EditorFallback
          title="The full editor runs on the studio server"
          message={isContract
            ? 'This embedded preview stays in the Contracts tab. The live studio opens the project’s Word layout in ONLYOFFICE.'
            : 'This embedded preview stays in the quick grid. The live studio opens the original workbook in ONLYOFFICE.'}
          backPath={backPath}
          backLabel={backLabel}
          note="No changes are made in this preview."
        />
      </EditorPageFrame>
    );
  }

  if (!ready) return <FullEditorLoading label="Restoring your session…" />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: editorPath }} />;
  }

  const copy = editorCopy(error, isContract);
  const status = error
    ? ''
    : saving
      ? 'Saving changes…'
      : opened
        ? 'Autosave is on'
        : appReady
          ? `Opening the ${isContract ? 'contract layout' : 'workbook'}…`
          : 'Preparing the editor…';

  return (
    <EditorPageFrame
      backPath={backPath}
      backLabel={backLabel}
      title={pageTitle}
      projectName={projectName}
      status={status}
    >
      {/* This host is always mounted and has no React children. ONLYOFFICE's
          iframe lives in the imperatively created child below. */}
      <div ref={hostRef} className="onlyoffice-host" />
      {!error && !opened ? (
        <div className="onlyoffice-loading" role="status" aria-live="polite">
          <Loading label={`Opening the ${isContract ? 'contract layout' : 'full editor'}…`} />
        </div>
      ) : null}
      {error ? (
        <EditorFallback
          title={copy.title}
          message={copy.message}
          backPath={backPath}
          backLabel={backLabel}
          note={isContract ? 'Your Word layout is still in the Contracts tab.' : undefined}
          onRetry={() => window.location.reload()}
        />
      ) : null}
    </EditorPageFrame>
  );
}
