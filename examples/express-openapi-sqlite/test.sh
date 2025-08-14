#!/bin/bash

# Simple test script to verify the Express server works

cd "$(dirname "$0")"

echo "🚀 Starting Express OpenAPI SQLite Example test..."

# Build the project
echo "📦 Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"

# Start the server in background
echo "🌟 Starting server..."
npm start &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Test endpoints
echo "🧪 Testing endpoints..."

# Health check
echo "📊 Testing health endpoint..."
curl -s http://localhost:3000/health | jq .

# Register user
echo "👤 Testing user registration..."
REGISTER_RESULT=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}')

echo $REGISTER_RESULT | jq .

# Extract token
TOKEN=$(echo $REGISTER_RESULT | jq -r .data.token)

if [ "$TOKEN" != "null" ] && [ "$TOKEN" != "" ]; then
    echo "✅ Registration successful, token: $TOKEN"
    
    # Test protected endpoint
    echo "🔒 Testing protected endpoint..."
    curl -s -X GET http://localhost:3000/api/auth/profile \
      -H "Authorization: Bearer $TOKEN" | jq .
      
    echo "✅ Protected endpoint test complete"
else
    echo "❌ Registration failed"
fi

# Test login
echo "🔑 Testing login..."
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq .

# Clean up
echo "🧹 Cleaning up..."
kill $SERVER_PID 2>/dev/null

echo "✨ Test complete!"