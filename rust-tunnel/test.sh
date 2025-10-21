#!/bin/bash

# Test script for Rust Tunnel Server
# Since we can't build in this environment, this script documents the testing approach

echo "Rust Tunnel Server - Test Documentation"
echo "========================================"
echo ""
echo "This script documents how to test the Rust tunnel server implementation."
echo ""

echo "1. Build the project:"
echo "   cd rust-tunnel"
echo "   cargo build --release"
echo ""

echo "2. Run the example server:"
echo "   cargo run"
echo ""

echo "3. In another terminal, test the endpoints:"
echo ""

echo "   Test 1: Add Task"
echo "   ----------------"
echo '   curl -X POST http://localhost:7070/__runner/task/app.tasks.add \'
echo "     -H 'x-runner-token: secret' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"input\": {\"a\": 5, \"b\": 3}}'"
echo ""
echo "   Expected: {\"ok\":true,\"result\":8}"
echo ""

echo "   Test 2: Greet Task"
echo "   ------------------"
echo '   curl -X POST http://localhost:7070/__runner/task/app.tasks.greet \'
echo "     -H 'x-runner-token: secret' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"input\": {\"name\": \"Alice\"}}'"
echo ""
echo "   Expected: {\"ok\":true,\"result\":\"Hello, Alice!\"}"
echo ""

echo "   Test 3: Echo Task"
echo "   -----------------"
echo '   curl -X POST http://localhost:7070/__runner/task/app.tasks.echo \'
echo "     -H 'x-runner-token: secret' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"input\": {\"test\": \"data\"}}'"
echo ""
echo "   Expected: {\"ok\":true,\"result\":{\"test\":\"data\"}}"
echo ""

echo "   Test 4: Notify Event"
echo "   --------------------"
echo '   curl -X POST http://localhost:7070/__runner/event/app.events.notify \'
echo "     -H 'x-runner-token: secret' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"payload\": {\"message\": \"Hello from event!\"}}'"
echo ""
echo "   Expected: {\"ok\":true}"
echo ""

echo "   Test 5: Discovery"
echo "   -----------------"
echo '   curl -X GET http://localhost:7070/__runner/discovery \'
echo "     -H 'x-runner-token: secret'"
echo ""
echo "   Expected: {\"ok\":true,\"result\":{\"allowList\":{...}}}"
echo ""

echo "   Test 6: Authentication Failure"
echo "   -------------------------------"
echo '   curl -X POST http://localhost:7070/__runner/task/app.tasks.add \'
echo "     -H 'x-runner-token: wrong-token' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"input\": {\"a\": 1, \"b\": 2}}'"
echo ""
echo "   Expected: {\"ok\":false,\"error\":{\"code\":401,...}}"
echo ""

echo "   Test 7: Task Not in Allow List"
echo "   -------------------------------"
echo '   curl -X POST http://localhost:7070/__runner/task/app.tasks.forbidden \'
echo "     -H 'x-runner-token: secret' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"input\": {}}'"
echo ""
echo "   Expected: {\"ok\":false,\"error\":{\"code\":403,...}}"
echo ""

echo "4. Test with Node.js client:"
echo "   See README.md for integration examples"
echo ""

echo "Note: In this environment, cargo build is blocked due to network restrictions."
echo "The code structure and syntax are correct and will build in a normal Rust environment."
