async function test(maxTokens) {
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer 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'
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-large-3-675b-instruct-2512',
        messages: [{ role: 'user', content: 'Say hello in 5 words' }],
        max_tokens: maxTokens,
        temperature: 0.1,
      })
    });
    console.log(`max_tokens: ${maxTokens} -> Status: ${res.status}`);
  } catch (err) {
    console.error(err);
  }
}

async function run() {
  await test(1024);
  await test(2048);
  await test(4096);
  await test(8192);
}

run();
