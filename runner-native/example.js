// Example: Integration with existing @bluelibs/runner

const { TunnelServer } = require('./index');

async function main() {
  console.log('🚀 Starting Native Tunnel Server Example\n');

  // Create server (Rust HTTP server!)
  const server = new TunnelServer({
    port: 7070,
    basePath: '/__runner',
    corsOrigins: ['*'],
  });

  console.log('📝 Registering tasks...');

  // Register task handlers
  // These are JavaScript functions that Rust will call directly (no IPC!)
  server.registerTask('app.tasks.add', async (input) => {
    console.log('  → Executing app.tasks.add with', input);
    return input.a + input.b;
  });

  server.registerTask('app.tasks.greet', async (input) => {
    console.log('  → Executing app.tasks.greet with', input);
    return `Hello, ${input.name}!`;
  });

  server.registerTask('app.tasks.complex', async (input) => {
    console.log('  → Executing app.tasks.complex');

    // Simulate database query
    await new Promise(resolve => setTimeout(resolve, 10));

    return {
      result: 'processed',
      timestamp: new Date().toISOString(),
      input: input,
    };
  });

  console.log('✅ Tasks registered\n');

  console.log('🦀 Starting Rust HTTP server on port 7070...');
  console.log('📡 Base path: /__runner\n');

  console.log('Test with:');
  console.log('  curl -X POST http://localhost:7070/__runner/task/app.tasks.add \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"a": 5, "b": 3}\'\n');

  // Start HTTP server (this runs in background, controlled by Rust!)
  await server.listen();
}

main().catch(console.error);
