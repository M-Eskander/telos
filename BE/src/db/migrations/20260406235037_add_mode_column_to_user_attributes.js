// 20260406_add_mode_to_user_attributes.js
exports.up = async function(knex) {
  await knex.schema.alterTable('user_attributes', (table) => {
    table.string('mode', 30).notNullable().defaultTo('add'); 
    // default 'add' means the attribute is granted, 'remove' can be used to block role attributes
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('user_attributes', (table) => {
    table.dropColumn('mode');
  });
};