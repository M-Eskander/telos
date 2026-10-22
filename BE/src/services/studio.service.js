const knex = require('../config/knex');
const sheetService = require('./sheet.service');
const projectContractService = require('./projectContract.service');
const meetingService = require('./meeting.service');
const scheduleService = require('./schedule.service');

// --- the spreadsheet of a project ----------------------------------------
async function listSheets(projectId) {
  return sheetService.listSheets(projectId);
}

async function importSheet(projectId, file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new TypeError('A spreadsheet file is required');
  }
  const name = String(file.originalname || 'sheet.xlsx').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
    throw new TypeError('Only .xlsx, .xls and .csv files can be imported');
  }
  const { sheets, warnings } = sheetService.parseWorkbook(file.buffer, file.originalname);
  const saved = await sheetService.replaceSheets(projectId, sheets);
  return { sheets: saved, warnings };
}

async function saveSheet(projectId, sheetId, payload) {
  return sheetService.saveSheet(projectId, sheetId, payload || {});
}

async function deleteSheet(projectId, sheetId) {
  return sheetService.deleteSheet(projectId, sheetId);
}

async function exportSheets(projectId) {
  const sheets = await sheetService.listSheets(projectId);
  return sheetService.buildWorkbook(sheets);
}

// --- the contract layout and the contracts made from it ------------------
async function getTemplate(projectId) {
  return projectContractService.getTemplate(projectId);
}

async function saveTemplate(projectId, payload, pdfFile, docxFile) {
  return projectContractService.saveTemplate(projectId, payload || {}, pdfFile, docxFile);
}

async function listContracts(projectId) {
  return projectContractService.listContracts(projectId);
}

async function getContractFile(projectId, contractId, kind) {
  return projectContractService.getContractFile(projectId, contractId, kind);
}

async function generateContracts(projectId, payload, actorId) {
  return projectContractService.generateContracts(projectId, payload || {}, actorId);
}

async function updateContract(projectId, contractId, payload) {
  return projectContractService.updateContract(projectId, contractId, payload || {});
}

async function deleteContract(projectId, contractId) {
  return projectContractService.deleteContract(projectId, contractId);
}

// --- meetings ------------------------------------------------------------
async function listMeetings(projectId) {
  return meetingService.listProjectMeetings(projectId);
}

async function createMeeting(projectId, payload, actorId) {
  return meetingService.createMeeting(projectId, payload || {}, actorId);
}

async function updateMeeting(projectId, meetingId, payload) {
  return meetingService.updateMeeting(projectId, meetingId, payload || {});
}

async function deleteMeeting(projectId, meetingId) {
  return meetingService.deleteMeeting(projectId, meetingId);
}

// --- who is working on what ----------------------------------------------
// The people of a project and the work that is on their plate right now.
async function projectWork(projectId, { userId = null } = {}) {
  const members = await knex('project_memberships as m')
    .join('users as u', 'u.id', 'm.user_id')
    .where('m.project_id', projectId)
    .select('u.id', 'u.name', 'u.email', 'u.phone_number', 'm.department_id')
    .orderBy('u.name', 'asc');
  const departments = await knex('project_departments').where({ project_id: projectId }).select('id', 'name');
  const departmentName = new Map(departments.map((department) => [department.id, department.name]));

  const tasks = await knex('tasks as t')
    .where('t.project_id', projectId)
    .whereNot('t.status', 'done')
    .select('t.id', 't.title', 't.status', 't.priority', 't.progress', 't.start_date', 't.end_date',
      't.parent_task_id', 't.weight')
    .orderBy('t.end_date', 'asc');
  const assignments = await knex('task_assignment as a')
    .join('tasks as t', 't.id', 'a.task_id')
    .where('t.project_id', projectId)
    .select('a.task_id', 'a.user_id');

  const byPerson = new Map(members.map((member) => [member.id, {
    id: member.id,
    name: member.name,
    email: member.email,
    department: departmentName.get(member.department_id) || null,
    tasks: []
  }]));

  for (const assignment of assignments) {
    const task = tasks.find((candidate) => candidate.id === assignment.task_id);
    if (!task) continue;
    const person = byPerson.get(assignment.user_id);
    if (!person) continue;
    person.tasks.push(task);
  }

  const unassigned = tasks.filter((task) => !assignments.some((assignment) => assignment.task_id === task.id));
  const now = new Date();
  const states = new Map(tasks.map((task) => [task.id, scheduleService.computeSchedule(task, now).state]));

  return {
    people: [...byPerson.values()].map((person) => ({
      ...person,
      tasks: person.tasks.map((task) => ({ ...task, schedule: states.get(task.id) || 'on_track' })),
      load: person.tasks.length
    })),
    unassigned: unassigned.map((task) => ({ ...task, schedule: states.get(task.id) || 'on_track' })),
    total: tasks.length
  };
}

// --- my own desk ---------------------------------------------------------
// Everything assigned to me, across every project I can see.
async function myWork(userId) {
  const assignments = await knex('task_assignment as a')
    .join('tasks as t', 't.id', 'a.task_id')
    .leftJoin('projects as p', 'p.id', 't.project_id')
    .where('a.user_id', userId)
    .select('t.*', 'p.name as project_name', 'p.id as project_id')
    .orderBy('t.end_date', 'asc');
  const today = new Date();
  return assignments.map((task) => ({
    ...task,
    schedule: scheduleService.computeSchedule(task, today).state
  }));
}

module.exports = {
  listSheets,
  importSheet,
  saveSheet,
  deleteSheet,
  exportSheets,
  getTemplate,
  saveTemplate,
  listContracts,
  getContractFile,
  generateContracts,
  updateContract,
  deleteContract,
  listMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  projectWork,
  myWork
};
