import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, list } from '../api.js';
import { Empty, ErrorNote, Field, PageTitle, Panel, tabKeyDown, useAsync, useSubmit } from '../ui.jsx';
import { usePresets } from '../presets.js';
import AttrEditor, { cleanAttrs, normAttr } from './AttrEditor.jsx';

const TABS = [['roles', 'Roles'], ['attributes', 'Attributes'], ['permissions', 'Permissions']];

// The access levels are published by the server, so the labels and
// descriptions live in one place.
const presetByKey = (presets, key) => presets.find((preset) => preset.key === key);

export default function Access() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'roles';
  const tabKeys = TABS.map(([key]) => key);
  const selectTab = (key) => setParams({ tab: key });
  return (
    <>
      <PageTitle>Roles &amp; access</PageTitle>
      <div className="page-head">
        <div className="page-title"><h1>Roles &amp; access</h1></div>
      </div>
      <p className="muted intro">A role bundles access attributes. A permission is allowed when the person holds a matching combination of them.</p>
      <div className="tabs" role="tablist" aria-label="Access settings sections">{TABS.map(([k, l]) => <button key={k} id={'access-tab-' + k} role="tab" aria-controls="access-panel" aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className={tab === k ? 'on' : ''} onClick={() => selectTab(k)} onKeyDown={(event) => tabKeyDown(event, tabKeys, tab, selectTab)}>{l}</button>)}</div>
      <div id="access-panel" role="tabpanel" aria-labelledby={'access-tab-' + tab} tabIndex={0}>
        {tab === 'roles' && <Roles />}
        {tab === 'attributes' && <Attributes />}
        {tab === 'permissions' && <Permissions />}
      </div>
    </>
  );
}

function CreateForm({ fields, onCreate, label }) {
  const [v, setV] = useState({});
  const { busy, error, submit } = useSubmit();
  const go = (e) => { e.preventDefault(); submit(async () => { await onCreate(v); setV({}); }); };
  return (
    <form className="card mt" onSubmit={go}>
      <h3>{label}</h3>
      <div className="two">{fields.map(([k, l, req]) => <Field key={k} label={l}><input required={req} value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div>
      <ErrorNote error={error} />
      <button className="primary" disabled={busy}>Create</button>
    </form>
  );
}

function rolePresetLabel(presets, role) {
  return presetByKey(presets, role.accessPreset)?.label || null;
}

function Roles() {
  const roles = useAsync(() => api('/admin/roles'), []);
  const attrs = useAsync(() => api('/admin/attributes'), []);
  const projects = useAsync(() => api('/projects'), []);
  const { presets } = usePresets();
  const [sel, setSel] = useState(null);
  const rs = list(roles.data, 'roles').filter((r) => r.name !== 'owner');
  useEffect(() => {
    if (sel === null && rs.length > 0) setSel(rs[0].id);
  }, [sel, rs]);
  return (
    <div className="split">
      <section>
        <Panel state={roles} empty={rs.length === 0 ? <Empty title="No roles yet" mood="happy" /> : null}>
          <div className="list">
            {rs.map((r) => (
              <button key={r.id} className={`row-item pick ${sel === r.id ? 'on' : ''}`} onClick={() => setSel(r.id)}>
                <span><strong>{r.name}</strong>{rolePresetLabel(presets, r) && <small className="muted block">{rolePresetLabel(presets, r)}</small>}</span>
              </button>
            ))}
          </div>
        </Panel>
        <CreateRoleForm onCreate={async (v) => {
          await api('/admin/roles', { method: 'POST', body: { name: v.name.trim(), preset: v.preset } });
          roles.reload();
        }} />
      </section>
      <section>
        {sel ? <RoleDetail key={sel} id={sel} attributes={list(attrs.data, 'attributes')} projects={list(projects.data, 'projects')} onReload={roles.reload} /> : <Empty title="Select a role" mood="happy">Choose a role to edit the attributes it grants.</Empty>}
      </section>
    </div>
  );
}

function CreateRoleForm({ onCreate }) {
  const [v, setV] = useState({ name: '', preset: '' });
  const { busy, error, submit } = useSubmit();
  const { presets } = usePresets();
  const selected = presetByKey(presets, v.preset);
  const go = (e) => {
    e.preventDefault();
    if (!v.name.trim() || !v.preset) return;
    submit(async () => { await onCreate(v); setV({ name: '', preset: '' }); });
  };
  return (
    <form className="card mt" onSubmit={go}>
      <h3>New role</h3>
      <Field label="Role name"><input required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Creative Director" /></Field>
      <fieldset className="levels-field">
        <legend>Access level</legend>
        <p className="muted levels-hint">The role starts with this access. You can fine-tune its attributes below.</p>
        <div className="levels" role="radiogroup" aria-label="Access level">
          {presets.map((preset) => (
            <label key={preset.key} className={`level ${v.preset === preset.key ? 'on' : ''}`}>
              <input
                type="radio"
                name="access-level"
                value={preset.key}
                checked={v.preset === preset.key}
                onChange={(e) => setV({ ...v, preset: e.target.value })}
              />
              <span className="level-dot" aria-hidden="true" />
              <span className="level-label">{preset.label}</span>
              <span className="level-desc">{preset.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {selected && <p className="muted">{selected.description}</p>}
      <ErrorNote error={error} />
      <button className="primary" disabled={busy || !v.preset}>Create</button>
    </form>
  );
}

function RoleDetail({ id, attributes, projects, onReload }) {
  const state = useAsync(() => api(`/admin/roles/${id}`), [id]);
  const [rows, setRows] = useState([]);
  const [presetKey, setPresetKey] = useState('');
  useEffect(() => {
    if (!state.data) return;
    setRows((state.data.role?.attributes || []).map(normAttr));
    setPresetKey(state.data.role?.accessPreset || '');
  }, [state.data]);
  const { busy, error, submit } = useSubmit();
  const [saved, setSaved] = useState(false);
  const { presets } = usePresets();
  const applyPreset = (key) => {
    setSaved(false);
    setPresetKey(key);
    const preset = presetByKey(presets, key);
    if (!preset) return;
    const attribute = attributes.find((a) => a.name === preset.attribute && a.resource === 'project');
    if (!attribute) return;
    setRows([{ attributeId: attribute.id, resourceId: null }]);
  };
  const save = () => {
    setSaved(false);
    submit(async () => {
      await api(`/admin/roles/${id}/attributes`, { method: 'PUT', body: { attributes: cleanAttrs(rows) } });
      setSaved(true);
      onReload?.();
    });
  };
  const selectedPreset = presetByKey(presets, presetKey);
  return (
    <Panel state={state}>
      <div className="card">
        <h2>{state.data?.role?.name}</h2>
        {selectedPreset && <p className="muted">Access level: <strong>{selectedPreset.label}</strong>. {selectedPreset.description}</p>}
        <Field label="Access level" hint="Applying a preset replaces the attributes below with that preset's starting point.">
          <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
            <option value="">Custom / mixed</option>
            {presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
          </select>
        </Field>
        <AttrEditor value={rows} onChange={(next) => { setSaved(false); setPresetKey(''); setRows(next); }} attributes={attributes} projects={projects} />
        <ErrorNote error={error} />
        {saved && <p className="ok" role="status">Saved.</p>}
        <button className="primary mt" disabled={busy} onClick={save}>Save role</button>
      </div>
    </Panel>
  );
}

function Attributes() {
  const state = useAsync(() => api('/admin/attributes'), []);
  const items = list(state.data, 'attributes');
  return (
    <>
      <Panel state={state} empty={items.length === 0 ? <Empty title="No attributes yet" mood="happy" /> : null}>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Name</th><th scope="col">Resource</th><th scope="col">Description</th></tr></thead>
          <tbody>{items.map((a) => <tr key={a.id}><td><strong>{a.name}</strong></td><td>{a.resource}</td><td className="muted">{a.description}</td></tr>)}</tbody>
        </table></div>
      </Panel>
      <CreateForm label="New attribute" fields={[['name', 'Name', true], ['resource', 'Resource (e.g. project)', true], ['description', 'Description']]}
        onCreate={async (v) => { await api('/admin/attributes', { method: 'POST', body: { name: v.name.trim(), resource: v.resource.trim(), description: v.description || undefined } }); state.reload(); }} />
    </>
  );
}

const attrKey = (a) => `${a.name}\u0000${a.resource}`;

// Reads return expanded { name, resource } descriptors; saves need catalog IDs, so resolve by (name, resource).
function resolveAlternatives(p, attributes) {
  const idByKey = new Map(attributes.map((a) => [attrKey(a), a.id]));
  let unresolved = 0;
  const alts = (p.alternatives || []).map((alt) => alt.flatMap((d) => {
    const id = idByKey.get(attrKey(d));
    if (id == null) { unresolved += 1; return []; }
    return [id];
  }));
  return { alts, unresolved };
}

function Permissions() {
  const state = useAsync(() => api('/admin/permissions'), []);
  const attrs = useAsync(() => api('/admin/attributes'), []);
  const items = list(state.data, 'permissions');
  const attributes = list(attrs.data, 'attributes');
  return (
    <>
      <ErrorNote error={attrs.error} retry={attrs.reload} />
      <Panel state={state} empty={items.length === 0 ? <Empty title="No permissions defined" mood="happy" /> : null}>
        {attrs.loading && !attrs.data ? <p className="muted pad">Loading…</p> : (
          <div className="stack">{items.map((p) => <PermissionCard key={p.id} p={p} attributes={attributes} onSaved={state.reload} />)}</div>
        )}
      </Panel>
      <CreateForm label="New permission" fields={[['action', 'Action (e.g. read)', true], ['resource', 'Resource (e.g. task)', true], ['description', 'Description']]}
        onCreate={async (v) => { await api('/admin/permissions', { method: 'POST', body: { action: v.action.trim(), resource: v.resource.trim(), description: v.description || undefined } }); state.reload(); }} />
    </>
  );
}

function PermissionCard({ p, attributes, onSaved }) {
  const resolved = useMemo(() => resolveAlternatives(p, attributes), [p, attributes]);
  const [alts, setAlts] = useState(resolved.alts);
  useEffect(() => setAlts(resolved.alts), [resolved]);
  const { busy, error, submit } = useSubmit();
  const [saved, setSaved] = useState(false);
  const updateAlts = (next) => { setSaved(false); setAlts(next); };
  const toggle = (i, id) => updateAlts(alts.map((a, j) => (j === i ? (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]) : a)));
  const save = () => {
    setSaved(false);
    // PUT replaces every grant group; the response echoes IDs only, so refetch for the expanded view.
    submit(async () => { await api(`/admin/permissions/${p.id}/grants`, { method: 'PUT', body: { alternatives: alts } }); setSaved(true); onSaved(); });
  };
  return (
    <div className="card">
      <h3>{p.action}:{p.resource}</h3>
      {p.description && <p className="muted">{p.description}</p>}
      {resolved.unresolved > 0 && <div className="note error">Some attributes on this permission are missing from the catalog, so it can't be edited here safely.</div>}
      {alts.length === 0 && <p className="muted">No one is granted this permission (except the owner).</p>}
      {alts.map((alt, i) => (
        <fieldset key={i}>
          <legend>{i === 0 ? 'Allowed if a person has all of:' : 'Or if a person has all of:'}</legend>
          {alt.length === 0 && p.resource === 'public' && <p className="muted">Currently open to everyone. Tick attributes to restrict it.</p>}
          <div className="checks">
            {attributes.map((a) => <label key={a.id}><input type="checkbox" checked={alt.includes(a.id)} onChange={() => toggle(i, a.id)} /> {a.name} <small className="muted">({a.resource})</small></label>)}
          </div>
          <button type="button" className="link danger-text" onClick={() => updateAlts(alts.filter((_, j) => j !== i))}>Remove this option</button>
        </fieldset>
      ))}
      <ErrorNote error={error} />
      {saved && !error && <p className="ok" role="status">Saved.</p>}
      <div className="row"><button onClick={() => updateAlts([...alts, []])}>Add an option</button><button className="primary" disabled={busy || resolved.unresolved > 0} onClick={save}>Save permission</button></div>
    </div>
  );
}
