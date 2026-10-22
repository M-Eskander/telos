const request = require('supertest');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const testDb = require('./testSetup');
const knex = require('../../src/config/knex');
const app = require('../../src/app');

const setupSecret = 'test-owner-setup-secret-1234567890';
let ownerAgent;

const cell = (value, formulaText = null, numberFormat = null) => {
  const stored = { v: value === undefined ? null : value, f: formulaText };
  if (numberFormat) stored.z = numberFormat;
  return stored;
};

const experience = [
  [cell('Mid'), cell(1)],
  [cell('Junior'), cell(0.75)]
];

// Two animators holding the same role, one mid-level and one junior. The
// payout on each row reads the totals on the Summary sheet, so a change here
// has to travel across sheets.
const team = [
  [cell('Name'), cell('Department'), cell('Role'), cell('Weight'), cell('Hours'), cell('Experience'), cell('Performance'), cell('Points'), cell('Payout')],
  [
    cell('Ada'), cell('Art'), cell('Animator'),
    cell(null, '1/COUNTIF($C$2:$C$3,C2)'), cell(40), cell('Mid'), cell('Meet Expectations'),
    cell(0, 'IF(F2="",0,D2*E2*VLOOKUP(F2,\'Experience\'!$A$1:$B$2,2,FALSE))', '0.0'),
    cell(0, 'IF(Summary!$B$1=0,0,H2/Summary!$B$1*Summary!$B$2)', '$#,##0.00')
  ],
  [
    cell('Bea'), cell('Art'), cell('Animator'),
    cell(null, '1/COUNTIF($C$2:$C$3,C3)'), cell(20), cell('Junior'), cell('Meet Expectations'),
    cell(0, 'IF(F3="",0,D3*E3*VLOOKUP(F3,\'Experience\'!$A$1:$B$2,2,FALSE))', '0.0'),
    cell(0, 'IF(Summary!$B$1=0,0,H3/Summary!$B$1*Summary!$B$2)', '$#,##0.00')
  ]
];

const summary = [
  [cell('Total points'), cell(0, 'SUM(Team!H2:H3)')],
  [cell('Pool'), cell(1000)],
  [cell('Payout'), cell(0, 'SUM(Team!I2:I3)', '$#,##0.00')]
];

function binaryParser(response, callback) {
  response.setEncoding('binary');
  let content = '';
  response.on('data', (chunk) => { content += chunk; });
  response.on('end', () => callback(null, Buffer.from(content, 'binary')));
}

beforeAll(() => {
  process.env.OWNER_SETUP_SECRET = setupSecret;
});

beforeEach(async () => {
  bcrypt.compare.mockResolvedValue(true);
  await testDb('project_meeting_attendees').del();
  await testDb('project_meetings').del();
  await testDb('project_contracts').del();
  await testDb('project_contract_templates').del();
  await testDb('project_sheets').del();
  await testDb('owner_account').del();
  await testDb('permission_attributes').del();
  await testDb('permission_grant_groups').del();
  await testDb('user_attributes').del();
  await testDb('role_attributes').del();
  await testDb('user_roles').del();
  await testDb('task_assignment').del();
  await testDb('tasks').del();
  await testDb('project_memberships').del();
  await testDb('project_departments').del();
  await testDb('projects').del();
  await testDb('users').del();

  const bootstrap = await request(app).post('/api/auth/bootstrap-owner').send({
    name: 'Studio Owner',
    email: 'owner@example.com',
    phone_number: '5550199',
    password: 'password',
    setup_secret: setupSecret
  });
  expect(bootstrap.status).toBe(201);
  await testDb('users').where({ id: bootstrap.body.user.id }).update({ email_verified_at: Date.now() });
  ownerAgent = request.agent(app);
  const login = await ownerAgent.post('/api/auth/login').send({
    email: 'owner@example.com',
    password: 'password'
  });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  delete process.env.OWNER_SETUP_SECRET;
  // testSetup closes its own database; this is the app's connection.
  await knex.destroy();
});

async function makeProject() {
  const created = await ownerAgent.post('/api/projects').send({ name: 'Formula Project' });
  expect(created.status).toBe(201);
  const projectId = created.body.project.id;
  const sheets = [['Team', team], ['Summary', summary], ['Experience', experience]];
  for (let position = 0; position < sheets.length; position += 1) {
    const [name, data] = sheets[position];
    await testDb('project_sheets').insert({
      project_id: projectId,
      name,
      position,
      data: JSON.stringify(data),
      source: 'upload',
      source_name: 'calculator.xlsx'
    });
  }
  return projectId;
}

describe('Project spreadsheet formulas', () => {
  test('works out every answer on read, including the cross-sheet ones', async () => {
    const projectId = await makeProject();
    const response = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    expect(response.status).toBe(200);
    const sheets = response.body.sheets;
    const teamSheet = sheets.find((sheet) => sheet.name === 'Team');
    const summarySheet = sheets.find((sheet) => sheet.name === 'Summary');

    // Both call themselves Animators, so each carries half the role weight.
    expect(teamSheet.data[1][3].v).toBeCloseTo(0.5, 8);
    expect(teamSheet.data[2][3].v).toBeCloseTo(0.5, 8);
    expect(teamSheet.data[1][7].v).toBeCloseTo(20, 8); // 0.5 × 40 × 1
    expect(teamSheet.data[2][7].v).toBeCloseTo(7.5, 8); // 0.5 × 20 × 0.75
    expect(summarySheet.data[0][1].v).toBeCloseTo(27.5, 8);
    expect(teamSheet.data[1][8].v).toBeCloseTo(1000 * (20 / 27.5), 6);
    expect(teamSheet.data[2][8].v).toBeCloseTo(1000 * (7.5 / 27.5), 6);
    expect(summarySheet.data[2][1].v).toBeCloseTo(1000, 6);
  });

  test('an edited hour cell moves every dependent sheet and is stored that way', async () => {
    const projectId = await makeProject();
    const before = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    const teamSheet = before.body.sheets.find((sheet) => sheet.name === 'Team');
    const edited = teamSheet.data.map((row) => row.map((entry) => (entry ? { ...entry } : null)));
    edited[1][4] = cell(10); // Ada now works 10 hours

    const saved = await ownerAgent
      .put(`/api/projects/${projectId}/sheets/${teamSheet.id}`)
      .send({ name: 'Team', data: edited });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);
    expect(saved.body.sheet.id).toBe(teamSheet.id);

    // Ada: 0.5 × 10 × 1 = 5 points. Bea: 7.5. 5 / 12.5 of the 1000 pool.
    expect(saved.body.sheet.data[1][7].v).toBeCloseTo(5, 8);
    expect(saved.body.sheet.data[1][8].v).toBeCloseTo(400, 6);
    expect(saved.body.sheet.data[2][8].v).toBeCloseTo(600, 6);

    // The response carries every sheet, already recalculated.
    const summaryAfter = saved.body.sheets.find((sheet) => sheet.name === 'Summary');
    expect(summaryAfter.data[0][1].v).toBeCloseTo(12.5, 8);
    expect(summaryAfter.data[2][1].v).toBeCloseTo(1000, 6);

    // And a fresh read proves it was written down, not only returned.
    const after = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    const summaryStored = after.body.sheets.find((sheet) => sheet.name === 'Summary');
    expect(summaryStored.data[0][1].v).toBeCloseTo(12.5, 8);
    expect(summaryStored.data[2][1].v).toBeCloseTo(1000, 6);
  });

  test('exports the formulas with their answers and number formats', async () => {
    const projectId = await makeProject();
    const before = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    const teamSheet = before.body.sheets.find((sheet) => sheet.name === 'Team');
    const edited = teamSheet.data.map((row) => row.map((entry) => (entry ? { ...entry } : null)));
    edited[1][4] = cell(10);
    await ownerAgent.put(`/api/projects/${projectId}/sheets/${teamSheet.id}`).send({ name: 'Team', data: edited });

    const exported = await ownerAgent
      .get(`/api/projects/${projectId}/sheets/export`)
      .buffer(true)
      .parse(binaryParser);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toMatch(/spreadsheetml/);

    const workbook = XLSX.read(exported.body, { type: 'buffer', cellFormula: true, cellNF: true });
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(['Team', 'Summary', 'Experience']));
    const worksheet = workbook.Sheets.Team;
    expect(worksheet.H2.f).toBe('IF(F2="",0,D2*E2*VLOOKUP(F2,\'Experience\'!$A$1:$B$2,2,FALSE))');
    expect(worksheet.H2.v).toBeCloseTo(5, 8);
    expect(worksheet.H2.z).toBe('0.0');
    expect(worksheet.I2.f).toContain('Summary!$B$1');
    expect(worksheet.I2.v).toBeCloseTo(400, 6);
    expect(worksheet.I2.z).toBe('$#,##0.00');
    expect(workbook.Sheets.Summary.B1.v).toBeCloseTo(12.5, 8);
  });

  test('does not let one project write over another project sheet', async () => {
    const projectId = await makeProject();
    const other = await ownerAgent.post('/api/projects').send({ name: 'Other Project' });
    expect(other.status).toBe(201);
    const before = await ownerAgent.get(`/api/projects/${projectId}/sheets`);
    const teamSheet = before.body.sheets.find((sheet) => sheet.name === 'Team');
    const saved = await ownerAgent
      .put(`/api/projects/${other.body.project.id}/sheets/${teamSheet.id}`)
      .send({ name: 'Stolen', data: [] });
    expect(saved.status).toBe(404);
  });
});
