/**
 * Utility to execute a function and handle both sync and async functions efficiently.
 * If the function returns a Promise, it awaits it; otherwise returns the result directly.
 * 
 * @param fn The function to execute
 * @param args The arguments to pass to the function
 * @returns The result of the function, awaited if it's a Promise
 */
export async function executeFunction<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
  const result = fn(...args);
  return result instanceof Promise ? await result : result;
}

/**
 * Synchronous version that returns the result directly for sync functions,
 * or throws if the function returns a Promise (async function).
 * This is useful when you know a function should be synchronous.
 * 
 * @param fn The function to execute
 * @param args The arguments to pass to the function  
 * @returns The result of the function
 * @throws Error if the function returns a Promise
 */
export function executeFunctionSync<T>(fn: (...args: any[]) => T, ...args: any[]): T {
  const result = fn(...args);
  if (result instanceof Promise) {
    throw new Error('Function returned a Promise but synchronous execution was expected');
  }
  return result;
}