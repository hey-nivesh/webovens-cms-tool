const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, './.tmp/data.db');
const db = new Database(dbPath);

try {
  const permissions = db.prepare("SELECT distinct action FROM up_permissions").all();
  console.log('Action types in up_permissions:');
  console.log(permissions.map(p => p.action));
} catch (e) {
  console.error(e);
} finally {
  db.close();
}
