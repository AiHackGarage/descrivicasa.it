const mysql = require('mysql2/promise');
const { DB_CONFIG } = require('../config');

const pool = mysql.createPool(DB_CONFIG);

module.exports = pool;
