const knex = require('../config/knex');
const sheetService = require('./sheet.service');
const contractStorage = require('./contractStorage.service');
const wordTemplate = require('./wordTemplate.service');

// MySQL hands dates back as Date objects; the app shows days, not timestamps.
const dateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

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
      docx_key: null,
      original_docx_name: null,
      is_default: true
    };
  }
  return {
    id: template.id,
    project_id: template.project_id,
    name: template.name,
    body: template.body,
    pdf_key: template.pdf_key,
    docx_key: template.docx_key,
    original_docx_name: template.original_docx_name,
    original_name: template.original_name,
    is_default: false
  };
}

// The people who can receive a contract right now, and the people who are on
// the Team sheet but still need weekly hours. The Contracts panel asks for
// this before it offers "everyone" or a single person.
async function getContractPeople(projectId) {
  const sheets = await sheetService.listSheets(projectId);
  if (sheets.length === 0) {
    throw new TypeError('Import a spreadsheet into this project first');
  }
  return sheetService.peopleFromSheets(sheets);
}

async function saveTemplate(projectId, { name, body }, pdfFile, docxFile) {
  if ((!body || !String(body).trim()) && !docxFile && !pdfFile) {
    throw new TypeError('The contract layout cannot be empty');
  }
  const existing = await knex('project_contract_templates')
    .where({ project_id: projectId })
    .orderBy('id', 'asc')
    .first();
  let pdfKey = existing ? existing.pdf_key : null;
  let originalName = existing ? existing.original_name : null;
  let docxKey = existing ? existing.docx_key : null;
  let originalDocxName = existing ? existing.original_docx_name : null;
  if (pdfFile) {
    const stored = await contractStorage.storeContractFile(pdfFile);
    pdfKey = stored.storageKey;
    originalName = stored.originalName;
  }
  if (docxFile) {
    const stored = await contractStorage.storeTemplateFile(docxFile);
    docxKey = stored.storageKey;
    originalDocxName = stored.originalName;
  }
  const payload = {
    name: (name && String(name).trim()) || 'Project Contract',
    body: body && String(body).trim() ? String(body) : DEFAULT_TEMPLATE,
    pdf_key: pdfKey,
    original_name: originalName,
    docx_key: docxKey,
    original_docx_name: originalDocxName,
    updated_at: knex.fn.now()
  };
  if (existing) {
    await knex('project_contract_templates').where({ id: existing.id }).update(payload);
  } else {
    await knex('project_contract_templates').insert({ ...payload, project_id: projectId, created_at: knex.fn.now() });
  }
  // A replaced file is no longer referenced by anything.
  for (const staleKey of [
    docxFile && existing ? existing.docx_key : null,
    pdfFile && existing ? existing.pdf_key : null
  ]) {
    if (!staleKey) continue;
    try {
      await contractStorage.removeContractFile(staleKey);
    } catch (error) {
      console.error('Could not remove the replaced layout file:', error.message);
    }
  }
  return getTemplate(projectId);
}

// Make one contract per person in the project sheet, or only the person the
// manager chose. A single-person run updates that person and never touches
// anyone else's contract.
async function generateContracts(projectId, { start_date: startDate, end_date: endDate, person, actorId = null } = {}) {
  const sheets = await sheetService.listSheets(projectId);
  if (sheets.length === 0) {
    throw new TypeError('Import a spreadsheet into this project first');
  }
  const roster = sheetService.peopleFromSheets(sheets);
  const people = roster.people;
  const waiting = roster.waiting || [];
  const requestedName = person === undefined || person === null ? '' : String(person).trim();
  const selected = requestedName
    ? people.filter((candidate) => candidate.name.toLowerCase() === requestedName.toLowerCase())
    : people;

  if (requestedName && selected.length === 0) {
    const waitingPerson = waiting.find(
      (candidate) => candidate.name.toLowerCase() === requestedName.toLowerCase()
    );
    if (waitingPerson) {
      throw new TypeError(
        `${waitingPerson.name} has no weekly hours yet. Put the hours in the Team sheet first.`
      );
    }
    throw new TypeError(`No one named "${requestedName}" is on the Team sheet`);
  }
  if (selected.length === 0) {
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
  const files = [];
  for (const person of selected) {
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
      files.push({ id: existing.id, data, oldPdf: existing.pdf_key, oldWord: existing.docx_key });
    } else {
      const [id] = await knex('project_contracts').insert({ ...payload, created_at: knex.fn.now() });
      made.push(id);
      files.push({ id, data });
    }
  }

  // The Word file of the project, if there is one, becomes the contract of
  // every person: the values go in, and the PDF comes out of it.
  let built = { words: 0, pdfs: 0 };
  if (template.docx_key) {
    built = await buildDocuments(template, files, project.name);
  }
  return {
    contracts: made,
    people: selected.length,
    waiting: requestedName ? [] : waiting,
    documents: built.words,
    pdfs: built.pdfs,
    scope: requestedName ? 'person' : 'sheet',
    person: requestedName ? selected[0].name : null
  };
}

// Fill the Word layout for every person and turn it into a PDF.
async function buildDocuments(template, files, projectName) {
  let templateBuffer;
  try {
    templateBuffer = await contractStorage.readContractFile(template.docx_key);
  } catch {
    return 0;
  }
  const safeName = String(projectName || 'Project').replace(/[^\w -]/g, '').trim() || 'Project';
  const filled = [];
  for (const file of files) {
    const buffer = wordTemplate.fillDocx(templateBuffer, file.data);
    filled.push({ id: file.id, buffer, name: `${safeName} Contract ${file.data.Name}.docx` });
  }
  let pdfs = [];
  try {
    pdfs = await wordTemplate.docxFilesToPdf(filled.map((file) => ({ buffer: file.buffer, name: file.name })));
  } catch (error) {
    console.error('The contract could not be turned into a PDF:', error.message);
    pdfs = filled.map(() => null);
  }
  let words = 0;
  let pdfCount = 0;
  for (let index = 0; index < filled.length; index += 1) {
    const file = filled[index];
    const pdf = pdfs[index];
    const storedDocx = await contractStorage.storeGeneratedFile(file.buffer, 'docx');
    const storedPdf = pdf ? await contractStorage.storeGeneratedFile(pdf, 'pdf') : null;
    await knex('project_contracts').where({ id: file.id }).update({
      pdf_key: storedPdf ? storedPdf.storageKey : null,
      docx_key: storedDocx.storageKey
    });
    // The files of the previous version are no longer referenced.
    for (const oldKey of [file.oldPdf, file.oldWord]) {
      if (!oldKey) continue;
      try {
        await contractStorage.removeContractFile(oldKey);
      } catch (error) {
        console.error('Could not remove an old contract file:', error.message);
      }
    }
    words += 1;
    if (storedPdf) pdfCount += 1;
  }
  return { words, pdfs: pdfCount };
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
      start_date: dateOnly(row.start_date),
      end_date: dateOnly(row.end_date),
      status: row.status,
      data,
      document: fillTemplate(template.body, data),
      has_pdf: Boolean(row.pdf_key),
      has_word: Boolean(row.docx_key),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
}

// The file of a contract: the PDF of it, or the Word file it was made from.
async function getContractFile(projectId, contractId, kind = 'pdf') {
  const contract = await knex('project_contracts')
    .where({ id: contractId, project_id: projectId })
    .first();
  if (!contract) return null;
  const key = kind === 'word' ? contract.docx_key : contract.pdf_key;
  if (!key) return null;
  const buffer = await contractStorage.readContractFile(key);
  return {
    buffer,
    mimeType: kind === 'word'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf',
    fileName: kind === 'word'
      ? `Contract ${contract.person_name}.docx`
      : `Contract ${contract.person_name}.pdf`
  };
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
  const contract = await knex('project_contracts')
    .where({ id: contractId, project_id: projectId })
    .first();
  if (!contract) return false;
  const removed = await knex('project_contracts').where({ id: contractId }).del();
  if (!removed) return false;
  for (const key of [contract.pdf_key, contract.docx_key]) {
    if (!key) continue;
    try {
      await contractStorage.removeContractFile(key);
    } catch (error) {
      console.error('Could not remove a stored contract file:', error.message);
    }
  }
  return true;
}

module.exports = {
  DEFAULT_TEMPLATE,
  PLACEHOLDERS,
  fillTemplate,
  getTemplate,
  getContractPeople,
  saveTemplate,
  generateContracts,
  listContracts,
  getContractFile,
  updateContract,
  deleteContract
};
