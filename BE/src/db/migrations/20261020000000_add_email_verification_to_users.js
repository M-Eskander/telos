exports.up = async function(knex) {
  if (!(await knex.schema.hasColumn('users', 'email_verified_at'))) {
    await knex.schema.alterTable('users', (table) => {
      // Unix epoch milliseconds; avoids driver/timezone differences across MySQL and SQLite.
      table.bigInteger('email_verified_at').nullable();
    });
  }

  if (!(await knex.schema.hasColumn('users', 'email_verification_token_hash'))) {
    await knex.schema.alterTable('users', (table) => {
      // SHA-256 hex digest; only the hash of a verification token is stored.
      table.string('email_verification_token_hash', 64).nullable().index();
    });
  }

  if (!(await knex.schema.hasColumn('users', 'email_verification_expires_at'))) {
    await knex.schema.alterTable('users', (table) => {
      // Unix epoch milliseconds, matching email_verified_at.
      table.bigInteger('email_verification_expires_at').nullable();
    });
  }
};

exports.down = async function(knex) {
  for (const column of [
    'email_verification_expires_at',
    'email_verification_token_hash',
    'email_verified_at'
  ]) {
    if (await knex.schema.hasColumn('users', column)) {
      await knex.schema.alterTable('users', (table) => {
        table.dropColumn(column);
      });
    }
  }
};
