const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, './.tmp/data.db');
const db = new Database(dbPath);

const conn = db.prepare("SELECT * FROM github_connections LIMIT 1").get();
db.close();

if (!conn) {
  console.log('No connection found');
  return;
}

async function run() {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'AntiGravity-AI'
    }
  });
  console.log('Status:', res.status);
  console.log('Scopes (X-OAuth-Scopes):', res.headers.get('x-oauth-scopes'));
  console.log('Accepted Scopes:', res.headers.get('x-accepted-oauth-scopes'));
}
run();
