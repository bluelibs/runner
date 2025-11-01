/**
 * Example: Node.js client calling the Rust tunnel server
 *
 * This demonstrates how a Node.js application can seamlessly
 * communicate with the Rust tunnel server using standard HTTP.
 *
 * Run this after starting the Rust server:
 *   cd rust-tunnel && cargo run
 *
 * Then in another terminal:
 *   node examples/node-client-example.js
 */

// Using plain fetch (Node.js 18+) - no special Rust bindings needed!
async function callRustServer() {
  const baseUrl = 'http://localhost:7070/__runner';
  const token = 'secret';

  console.log('🦀 Calling Rust Tunnel Server from Node.js\n');

  // Example 1: Call add task
  console.log('1️⃣  Calling app.tasks.add with {a: 5, b: 3}');
  const addResponse = await fetch(`${baseUrl}/task/app.tasks.add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-runner-token': token,
    },
    body: JSON.stringify({ input: { a: 5, b: 3 } }),
  });
  const addResult = await addResponse.json();
  console.log('   Response:', addResult);
  console.log('   Result:', addResult.result, '\n');

  // Example 2: Call greet task
  console.log('2️⃣  Calling app.tasks.greet with {name: "Rustacean"}');
  const greetResponse = await fetch(`${baseUrl}/task/app.tasks.greet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-runner-token': token,
    },
    body: JSON.stringify({ input: { name: 'Rustacean' } }),
  });
  const greetResult = await greetResponse.json();
  console.log('   Response:', greetResult);
  console.log('   Result:', greetResult.result, '\n');

  // Example 3: Echo task (returns input as-is)
  console.log('3️⃣  Calling app.tasks.echo with complex object');
  const complexInput = {
    message: 'Hello from Node.js!',
    timestamp: new Date().toISOString(),
    nested: { data: [1, 2, 3] },
  };
  const echoResponse = await fetch(`${baseUrl}/task/app.tasks.echo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-runner-token': token,
    },
    body: JSON.stringify({ input: complexInput }),
  });
  const echoResult = await echoResponse.json();
  console.log('   Response:', echoResult);
  console.log('   Result:', JSON.stringify(echoResult.result, null, 2), '\n');

  // Example 4: Emit event
  console.log('4️⃣  Emitting app.events.notify event');
  const eventResponse = await fetch(`${baseUrl}/event/app.events.notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-runner-token': token,
    },
    body: JSON.stringify({
      payload: {
        message: 'Event from Node.js client',
        timestamp: new Date().toISOString(),
      }
    }),
  });
  const eventResult = await eventResponse.json();
  console.log('   Response:', eventResult, '\n');

  // Example 5: Discovery endpoint
  console.log('5️⃣  Querying discovery endpoint');
  const discoveryResponse = await fetch(`${baseUrl}/discovery`, {
    method: 'GET',
    headers: {
      'x-runner-token': token,
    },
  });
  const discoveryResult = await discoveryResponse.json();
  console.log('   Response:', JSON.stringify(discoveryResult, null, 2), '\n');

  // Example 6: Error handling - wrong token
  console.log('6️⃣  Testing authentication failure');
  try {
    const failResponse = await fetch(`${baseUrl}/task/app.tasks.add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-runner-token': 'wrong-token',
      },
      body: JSON.stringify({ input: { a: 1, b: 2 } }),
    });
    const failResult = await failResponse.json();
    console.log('   Response:', failResult);
    console.log('   Status:', failResponse.status, failResponse.statusText, '\n');
  } catch (error) {
    console.log('   Error:', error.message, '\n');
  }

  // Example 7: Error handling - task not in allow list
  console.log('7️⃣  Testing forbidden task (not in allow list)');
  const forbiddenResponse = await fetch(`${baseUrl}/task/app.tasks.forbidden`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-runner-token': token,
    },
    body: JSON.stringify({ input: {} }),
  });
  const forbiddenResult = await forbiddenResponse.json();
  console.log('   Response:', forbiddenResult);
  console.log('   Status:', forbiddenResponse.status, forbiddenResponse.statusText, '\n');

  console.log('✅ All examples completed!');
  console.log('\n🔍 Key Takeaways:');
  console.log('   • Node.js talks to Rust via plain HTTP/JSON');
  console.log('   • No special bindings or FFI required');
  console.log('   • Same protocol works for any HTTP client');
  console.log('   • Rust server is a drop-in replacement for Node.js server');
}

// Run the examples
callRustServer().catch(error => {
  console.error('❌ Error:', error.message);
  console.error('\nMake sure the Rust server is running:');
  console.error('  cd rust-tunnel && cargo run');
  process.exit(1);
});
