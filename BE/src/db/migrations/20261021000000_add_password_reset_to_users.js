exports.up = async function(knex) {
  if (!(await knex.schema.hasColumn('users', 'password_reset_token_hash'))) {
    await knex.schema.alterTable('users', (table) => {
      // SHA-256 hex digest; only the hash of a reset token is ever stored.
      table.string('password_reset_token_hash', 64).nullable().index();
    });
  }

  if (!(await knex.schema.hasColumn('users', 'password_reset_expires_at'))) {
    await knex.schema.alterTable('users', (table) => {
      // Unix epoch milliseconds, matching email_verified_at.
      table.bigInteger('password_reset_expires_at').nullable();
    });
  }
};

exports.down = async function(knex) {
  for (const column of [
    'password_reset_expires_at',
    'password_reset_token_hash'
  ]) {
    if (await knex.schema.hasColumn('users', column)) {
      await knex.schema.alterTable('users', (table) => {
        table.dropColumn(column);
      });
    }
  }
};
