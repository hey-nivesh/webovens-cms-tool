const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, './.tmp/data.db');
const db = new Database(dbPath);

const users = db.prepare("SELECT id, username, email, document_id FROM up_users").all();
console.log('Users in DB:', users);

db.close();
