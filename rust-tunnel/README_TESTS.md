# Testing Guide for runner-native

## Test Suites

### 1. Rust Unit Tests (src/*.rs)
**Status:** ✅ Written, awaiting network access

Located in:
- `src/models.rs` - 15 tests
- `src/error.rs` - 10 tests

**Run with:**
```bash
cargo test
```

**Requirements:**
- Network access to crates.io
- Rust toolchain (cargo 1.90.0+)

**What's tested:**
- Protocol types (SuccessResponse, ErrorResponse)
- Error handling (TunnelError variants)
- JSON serialization/deserialization
- HTTP status code mapping
- Config defaults and cloning

---

### 2. Standalone Rust Tests (NO DEPENDENCIES)
**Status:** ✅ RUNNING & PASSING (15/15 tests)

**Location:** `standalone_test.rs`

**Run with:**
```bash
rustc standalone_test.rs -o standalone_test && ./standalone_test
```

**No dependencies required!** Uses only Rust std library.

**Test Results:**
```
🦀 Rust Protocol Test Suite (No External Dependencies)
======================================================================

  ✓ SuccessResponse::new
  ✓ SuccessResponse::empty
  ✓ ErrorResponse variants
  ✓ TunnelError HTTP codes
  ✓ Error conversion
  ✓ TunnelResult Ok
  ✓ TunnelResult Err
  ✓ TunnelConfig defaults
  ✓ TunnelConfig custom
  ✓ AllowList task checking
  ✓ AllowList disabled
  ✓ ErrorResponse equality
  ✓ SuccessResponse String
  ✓ Custom error codes
  ✓ Pattern matching

======================================================================

📊 Protocol Test Results:
   ✓ Passed:  15
   ✗ Failed:  0
   📝 Total:   15

🎉 All protocol tests passed!
```

**What's tested:**
- ✅ Core error handling (TunnelError)
- ✅ Protocol types (SuccessResponse, ErrorResponse)
- ✅ HTTP status codes (401, 403, 404, 405, 400, 500)
- ✅ Allow-list logic
- ✅ Error conversions
- ✅ Result types
- ✅ Config management

---

### 3. JavaScript Integration Tests
**Status:** ✅ Written, awaiting native addon build

**Location:** `test.js`

**Run with:**
```bash
npm run build  # Build native addon first
npm test
```

**Requirements:**
- Built native addon (.node file)
- Network access to build dependencies

**What's tested:**
- HTTP server creation
- Task registration and execution
- Event registration and emission
- Discovery endpoint
- Full request/response cycle

---

## Quick Test Commands

### Run ALL available tests:
```bash
# Standalone Rust tests (works now!)
rustc standalone_test.rs -o standalone_test && ./standalone_test

# When network available:
cargo test                 # Rust unit tests
npm run build && npm test  # Integration tests
```

### Run specific test:
```bash
# Just error handling tests
rustc standalone_test.rs -o standalone_test && ./standalone_test 2>&1 | grep "Error"

# With verbose output
RUST_BACKTRACE=1 ./standalone_test
```

---

## Test Coverage

| Component | Standalone | Unit Tests | Integration |
|-----------|-----------|------------|-------------|
| Error types | ✅ 15 tests | ✅ 10 tests | ⏳ Needs build |
| Protocol types | ✅ 15 tests | ✅ 15 tests | ⏳ Needs build |
| HTTP server | ❌ N/A | ⏳ Via integration | ⏳ Needs build |
| FFI/napi-rs | ❌ N/A | ⏳ Via integration | ⏳ Needs build |

**Total Rust Tests: 40**
- 15 standalone (passing now)
- 25 unit tests (ready to run)

---

## Troubleshooting

### "Cannot access crates.io"
Use standalone tests:
```bash
rustc standalone_test.rs -o standalone_test && ./standalone_test
```

### "Native addon not built"
The standalone tests don't need the addon - they test core logic only.

### "Test failed"
Check output for specific assertion failures. All tests include descriptive error messages.

---

## CI/CD Integration

For continuous integration, use this sequence:

```bash
# Always works (no network needed)
rustc standalone_test.rs -o standalone_test
./standalone_test || exit 1

# If network available
if cargo --version > /dev/null 2>&1; then
    cargo test || exit 1
    npm run build || exit 1
    npm test || exit 1
fi
```

---

## Test Philosophy

1. **Standalone tests** - Validate core logic without dependencies
2. **Unit tests** - Test with actual dependencies (serde, axum)
3. **Integration tests** - Test full FFI and HTTP stack

This layered approach ensures we can always verify correctness, even in restricted environments.
