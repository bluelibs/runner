import { getPlatform } from "../platform";

beforeAll(async () => {
  await getPlatform().init();
});
