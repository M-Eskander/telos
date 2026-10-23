const AUTO_VERIFIED_WINDOW_MS = 5000;

function createdAtMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return new Date(value).getTime();
}

async function moveAutoVerifiedUsersToHold(knex) {
  // The old skip-verification path wrote email_verified_at at the same moment
  // the person was created. Genuine verification happens after the email is
  // opened, which cannot occur within a few seconds of creating the account.
  const users = await knex('users')
    .whereNotNull('email_verified_at')
    .whereNull('email_verification_deferred_at')
    .select('id', 'email_verified_at', 'created_at');
  for (const user of users) {
    const verifiedAt = Number(user.email_verified_at);
    const createdAt = createdAtMillis(user.created_at);
    if (!Number.isFinite(verifiedAt) || !Number.isFinite(createdAt)) continue;
    if (Math.abs(verifiedAt - createdAt) > AUTO_VERIFIED_WINDOW_MS) continue;
    await knex('users').where({ id: user.id }).update({
      email_verified_at: null,
      email_verification_deferred_at: verifiedAt
    });
  }
}

exports.up = async function(knex) {
  if (!(await knex.schema.hasColumn('users', 'email_verification_deferred_at'))) {
    await knex.schema.alterTable('users', (table) => {
      // Unix epoch milliseconds. Set when a person is added without asking
      // them to verify yet. They can sign in, but the address is not verified.
      table.bigInteger('email_verification_deferred_at').nullable();
    });
  }
  await moveAutoVerifiedUsersToHold(knex);
};

exports.down = async function(knex) {
  if (await knex.schema.hasColumn('users', 'email_verification_deferred_at')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('email_verification_deferred_at');
    });
  }
};
