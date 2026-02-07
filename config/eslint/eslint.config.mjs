import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import jestPlugin from "eslint-plugin-jest";
import unusedImports from "eslint-plugin-unused-imports";
import prettierPluginRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESLINT_CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(ESLINT_CONFIG_DIR, "../..");

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "examples/**",
      "web/**",
      "src/node/durable/dashboard/**",
      "scripts/**",
      "*.config.js",
      "*.config.mjs",
    ],
  },

  // Base ESLint & TypeScript configurations
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Jest configuration
  {
    files: ["src/__tests__/**/*.ts", "**/*.test.ts"],
    ...jestPlugin.configs["flat/recommended"],
    rules: {
      ...jestPlugin.configs["flat/recommended"].rules,
      // Allow conditional expect for testing different code paths
      "jest/no-conditional-expect": "off",
      // Allow tests without assertions (used for type checking or setup verification)
      "jest/expect-expect": "off",
      // Allow jasmine globals like fail() (used in legacy tests)
      "jest/no-jasmine-globals": "off",
      // Allow duplicate test titles (sometimes intentional for different contexts)
      "jest/no-identical-title": "off",
    },
  },

  // Core configuration & Unused Imports
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: REPO_ROOT_DIR,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      // Allow any as the codebase uses it extensively for generic wildcards
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      // Allow @ts-expect-error without description (common in tests)
      "@typescript-eslint/ban-ts-comment": "off",

      // Allow empty catch blocks (common pattern for ignoring errors)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow escape characters that may be unnecessary but harmless
      "no-useless-escape": "off",
      // Allow try/catch that re-throws (sometimes used for clarity)
      "no-useless-catch": "off",
      // Allow control characters in regex (used for ANSI color stripping)
      "no-control-regex": "off",
      // Allow optional chaining in arithmetic (handled by TypeScript)
      "no-unsafe-optional-chaining": "off",
      // Allow empty destructuring patterns (used for ignoring values)
      "no-empty-pattern": "off",
      // Allow constant conditions (sometimes used for debugging or feature flags)
      "no-constant-condition": "off",
      "no-constant-binary-expression": "off",
      // Warn instead of error for prefer-const
      "prefer-const": "warn",

      // Unused imports/vars configuration (blocking)
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Test file overrides (must come after core config to properly override)
  {
    files: ["src/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      // Keep test ergonomics while enforcing strictness in non-test code.
      "unused-imports/no-unused-vars": "off",
    },
  },

  // Prettier integration (must be last to override)
  prettierPluginRecommended,
);
