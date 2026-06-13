const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, './.tmp/data.db');

try {
  const db = new Database(dbPath);
  
  console.log('reviews_user_lnk schema:');
  console.log(db.prepare("PRAGMA table_info(reviews_user_lnk)").all());

  console.log('reviews_user_lnk data:');
  console.log(db.prepare("SELECT * FROM reviews_user_lnk LIMIT 5").all());

  db.close();
} catch (err) {
  console.error('SQLite Error:', err);
}
