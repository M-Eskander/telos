const path = require('path');
const env = process.env.NODE_ENV || 'development';
const configPath = path.resolve(__dirname, '../../knexfile.js');
const config = require(configPath)[env];
module.exports = require('knex')(config);