/**
 * RegExp pattern safety validation for ReDoS protection.
 * Extracted from Serializer.ts as a standalone module.
 */

export interface RegExpPayload {
  pattern: string;
  flags: string;
}

export interface RegExpValidatorOptions {
  maxPatternLength: number;
  allowUnsafe: boolean;
}

const ALLOWED_REGEXP_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

const assertRegExpFlags = (flags: string): string => {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!ALLOWED_REGEXP_FLAGS.has(flag) || seen.has(flag)) {
      throw new Error("Invalid RegExp flags");
    }
    seen.add(flag);
  }
  return flags;
};

/**
 * Check if a character is a quantifier at the given position.
 */
export const isQuantifierAt = (pattern: string, index: number): boolean => {
  if (index >= pattern.length) {
    return false;
  }
  const char = pattern[index];
  if (char === "*" || char === "+" || char === "?") {
    return true;
  }
  if (char === "{") {
    return isBoundedQuantifier(pattern, index);
  }
  return false;
};

/**
 * Check if a character represents a quantifier (*, +, ?, {n,m}).
 */
export const isQuantifierChar = (
  char: string,
  pattern: string,
  index: number,
): boolean => {
  if (char === "*" || char === "+") {
    return true;
  }
  if (char === "?") {
    if (index > 0 && pattern[index - 1] === "(") {
      return false;
    }
    return true;
  }
  if (char === "{") {
    return isBoundedQuantifier(pattern, index);
  }
  return false;
};

/**
 * Check if the pattern contains a bounded quantifier at the given position.
 */
export const isBoundedQuantifier = (
  pattern: string,
  index: number,
): boolean => {
  let sawDigit = false;
  let sawComma = false;

  for (let i = index + 1; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char >= "0" && char <= "9") {
      sawDigit = true;
      continue;
    }
    if (char === "," && !sawComma) {
      sawComma = true;
      continue;
    }
    if (char === "}") {
      return sawDigit;
    }
    return false;
  }
  return false;
};

const stripGroupPrefix = (groupBody: string): string => {
  if (!groupBody.startsWith("?")) {
    return groupBody;
  }
  if (
    groupBody.startsWith("?:") ||
    groupBody.startsWith("?=") ||
    groupBody.startsWith("?!") ||
    groupBody.startsWith("?>")
  ) {
    return groupBody.slice(2);
  }
  if (groupBody.startsWith("?<=") || groupBody.startsWith("?<!")) {
    return groupBody.slice(3);
  }
  if (groupBody.startsWith("?<")) {
    const closeIndex = groupBody.indexOf(">");
    if (closeIndex > 1) {
      return groupBody.slice(closeIndex + 1);
    }
  }
  return groupBody;
};

const splitTopLevelAlternation = (groupBody: string): string[] => {
  const branches: string[] = [];
  let escaped = false;
  let inCharClass = false;
  let nestedDepth = 0;
  let branchStart = 0;
  let hasAlternation = false;

  for (let index = 0; index < groupBody.length; index += 1) {
    const char = groupBody[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inCharClass) {
      if (char === "]") {
        inCharClass = false;
      }
      continue;
    }
    if (char === "[") {
      inCharClass = true;
      continue;
    }
    if (char === "(") {
      nestedDepth += 1;
      continue;
    }
    if (char === ")") {
      if (nestedDepth > 0) {
        nestedDepth -= 1;
      }
      continue;
    }
    if (char === "|" && nestedDepth === 0) {
      branches.push(groupBody.slice(branchStart, index));
      branchStart = index + 1;
      hasAlternation = true;
    }
  }

  if (!hasAlternation) {
    return [];
  }

  branches.push(groupBody.slice(branchStart));
  return branches;
};

const hasOverlappingAlternationPrefix = (groupBody: string): boolean => {
  const normalizedBody = stripGroupPrefix(groupBody);
  const branches = splitTopLevelAlternation(normalizedBody);
  if (branches.length < 2) {
    return false;
  }

  for (let i = 0; i < branches.length; i += 1) {
    for (let j = i + 1; j < branches.length; j += 1) {
      const left = branches[i];
      const right = branches[j];
      if (left.length === 0 || right.length === 0) {
        return true;
      }
      if (left.startsWith(right) || right.startsWith(left)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Check if a RegExp pattern is safe from ReDoS attacks.
 * Detects nested quantifiers which are a common ReDoS vector.
 */
export const isRegExpPatternSafe = (pattern: string): boolean => {
  const groupStack: Array<{ hasQuantifier: boolean; startIndex: number }> = [];
  let escaped = false;
  let inCharClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inCharClass) {
      if (char === "]") {
        inCharClass = false;
      }
      continue;
    }
    if (char === "[") {
      inCharClass = true;
      continue;
    }
    if (char === "(") {
      groupStack.push({ hasQuantifier: false, startIndex: index });
      continue;
    }
    if (char === ")") {
      const group = groupStack.pop();
      if (!group) {
        continue;
      }

      const isQuantifiedGroup = isQuantifierAt(pattern, index + 1);
      if (isQuantifiedGroup) {
        if (group.hasQuantifier) {
          return false;
        }
        const groupBody = pattern.slice(group.startIndex + 1, index);
        if (hasOverlappingAlternationPrefix(groupBody)) {
          return false;
        }
      }

      if (group.hasQuantifier && groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasQuantifier = true;
      }
      continue;
    }
    if (isQuantifierChar(char, pattern, index)) {
      if (groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasQuantifier = true;
      }
    }
  }

  return true;
};

/**
 * Validate and extract a RegExp payload from unknown data.
 * Enforces pattern length limits and optional safety checks.
 */
export const assertRegExpPayload = (
  value: unknown,
  options: RegExpValidatorOptions,
): RegExpPayload => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid RegExp payload");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.pattern !== "string" || typeof record.flags !== "string") {
    throw new Error("Invalid RegExp payload");
  }
  if (record.pattern.length > options.maxPatternLength) {
    throw new Error(
      `RegExp pattern exceeds limit (${options.maxPatternLength})`,
    );
  }
  if (!options.allowUnsafe && !isRegExpPatternSafe(record.pattern)) {
    throw new Error("Unsafe RegExp pattern");
  }
  return {
    pattern: record.pattern,
    flags: assertRegExpFlags(record.flags),
  };
};
