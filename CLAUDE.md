# Runner Codebase Guidelines

## Build/Test Commands
- `npm run build` - Build the project
- `npm run watch` - Build in watch mode
- `npm test` - Run all tests
- `npm run test:dev` - Run tests in watch mode
- `jest src/__tests__/path/to/test.ts` - Run a single test
- `npm run coverage` - Generate coverage report
- `npm run typedoc` - Generate documentation
- `npm run benchmark` - Run benchmarks

## Code Style
- **TypeScript**: Strict mode with null checks
- **Naming**: Interfaces prefixed with 'I' (e.g., ITask, IResource)
- **Quotes**: Double quotes for strings
- **Formatting**: 2-space indentation, trailing commas (ES5)
- **Types**: Explicit generic types, leveraging inference where appropriate
- **Error Handling**: Use the Errors object from errors.ts for consistent messages
- **Documentation**: JSDoc comments for public methods/functions
- **Functional Style**: Prefer immutable patterns and pure functions