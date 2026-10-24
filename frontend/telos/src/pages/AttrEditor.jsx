// Edits a full replacement list of { attributeId, resourceId?, mode? }.
export const normAttr = (a) => ({
  attributeId: a.attributeId ?? a.attribute_id ?? a.id,
  resourceId: a.resourceId ?? a.resource_id ?? null,
  ...(a.mode ? { mode: a.mode } : {}),
});

export const cleanAttrs = (rows) => rows.filter((r) => r.attributeId).map((r) => ({
  attributeId: Number(r.attributeId),
  ...(r.resourceId ? { resourceId: Number(r.resourceId) } : {}),
  ...(r.mode ? { mode: r.mode } : {}),
}));

export default function AttrEditor({ value, onChange, attributes, projects, withMode }) {
  const upd = (i, patch) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="list">
      {value.length === 0 && <p className="muted">None assigned.</p>}
      {value.map((r, i) => (
        <div className="row-item" key={i}>
          <div className="row wrap">
            <select aria-label="Attribute" value={r.attributeId ?? ''} onChange={(e) => upd(i, { attributeId: e.target.value })}>
              <option value="">Choose attribute</option>
              {attributes.map((a) => <option key={a.id} value={a.id}>{a.name}{a.resource ? ` (${a.resource})` : ''}</option>)}
            </select>
            <select aria-label="Scope" value={r.resourceId ?? ''} onChange={(e) => upd(i, { resourceId: e.target.value || null })}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>Only {p.name}</option>)}
            </select>
            {withMode && (
              <select aria-label="Mode" value={r.mode || 'add'} onChange={(e) => upd(i, { mode: e.target.value })}>
                <option value="add">Grant</option><option value="remove">Block</option>
              </select>
            )}
          </div>
          <button type="button" className="link danger-text" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { attributeId: '', resourceId: null, ...(withMode ? { mode: 'add' } : {}) }])}>Add attribute</button>
    </div>
  );
}
