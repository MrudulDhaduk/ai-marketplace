const { Pool } = require("pg");
const config = require("./env");

const pool = new Pool(
  config.db.connectionString
    ? { connectionString: config.db.connectionString, ssl: config.db.ssl }
    : {
        user: config.db.user,
        host: config.db.host,
        database: config.db.database,
        password: config.db.password,
        port: config.db.port,
        ssl: config.db.ssl,
      },
);

module.exports = pool;
