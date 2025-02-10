import { AsyncLocalStorage } from 'node:async_hooks';

const asyncLocalStorage = new AsyncLocalStorage();

export type IApplicationContext = {
  user: User;
  roles: string[];
  isLoggedIn: boolean;
};

export function useContext(): IApplicationContext | undefined {
  return asyncLocalStorage.getStore();
}

export function withContext<T>(
  context: IApplicationContext,
  fn: (...args: any[]) => T,
  ...args: any[]
): T {
  return asyncLocalStorage.run(context, fn, ...args);
}
