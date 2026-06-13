const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, './.tmp/data.db');
const db = new Database(dbPath);

const conn = db.prepare("SELECT * FROM github_connections LIMIT 1").get();
db.close();

if (!conn) {
  console.log('No github connection found in DB');
  return;
}

console.log('GitHub Username:', conn.username);
console.log('AccessToken starting with:', conn.access_token.substring(0, 10));

async function run() {
  const owner = conn.username; // let's assume they own a repo named "Focus-Flow-" or "nodejs-docker-example" based on logs
  // Let's use the repo name "Focus-Flow-" or "MitrMediation" from the user terminal logs
  const repo = 'Focus-Flow-'; 
  
  console.log(`Testing with repo: ${owner}/${repo}`);

  // 1. Without User-Agent
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: 'console.log("hello")', encoding: 'utf-8' })
    });
    console.log('Without User-Agent status:', res.status);
    console.log('Without User-Agent response:', await res.text());
  } catch (err) {
    console.error('Without User-Agent catch:', err);
  }

  // 2. With User-Agent
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'AntiGravity-AI'
      },
      body: JSON.stringify({ content: 'console.log("hello")', encoding: 'utf-8' })
    });
    console.log('With User-Agent status:', res.status);
    console.log('With User-Agent response:', await res.text());
  } catch (err) {
    console.error('With User-Agent catch:', err);
  }
}

run();
