const { TunnelServer } = require('./index');
const assert = require('assert');

async function test() {
  console.log('🧪 Running tests for @bluelibs/runner-native\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Server creation
  try {
    const server = new TunnelServer({
      port: 7071,
      basePath: '/__test',
      corsOrigins: ['*'],
    });
    console.log('✅ Test 1: Server creation');
    passed++;
  } catch (e) {
    console.log('❌ Test 1: Server creation -', e.message);
    failed++;
  }

  // Test 2: Task registration
  try {
    const server = new TunnelServer({ port: 7072 });
    server.registerTask('test.add', async (input) => {
      return input.a + input.b;
    });
    console.log('✅ Test 2: Task registration');
    passed++;
  } catch (e) {
    console.log('❌ Test 2: Task registration -', e.message);
    failed++;
  }

  // Test 3: Event registration
  try {
    const server = new TunnelServer({ port: 7073 });
    server.registerEvent('test.log', async (payload) => {
      console.log('Event:', payload);
    });
    console.log('✅ Test 3: Event registration');
    passed++;
  } catch (e) {
    console.log('❌ Test 3: Event registration -', e.message);
    failed++;
  }

  // Test 4: Get task IDs
  try {
    const server = new TunnelServer({ port: 7074 });
    server.registerTask('task1', async (i) => i);
    server.registerTask('task2', async (i) => i);

    const taskIds = await server.getTaskIds();
    assert(taskIds.includes('task1'), 'Should include task1');
    assert(taskIds.includes('task2'), 'Should include task2');
    console.log('✅ Test 4: Get task IDs');
    passed++;
  } catch (e) {
    console.log('❌ Test 4: Get task IDs -', e.message);
    failed++;
  }

  // Test 5: Server listen and HTTP requests
  try {
    const server = new TunnelServer({ port: 7075, basePath: '/__test' });

    server.registerTask('test.add', async (input) => {
      return input.a + input.b;
    });

    server.registerEvent('test.notify', async (payload) => {
      console.log('[Test Event]', payload.message);
    });

    // Start server in background
    const serverPromise = server.listen();

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test HTTP request
    const http = require('http');

    // Test task endpoint
    const taskData = JSON.stringify({ input: { a: 5, b: 3 } });
    const taskReq = http.request({
      hostname: 'localhost',
      port: 7075,
      path: '/__test/task/test.add',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': taskData.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        assert(result.ok === true, 'Response should be ok');
        assert(result.result === 8, 'Result should be 8');
        console.log('✅ Test 5: HTTP task execution');
        passed++;
      });
    });

    taskReq.on('error', (e) => {
      console.log('❌ Test 5: HTTP task execution -', e.message);
      failed++;
    });

    taskReq.write(taskData);
    taskReq.end();

    // Test event endpoint
    setTimeout(() => {
      const eventData = JSON.stringify({ payload: { message: 'Test event' } });
      const eventReq = http.request({
        hostname: 'localhost',
        port: 7075,
        path: '/__test/event/test.notify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': eventData.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const result = JSON.parse(data);
          assert(result.ok === true, 'Event response should be ok');
          console.log('✅ Test 6: HTTP event emission');
          passed++;

          // Test discovery endpoint
          setTimeout(() => {
            const discReq = http.request({
              hostname: 'localhost',
              port: 7075,
              path: '/__test/discovery',
              method: 'GET',
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                const result = JSON.parse(data);
                assert(result.ok === true, 'Discovery response should be ok');
                assert(result.result.allowList.tasks.includes('test.add'), 'Should list tasks');
                console.log('✅ Test 7: HTTP discovery endpoint');
                passed++;

                // Print results
                console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
                if (failed === 0) {
                  console.log('🎉 All tests passed!');
                  process.exit(0);
                } else {
                  console.log('💥 Some tests failed');
                  process.exit(1);
                }
              });
            });
            discReq.end();
          }, 500);
        });
      });

      eventReq.on('error', (e) => {
        console.log('❌ Test 6: HTTP event emission -', e.message);
        failed++;
      });

      eventReq.write(eventData);
      eventReq.end();
    }, 500);

  } catch (e) {
    console.log('❌ Test 5-7: Server and HTTP -', e.message);
    failed += 3;
    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
}

test().catch((e) => {
  console.error('💥 Test suite error:', e);
  process.exit(1);
});
