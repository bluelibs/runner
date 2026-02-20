import { getPlatform } from "../platform";
import {
  __disposeActiveRunResultsForTests,
  __disposeActiveRunResultsForTestsExcept,
  __snapshotActiveRunResultsForTests,
} from "../run";

let baselineRunResults = new Set<any>();

beforeAll(async () => {
  await getPlatform().init();
});

beforeEach(() => {
  baselineRunResults = new Set(__snapshotActiveRunResultsForTests());
});

afterEach(async () => {
  await __disposeActiveRunResultsForTestsExcept(baselineRunResults);
});

afterAll(async () => {
  await __disposeActiveRunResultsForTests();
});
