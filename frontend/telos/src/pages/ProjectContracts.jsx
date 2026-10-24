import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, Empty, ErrorNote, Field, Loading, Modal, ask, fmtDate, notify, useAsync, useSubmit } from '../ui.jsx';

const PLACEHOLDERS = ['Name', 'Department', 'Role', 'Hours', 'Share', 'Project', 'Studio', 'StartDate', 'EndDate'];

// The contract layout of a project and the contracts made from it.
export default function ProjectContracts({ projectId, canEdit = false }) {
  const template = useAsync(() => api(`/projects/${projectId}/contract-template`), [projectId]);
  const contracts = useAsync(() => api(`/projects/${projectId}/contracts`), [projectId]);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(null);
  const [layoutName, setLayoutName] = useState('');
  const [makerOpen, setMakerOpen] = useState(false);
  const [scope, setScope] = useState('sheet');
  const [personChoice, setPersonChoice] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [roster, setRoster] = useState({ loading: false, data: null, error: null });
  const save = useSubmit();
  const make = useSubmit();

  useEffect(() => {
    if (template.data?.template?.body) setBody(template.data.template.body);
  }, [template.data?.template?.body]);

  if (template.loading && !template.data) return <Loading label="Opening the contract…" />;
  if (template.error) return <ErrorNote error={template.error} retry={template.reload} />;

  const layout = template.data?.template;
  const list = contracts.data?.contracts || [];
  const signedContracts = list.filter((contract) => contract.source === 'uploaded');
  const madeContracts = list.filter((contract) => contract.source !== 'uploaded');
  const hasWord = Boolean(layout?.docx_key);
  const readyPeople = roster.data?.people || [];
  const waitingPeople = roster.data?.waiting || [];
  const canChoose = !roster.loading && !roster.error && readyPeople.length > 0;
  const canMake = canChoose && (scope === 'sheet' || Boolean(personChoice));
  const readingPdfUrl = reading
    ? `/api/projects/${projectId}/contracts/${reading.id}/file/pdf`
    : null;
  const readingWordUrl = reading
    ? `/api/projects/${projectId}/contracts/${reading.id}/file/word`
    : null;

  const uploadLayout = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('layout', file);
    form.append('name', layout?.name || 'Project Contract');
    if (body) form.append('body', body);
    try {
      await api(`/projects/${projectId}/contract-template`, { method: 'PUT', form });
      setLayoutName(file.name);
      notify('Word template uploaded. Make the contracts to fill it in.');
      template.reload();
    } catch (error) {
      notify(error.message || 'Could not read that file');
    }
  };

  const saveLayout = async () => {
    await save.submit(async () => {
      await api(`/projects/${projectId}/contract-template`, { method: 'PUT', body: { name: layout?.name, body } });
      setEditing(false);
      notify('Contract fallback text saved');
      template.reload();
    });
  };

  const loadRoster = async () => {
    setRoster({ loading: true, data: null, error: null });
    try {
      const data = await api(`/projects/${projectId}/contracts/people`);
      setRoster({ loading: false, data, error: null });
      return data;
    } catch (error) {
      setRoster({ loading: false, data: null, error });
      return null;
    }
  };

  const openMaker = () => {
    make.setError(null);
    setScope('sheet');
    setPersonChoice('');
    setRoster({ loading: true, data: null, error: null });
    setMakerOpen(true);
    loadRoster();
  };

  const generate = async () => {
    await make.submit(async () => {
      const result = await api(`/projects/${projectId}/contracts/generate`, {
        method: 'POST',
        body: scope === 'person' ? { person: personChoice } : {}
      });
      let madeContract = null;
      if (result.scope === 'person' && result.contracts?.[0]) {
        try {
          const latest = await api(`/projects/${projectId}/contracts`);
          madeContract = (latest.contracts || []).find((contract) => contract.id === result.contracts[0]) || null;
        } catch {
          // The list below reloads anyway; a failed preview must not hide the
          // fact that the contract was made.
        }
      }

      const made = Number(result.people) || 0;
      const parts = [
        result.scope === 'person'
          ? `Contract made for ${result.person}`
          : `${made} ${made === 1 ? 'contract' : 'contracts'} made`
      ];
      if (result.documents) {
        parts.push(`${result.documents} Word ${result.documents === 1 ? 'file' : 'files'} ready`);
      }
      if (result.pdfs) {
        parts.push(`${result.pdfs} ${result.pdfs === 1 ? 'PDF' : 'PDFs'}`);
      }
      if (made > 0 && !result.documents) {
        parts.push('Upload the Word layout to add the filled Word files and PDFs');
      } else if (result.documents && !result.pdfs) {
        parts.push('PDFs could not be made on this server');
      }
      const uploaded = (result.uploaded || []).length;
      if (uploaded) {
        parts.push(`${uploaded} uploaded ${uploaded === 1 ? 'contract was' : 'contracts were'} kept`);
      }
      const waiting = (result.waiting || []).length;
      if (waiting) {
        parts.push(`${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting for weekly hours`);
      }

      setMakerOpen(false);
      contracts.reload();
      notify(`${parts.join('. ')}.`);
      if (madeContract) setReading(madeContract);
    });
  };

  const deleteGeneratedContract = async (contract) => {
    if (contract.source !== 'generated' || deletingId === contract.id) return;
    const confirmed = await ask(
      'Delete the unsigned contract for ' + contract.person_name + '?',
      'Delete contract',
      [
        'Its generated PDF and Word files will be permanently removed.',
        'The project sheet, contract layout, and uploaded signed contracts will remain.'
      ]
    );
    if (!confirmed) return;

    setDeletingId(contract.id);
    try {
      await api('/projects/' + projectId + '/contracts/' + contract.id, { method: 'DELETE' });
      contracts.reload();
      notify('Generated contract for ' + contract.person_name + ' deleted.');
    } catch (error) {
      notify(error.message || 'Could not delete that generated contract.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="split contracts-split">
      <section>
        <div className="page-head section-head">
          <div className="page-title"><h2>The layout</h2></div>
          {canEdit && !editing && (
            <div className="page-actions">
              <button onClick={() => setEditing(true)}>
                {hasWord ? 'Edit the fallback text' : 'Edit the text'}
              </button>
            </div>
          )}
        </div>
        <p className="muted">
          {hasWord
            ? 'Contracts made from the sheet use the Word file below. Open it in the Word editor to change the wording, spacing and layout. The text here is a readable fallback.'
            : 'Contracts made from the sheet use this text with the person’s row from the sheet put in. Upload the studio’s Word file below to make the real, laid-out contracts instead.'}
        </p>

        {canEdit && (
          <div className="card mt">
            <h3>The Word file</h3>
            <p className="muted">
              {hasWord
                ? `The studio's Word file is in place${layout?.original_docx_name ? ` (${layout.original_docx_name})` : ''}. Edit it here, then make the contracts again to fill the new version.`
                : 'Upload the Word file of the contract. The placeholders inside it are filled with the row of each person, and the app makes their PDF.'}
            </p>
            <div className="row wrap">
              {hasWord && (
                <Link className="button-like primary" to={`/projects/${projectId}/contract-template/editor`}>
                  Edit the Word layout
                </Link>
              )}
              <label className="button-like">
                {hasWord ? 'Replace the Word file' : 'Upload the Word file'}
                <input
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => uploadLayout(event.target.files[0])}
                />
              </label>
            </div>
            {hasWord && (
              <small className="muted block contract-editor-hint">
                The editor opens the real .docx, including its tables, images and page setup.
              </small>
            )}
            {layoutName && <small className="muted block">Just uploaded: {layoutName}</small>}
          </div>
        )}

        <ErrorNote error={save.error} />
        {editing ? (
          <>
            <textarea
              className="layout-editor"
              rows={22}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              aria-label="Contract layout"
            />
            <p className="muted">Placeholders: {PLACEHOLDERS.map((name) => `{{${name}}}`).join(' · ')}</p>
            <div className="row">
              <button className="primary" disabled={save.busy} onClick={saveLayout}>{save.busy ? 'Saving…' : 'Save the fallback text'}</button>
              <button onClick={() => { setEditing(false); setBody(layout?.body || ''); }}>Cancel</button>
            </div>
          </>
        ) : hasWord ? (
          <details className="layout-fallback">
            <summary>Show the readable fallback text</summary>
            <pre className="layout-preview">{body}</pre>
          </details>
        ) : (
          <pre className="layout-preview">{body}</pre>
        )}
      </section>

      <section>
        <div className="page-head section-head">
          <div className="page-title"><h2>Contracts</h2></div>
          {canEdit && (
            <div className="page-actions">
              <button className="primary" disabled={make.busy} onClick={openMaker}>
                {make.busy ? 'Making…' : 'Make from the sheet'}
              </button>
            </div>
          )}
        </div>
        <ErrorNote error={make.error} />
        <ErrorNote error={contracts.error} retry={contracts.reload} />
        {list.length === 0 ? (
          <Empty title="No contracts yet" mood="happy">
            {canEdit
              ? 'Add someone on the Team tab with their project contract, or put weekly hours in the sheet and make contracts from it.'
              : 'The studio has not made the contracts for this project yet.'}
          </Empty>
        ) : (
          <div className="stack mt">
            <ContractGroup
              title="Signed contracts"
              hint="Uploaded as the person's project contract when they joined. These PDFs are signed."
              contracts={signedContracts}
              empty="No signed contracts uploaded yet."
              projectId={projectId}
              onPreview={setReading}
            />
            <ContractGroup
              title="Made from the sheet"
              hint="Generated from the project's layout and sheet. These are not signed."
              contracts={madeContracts}
              empty="No contracts have been made from the sheet yet."
              projectId={projectId}
              onPreview={setReading}
              canDelete={canEdit}
              deletingId={deletingId}
              onDelete={deleteGeneratedContract}
            />
          </div>
        )}
      </section>

      {makerOpen && (
        <Modal title="Make contracts" onClose={() => { if (!make.busy) setMakerOpen(false); }} wide>
          <p className="contract-maker-lead">
            Choose whether this run should make or update a contract for everyone on the sheet, or only one person.
          </p>

          {roster.loading && <Loading label="Reading the Team sheet…" />}
          <ErrorNote error={roster.error} retry={loadRoster} />
          {roster.error && (
            <p className="muted contract-maker-error-note">
              The contract maker reads the <strong>Team</strong> and <strong>Summary</strong> tabs.
              {' '}
              <Link className="link" to={`/projects/${projectId}?tab=sheet`}>Open the Sheet</Link>.
            </p>
          )}

          {!roster.loading && !roster.error && (
            <>
              <div className="contract-scope-grid" role="radiogroup" aria-label="Who to make contracts for">
                <label className={`contract-scope ${scope === 'sheet' ? 'on' : ''}`}>
                  <input
                    type="radio"
                    name="contract-scope"
                    value="sheet"
                    checked={scope === 'sheet'}
                    onChange={() => setScope('sheet')}
                  />
                  <span className="contract-scope-body">
                    <span className="contract-scope-title">Everyone on the sheet</span>
                    <span className="contract-scope-count">
                      {readyPeople.length} {readyPeople.length === 1 ? 'person ready' : 'people ready'}
                    </span>
                    <small>Makes or updates a contract for every person with weekly hours. Uploaded contracts are kept.</small>
                  </span>
                </label>
                <label className={`contract-scope ${scope === 'person' ? 'on' : ''}`}>
                  <input
                    type="radio"
                    name="contract-scope"
                    value="person"
                    checked={scope === 'person'}
                    onChange={() => setScope('person')}
                  />
                  <span className="contract-scope-body">
                    <span className="contract-scope-title">One person only</span>
                    <span className="contract-scope-count">A single contract</span>
                    <small>Choose one person from the Team sheet. Everyone else stays as they are.</small>
                  </span>
                </label>
              </div>

              {scope === 'person' && (
                <Field label="Person">
                  <select value={personChoice} onChange={(event) => setPersonChoice(event.target.value)}>
                    <option value="">Choose a person…</option>
                    {readyPeople.map((person) => (
                      <option key={person.name} value={person.name}>
                        {person.name}{person.role ? ` — ${person.role}` : ''} · {person.hours} h
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {waitingPeople.length > 0 && (
                <p className="contract-waiting">
                  <strong>Waiting for weekly hours:</strong>{' '}
                  {waitingPeople.map((person) => person.name).join(', ')}
                </p>
              )}

              {readyPeople.length === 0 && (
                <p className="contract-waiting">
                  No one has weekly hours yet. Add them in the Team tab first.{' '}
                  <Link className="link" to={`/projects/${projectId}?tab=sheet`}>Open the Sheet</Link>.
                </p>
              )}

              <p className="contract-maker-note">
                {hasWord
                  ? 'The project Word layout will be filled for each contract. You can edit that layout from the Contracts tab.'
                  : 'No Word layout is uploaded yet. The contracts will be saved without files until you upload one.'}
              </p>
            </>
          )}

          <ErrorNote error={make.error} />
          <footer>
            <button type="button" onClick={() => setMakerOpen(false)} disabled={make.busy}>Cancel</button>
            <button
              type="button"
              className="primary"
              disabled={!canMake || make.busy}
              onClick={generate}
            >
              {make.busy
                ? 'Making…'
                : scope === 'person'
                  ? `Make ${personChoice || 'the contract'}`
                  : readyPeople.length
                    ? `Make ${readyPeople.length} ${readyPeople.length === 1 ? 'contract' : 'contracts'}`
                    : 'Make contracts'}
            </button>
          </footer>
        </Modal>
      )}

      {reading && (
        <Modal title={`Contract — ${reading.person_name}`} onClose={() => setReading(null)} wide extraWide>
          <div className="contract-preview-meta">
            <span className="row wrap">
              {reading.source === 'uploaded'
                ? <Badge kind="done">Signed</Badge>
                : <Badge kind="warn">Not signed</Badge>}
              <span>
                {reading.source === 'uploaded'
                  ? 'Uploaded project contract'
                  : `${reading.data.Department} · ${reading.data.Role} · ${reading.data.Hours} h · ${reading.data.Share}`}
              </span>
            </span>
            <span className="muted">
              {fmtDate(reading.start_date)}{reading.end_date ? ` – ${fmtDate(reading.end_date)}` : ' · open-ended'}
            </span>
          </div>

          {reading.has_pdf ? (
            <iframe
              className="contract-preview-frame"
              title={`Contract for ${reading.person_name}`}
              src={`${readingPdfUrl}?inline=1#toolbar=1&navpanes=0&view=FitH`}
            />
          ) : (
            <div className="contract-preview-empty">
              <strong>No PDF preview yet</strong>
              <p className="muted">
                {reading.has_word
                  ? 'The Word file is ready to download. The PDF has not been made for this contract.'
                  : 'Upload the Word layout, then make this contract again to get a Word file and PDF.'}
              </p>
            </div>
          )}

          {reading.source === 'uploaded' ? (
            <p className="muted">
              This PDF was uploaded with the person’s project membership. Its wording is the uploaded document.
            </p>
          ) : (
            <details className="layout-fallback">
              <summary>Show the readable text</summary>
              <pre className="contract-paper">{reading.document}</pre>
            </details>
          )}

          <footer>
            {reading.has_pdf && (
              <a className="button-like" href={readingPdfUrl} download>Download PDF</a>
            )}
            {reading.has_word && (
              <a className="button-like" href={readingWordUrl} download>Download Word</a>
            )}
            {reading.has_pdf && (
              <a className="button-like" href={`${readingPdfUrl}?inline=1`} target="_blank" rel="noreferrer">Open PDF</a>
            )}
            <button className="primary" onClick={() => setReading(null)}>Close</button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function ContractGroup({ title, hint, contracts, empty, projectId, onPreview, canDelete = false, deletingId = null, onDelete }) {
  return (
    <section>
      <div className="section-head">
        <h3>{title}</h3>
        <span className="muted">{contracts.length}</span>
      </div>
      <p className="muted">{hint}</p>
      {contracts.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="list">
          {contracts.map((contract) => (
            <div className="row-item" key={contract.id}>
              <div>
                <div className="row wrap">
                  <strong>{contract.person_name}</strong>
                  {contract.source === 'uploaded'
                    ? <Badge kind="done">Signed</Badge>
                    : <Badge kind="warn">Not signed</Badge>}
                </div>
                <small className="muted block">
                  {contract.source === 'uploaded'
                    ? 'Signed project contract PDF'
                    : `${contract.data.Department} · ${contract.data.Role} · ${contract.data.Hours} h · ${contract.data.Share}`}
                </small>
                <small className="muted block">
                  {fmtDate(contract.start_date)}{contract.end_date ? ` – ${fmtDate(contract.end_date)}` : ' · open-ended'}
                  {contract.source !== 'uploaded' ? ` · ${contract.status}` : ''}
                </small>
              </div>
              <div className="row">
                {contract.has_pdf && (
                  <a className="link" href={`/api/projects/${projectId}/contracts/${contract.id}/file/pdf`} download>
                    PDF
                  </a>
                )}
                {contract.has_word && (
                  <a className="link" href={`/api/projects/${projectId}/contracts/${contract.id}/file/word`} download>
                    Word
                  </a>
                )}
                <button className="link" onClick={() => onPreview(contract)}>Preview</button>
                {canDelete && contract.source === 'generated' && (
                  <button
                    type="button"
                    className="link danger-text"
                    aria-label={'Delete generated contract for ' + contract.person_name}
                    disabled={deletingId === contract.id}
                    onClick={() => onDelete(contract)}
                  >
                    {deletingId === contract.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
