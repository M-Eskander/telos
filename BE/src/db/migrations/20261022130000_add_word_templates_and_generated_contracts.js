exports.up = function(knex) {
  return knex.schema
    .alterTable('project_contract_templates', function(table) {
      // The layout of a project is a Word file with the placeholders in it.
      table.string('docx_key', 64).nullable();
      table.string('original_docx_name', 255).nullable();
    })
    .alterTable('project_contracts', function(table) {
      // The files the app made: the filled Word file and the PDF of it.
      table.string('pdf_key', 64).nullable();
      table.string('docx_key', 64).nullable();
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('project_contracts', function(table) {
      table.dropColumn('pdf_key');
      table.dropColumn('docx_key');
    })
    .alterTable('project_contract_templates', function(table) {
      table.dropColumn('docx_key');
      table.dropColumn('original_docx_name');
    });
};
