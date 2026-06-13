async function main() {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiaWF0IjoxNzgxMjAxMzYwLCJleHAiOjE3ODM3OTMzNjB9.oNvzOG9XZcEbBMFK-KVUuMMjJVDmsFwEom3n5vnWVbA';
  
  // We will call apply-fixes for review ID 1
  try {
    const res = await fetch('http://localhost:1337/api/review/apply-fixes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({ reviewId: 1 })
    });
    
    console.log('Response status:', res.status);
    console.log('Response body:', await res.json());
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

main();
