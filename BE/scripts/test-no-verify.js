// Tests the "do not verify for now" path straight through the service,
// because creating a person needs the owner account.
const accessControl = require('../src/services/accessControl.service');
const knex = require('../src/config/knex');
const fs = require('fs');

(async () => {
  const email = `noverify-${Date.now()}@telosstudio.games`;
  // A minimal valid PDF: the storage only checks the header.
  const file = {
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'ascii'),
    mimetype: 'application/pdf',
    originalname: 'terms.pdf'
  };
  const person = await accessControl.createPerson({
    name: 'No Verify Test',
    email,
    phone_number: '01000000000',
    password: 'Test-Password-1!',
    contract_start_date: '2026-10-22',
    contract_end_date: '',
    skip_verification: true
  }, file);

  console.log('CREATED', person.email, 'verified:', person.emailVerified, 'verification:', JSON.stringify(person.verificationEmail));
  console.log('CONTRACT', person.contracts[0].start_date, 'end:', person.contracts[0].end_date);

  const row = await knex('users').where({ id: person.id }).first();
  console.log('DB email_verified_at:', row.email_verified_at ? 'set' : 'null');

  // The end date is optional.
  const withEnd = await knex('contracts').where({ user_id: person.id }).first();
  console.log('END_DATE', withEnd.end_date);

  await knex('user_roles').where({ user_id: person.id }).del();
  await knex('contracts').where({ user_id: person.id }).del();
  await knex('users').where({ id: person.id }).del();
  console.log('CLEANED', await knex('users').where({ email }).count('* as count').first());
  await knex.destroy();
})().catch(async (error) => {
  console.error('FAILED', error.message);
  process.exit(1);
});
