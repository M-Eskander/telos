exports.up = async function(knex) {
  await knex.schema.alterTable('contracts', table => {
    table.string('storage_key').nullable().unique();
    table.string('original_name').nullable();
    table.string('mime_type').nullable();
    table.integer('file_size').unsigned().nullable();
  });

  await knex('users')
    .whereNotIn('id', knex('owner_account').select('user_id'))
    .whereNotExists(function() {
      this.select('*')
        .from('contracts')
        .whereRaw('contracts.user_id = users.id')
        .whereNotNull('storage_key')
        .whereNotNull('start_date')
        .whereNotNull('end_date');
    })
    .update({ is_active: false });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('contracts', table => {
    table.dropUnique(['storage_key']);
    table.dropColumn('storage_key');
    table.dropColumn('original_name');
    table.dropColumn('mime_type');
    table.dropColumn('file_size');
  });
};
