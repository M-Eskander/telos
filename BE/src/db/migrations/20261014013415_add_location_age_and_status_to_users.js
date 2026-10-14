/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.string('location').nullable();
    table.integer('age').nullable();
    table.boolean('is_active').defaultTo(true); // For archiving past members instead of deleting them[cite: 2]
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('location');
    table.dropColumn('age');
    table.dropColumn('is_active');
  });
};
