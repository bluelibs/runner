import { getPlatform } from "../platform";
import {
  __disposeActiveRunResultsForTests,
  __disposeActiveRunResultsForTestsExcept,
  __snapshotActiveRunResultsForTests,
} from "../run";
import {
  __resetProcessHooksForTests,
  __waitForProcessHooksIdleForTests,
} from "../tools/processShutdownHooks";

let baselineRunResults = new Set<any>();

beforeAll(async () => {
  await getPlatform().init();
});

beforeEach(() => {
  baselineRunResults = new Set(__snapshotActiveRunResultsForTests());
});

afterEach(async () => {
  jest.useRealTimers();
  await __disposeActiveRunResultsForTestsExcept(baselineRunResults);
  await __waitForProcessHooksIdleForTests();
  __resetProcessHooksForTests();
});

afterAll(async () => {
  jest.useRealTimers();
  await __disposeActiveRunResultsForTests();
  await __waitForProcessHooksIdleForTests();
  __resetProcessHooksForTests();
});
