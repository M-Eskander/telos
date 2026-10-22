const knex = require('../config/knex');
const sheetService = require('./sheet.service');
const contractStorage = require('./contractStorage.service');

// The layout a project starts with. It mirrors the studio's project contract
// and keeps the placeholders the revenue share calculator fills in.
const DEFAULT_TEMPLATE = `PROJECT CONTRACT

This contract is written to ensure each individual working on this project gets his rights preserved and at the same time ensuring the studio rights are preserved.

This Project contract is entered as an agreement between {{Studio}}, operating as Telos Studio, and {{Name}}, as of the date signed below, for the project codenamed {{Project}}.

This Agreement incorporates by reference the following documents :

 - Telos Studio Terms (last acknowledged by Contributor)
 - Telos Studio - Weekly Hours & Revenue Share System
 - Telos Studio Revenue Share Calculator

If any term in this Agreement conflicts with the past documents, this Agreement controls for this Project.

1. Department, Role, Needed Hours & Base Revenue Share

 Department                 {{Department}}
 Role / Title               {{Role}}
 Needed Weekly Hours        {{Hours}}
 Base Revenue Share         {{Share}}

Stated Weekly Hours is subject to the calibration period defined in Telos Studio - Weekly Hours & Revenue Share System. Specific weekly tasks are assigned per that system and are not restated here.

2. Revenue Share

Contributor's Payment for this Project is a share of The Project Profit ("Revenue Share"), calculated as follows :
(revenue share means share of the profit in this document except in 2.4 it means the actual revenue : price x sold copies)

2.1 Baseline Calculation
Contributor's baseline Revenue Share is calculated using the inputs of each individual, applied to the Telos Studio Revenue Share Calculator in effect on the date this Agreement is signed.

2.2 Studio Cut
The Studio retains its cut of Project revenue if the Project Outcome (defined in Section 2.4) is "Succeeded," or the lower cut if "Underperformed." The remainder is distributed to the team per the Calculator.

2.3 Performance Adjustment
Contributor's actual payout may be adjusted up or down from the baseline based on performance, as evaluated under the Telos Studio - Weekly Hours & Revenue Share System and its shared rubric.

2.4 Determining Project Outcome
If this project sold fewer copies than the target set in the Calculator by the third month of release the project is considered "underperformed," before that the project is considered successful.

2.5 Payment Schedule
Revenue Share is paid monthly after the project is released.

3. Project Period

 Start Date                 {{StartDate}}
 End Date                   {{EndDate}}

4. Confidentiality
You can not share any details - small or big - about ongoing or unannounced projects without explicit approval from the studio founder. We take this seriously because our ideas and work need to be protected. Breaching confidentiality is not taken lightly and may result in removal from the studio and potential legal consequences as it directly affects our intellectual property rights.

However you may share that you have worked on this project or share the work you have done in your portfolio after the project is released (as pics, videos or descriptions, no code or asset files are allowed to be shared) while the full ownership still belongs to the studio.

5. Terms Acknowledgment
By joining this project you confirm that you agree on everything stated on this document and the signed terms document you signed by joining the studio :
Telos Studio Terms (last acknowledged by Contributor)


Signature ..................................

Date ..................................

Founder Signature ..........................`;

const PLACEHOLDERS = [
  'Name', 'Department', 'Role', 'Hours', 'Share',
  'Project', 'Studio', 'StartDate', 'EndDate'
];

function fillTemplate(body, data) {
  let filled = String(body || '');
  for (const key of PLACEHOLDERS) {
    const value = data && data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
    filled = filled.split(`{{${key}}}`).join(value);
  }
  // Anything left over is shown as it is, so a typo is visible and not silent.
  return filled;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(value) {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function getTemplate(projectId) {
  const template = await knex('project_contract_templates')
    .where({ project_id: projectId })
    .orderBy('id', 'asc')
    .first();
  if (!template) {
    return {
      id: null,
      project_id: projectId,
      name: 'Project Contract',
      body: DEFAULT_TEMPLATE,
      pdf_key: null,
      is_default: true
    };
  }
  return {
    id: template.id,
    project_id: template.project_id,
    name: template.name,
    body: template.body,
    pdf_key: template.pdf_key,
    original_name: template.original_name,
    is_default: false
  };
}

async function saveTemplate(projectId, { name, body, pdfFile }) {
  if (!body || !String(body).trim()) {
    throw new TypeError('The contract layout cannot be empty');
  }
  const existing = await knex('project_contract_templates')
    .where({ project_id: projectId })
    .orderBy('id', 'asc')
    .first();
  let pdfKey = existing ? existing.pdf_key : null;
  let originalName = existing ? existing.original_name : null;
  if (pdfFile) {
    const stored = await contractStorage.storeContractFile(pdfFile);
    pdfKey = stored.storageKey;
    originalName = stored.originalName;
  }
  const payload = {
    name: (name && String(name).trim()) || 'Project Contract',
    body: String(body),
    pdf_key: pdfKey,
    original_name: originalName,
    updated_at: knex.fn.now()
  };
  if (existing) {
    await knex('project_contract_templates').where({ id: existing.id }).update(payload);
  } else {
    await knex('project_contract_templates').insert({ ...payload, project_id: projectId, created_at: knex.fn.now() });
  }
  return getTemplate(projectId);
}

// Make one contract per person in the project sheet.
async function generateContracts(projectId, { start_date: startDate, end_date: endDate, actorId = null } = {}) {
  const sheets = await sheetService.listSheets(projectId);
  if (sheets.length === 0) {
    throw new TypeError('Import a spreadsheet into this project first');
  }
  const roster = sheetService.peopleFromSheets(sheets);
  const people = roster.people;
  const waiting = roster.waiting || [];
  if (people.length === 0) {
    throw new TypeError(
      waiting.length
        ? `No one in the sheet has weekly hours yet (${waiting.length} waiting). Put the hours in the Team sheet first.`
        : 'The sheet has no people yet'
    );
  }
  const project = await knex('projects').where({ id: projectId }).first();
  if (!project) throw new TypeError('Project not found');
  const template = await getTemplate(projectId);
  const start = startDate || today();
  const members = await knex('users').select('id', 'name');

  const made = [];
  for (const person of people) {
    const data = {
      Name: person.name,
      Department: person.department,
      Role: person.role,
      Hours: String(person.hours),
      Share: person.share,
      Project: project.name,
      Studio: 'Telos Studio',
      StartDate: prettyDate(start),
      EndDate: endDate ? prettyDate(endDate) : 'Open-ended'
    };
    const user = members.find((member) => member.name === person.name);
    const existing = await knex('project_contracts')
      .where({ project_id: projectId, person_name: person.name })
      .first();
    const payload = {
      project_id: projectId,
      template_id: template.id,
      user_id: user ? user.id : null,
      person_name: person.name,
      document_data: JSON.stringify(data),
      start_date: start,
      end_date: endDate || null,
      status: existing ? existing.status : 'draft',
      created_by: actorId,
      updated_at: knex.fn.now()
    };
    if (existing) {
      await knex('project_contracts').where({ id: existing.id }).update(payload);
      made.push(existing.id);
    } else {
      const [id] = await knex('project_contracts').insert({ ...payload, created_at: knex.fn.now() });
      made.push(id);
    }
  }
  return { contracts: made, people: people.length, waiting };
}

async function listContracts(projectId) {
  const rows = await knex('project_contracts')
    .where({ project_id: projectId })
    .orderBy('person_name', 'asc');
  const template = await getTemplate(projectId);
  return rows.map((row) => {
    const data = typeof row.document_data === 'string'
      ? JSON.parse(row.document_data)
      : (row.document_data || {});
    return {
      id: row.id,
      project_id: row.project_id,
      person_name: row.person_name,
      user_id: row.user_id,
      template_id: row.template_id,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      data,
      document: fillTemplate(template.body, data),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
}

async function updateContract(projectId, contractId, { status, start_date: startDate, end_date: endDate }) {
  const contract = await knex('project_contracts').where({ id: contractId, project_id: projectId }).first();
  if (!contract) return null;
  const payload = { updated_at: knex.fn.now() };
  if (status) payload.status = String(status).slice(0, 24);
  if (startDate !== undefined) payload.start_date = startDate || null;
  if (endDate !== undefined) payload.end_date = endDate || null;
  await knex('project_contracts').where({ id: contractId }).update(payload);
  return listContracts(projectId).then((all) => all.find((entry) => entry.id === contractId) || null);
}

async function deleteContract(projectId, contractId) {
  const removed = await knex('project_contracts').where({ id: contractId, project_id: projectId }).del();
  return removed > 0;
}

module.exports = {
  DEFAULT_TEMPLATE,
  PLACEHOLDERS,
  fillTemplate,
  getTemplate,
  saveTemplate,
  generateContracts,
  listContracts,
  updateContract,
  deleteContract
};
