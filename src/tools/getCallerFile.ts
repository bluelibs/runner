export function getCallerFile(): string {
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

    return callerfile as string; // Return the file name of the caller above
  } finally {
    Error.prepareStackTrace = originalFunc;
  }
}

/**
 * Gets a file path, looks at all the parts between current path and 'src' and generates a unique symbol based on that.
 * If there is no 'src' to be found, it will rely on using the last 4 parts of the path.
 * This is useful for generating unique IDs for tasks, resources, etc.
 * @param filePath
 * @returns
 */
export function generateCallerIdFromFile(
  filePath: string,
  suffix: string = "",
  fallbackParts: number = 4
): symbol {
  // Normalize paths for consistency across platforms
  const normalizedPath = filePath.replace(/\\/g, "/");
  const cwdNormalized = process.cwd().replace(/\\/g, "/");

  const parts = normalizedPath.split("/");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");

  let relevantParts: string[];

  if (nodeModulesIndex !== -1) {
    // If inside node_modules, generate id relative to the package path
    relevantParts = parts.slice(nodeModulesIndex + 1);
  } else if (
    normalizedPath === cwdNormalized ||
    normalizedPath.startsWith(cwdNormalized + "/")
  ) {
    // Prefer generating id relative to the workspace root (process.cwd())
    const relativeToCwd = normalizedPath
      .slice(cwdNormalized.length)
      .replace(/^\//, "");
    relevantParts = relativeToCwd.length > 0 ? relativeToCwd.split("/") : [""];
  } else {
    // Fallback: use the last N parts if path is outside cwd and not in node_modules
    relevantParts = parts.slice(-fallbackParts);
  }

  if (relevantParts.length > 0) {
    const lastPartIndex = relevantParts.length - 1;
    const lastPart = relevantParts[lastPartIndex];
    const dotIndex = lastPart.lastIndexOf(".");
    if (dotIndex !== -1 && dotIndex > 0) {
      const extension = lastPart.substring(dotIndex + 1);
      const knownExtensions = ["ts", "js", "tsx", "jsx", "json", "node"];
      if (knownExtensions.includes(extension)) {
        relevantParts[lastPartIndex] = lastPart.substring(0, dotIndex);
      }
    }
  }

  const id = relevantParts.join(".");
  const lastPart =
    relevantParts.length > 0 ? relevantParts[relevantParts.length - 1] : "";

  let finalId = id;
  if (suffix && !lastPart.includes(suffix)) {
    finalId += "." + suffix;
  }

  return Symbol(finalId);
}
