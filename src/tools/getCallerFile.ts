export function getCallerFile(): string | undefined {
  const originalFunc = Error.prepareStackTrace;

  try {
    const err = new Error();
    let callerfile;
    let currentfile;

    // Safeguard prepareStackTrace
    Error.prepareStackTrace = (err, stack) => stack;

    const stack = err.stack as unknown as NodeJS.CallSite[];

    // Don't know how to test this.
    // if (stack.length < 3) {
    //   // We need at least 3 frames: current function, its caller, and one above
    //   return undefined;
    // }

    // Remove the first frame (getCallerFile itself)
    stack.shift();

    // Remove the second frame (the direct caller of getCallerFile)
    currentfile = stack.shift()?.getFileName();

    // The third frame (the caller above the immediate one)
    callerfile = stack.shift()?.getFileName();

    return callerfile; // Return the file name of the caller above
  } finally {
    Error.prepareStackTrace = originalFunc;
  }
}
