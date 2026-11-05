#!/usr/bin/env node
import { dirname, relative, sep } from "node:path";
import {
  Application,
  ArgumentsReader,
  PackageJsonReader,
  TSConfigReader,
  TypeDocReader,
  TypeScript,
} from "typedoc";

function checkErrors(app) {
  if (app.logger.hasErrors()) {
    throw new Error("Documentation generation failed; see the errors above.");
  }
  if (
    app.options.getValue("treatWarningsAsErrors") &&
    app.logger.hasWarnings()
  ) {
    throw new Error("Documentation warnings are configured as errors.");
  }
}

function createEntryPoint(app) {
  const entries = app.options.getValue("entryPoints");
  if (
    entries.length !== 1 ||
    app.options.getValue("entryPointStrategy") !== "resolve" ||
    app.options.getValue("projectDocuments").length ||
    app.options.getValue("watch")
  ) {
    throw new Error(
      "Documentation requires one explicit source file without document globs or watch mode.",
    );
  }

  const compilerOptions = app.options.getCompilerOptions(app.logger);
  checkErrors(app);
  const program = TypeScript.createProgram({
    rootNames: app.options.getFileNames(),
    options: compilerOptions,
    projectReferences: app.options.getProjectReferences(),
  });
  const sourceFile = program.getSourceFile(entries[0]);
  if (!sourceFile) {
    throw new Error(
      `Documentation entry point must be an explicit source file in the TypeScript project: ${entries[0]}`,
    );
  }

  if (!app.options.getValue("skipErrorChecking")) {
    const diagnostics = TypeScript.getPreEmitDiagnostics(program);
    if (diagnostics.length) {
      throw new Error(
        TypeScript.formatDiagnostics(diagnostics, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: TypeScript.sys.getCurrentDirectory,
          getNewLine: () => TypeScript.sys.newLine,
        }),
      );
    }
  }
  if (app.options.getValue("emit") === "both") program.emit();

  const base =
    app.options.getValue("displayBasePath") ||
    app.options.getValue("basePath") ||
    dirname(entries[0]);
  const displayName = relative(base, entries[0])
    .split(sep)
    .join("/")
    .replace(/(\/index)?(\.d)?\.([cm][tj]s|[tj]sx?)$/, "");
  return { displayName, program, sourceFile };
}

const app = await Application.bootstrapWithPlugins({}, [
  new ArgumentsReader(0),
  new TypeDocReader(),
  new PackageJsonReader(),
  new TSConfigReader(),
  new ArgumentsReader(300).ignoreErrors(),
]);
checkErrors(app);

if (app.options.getValue("help")) {
  console.log(app.options.getHelp());
} else if (app.options.getValue("version")) {
  console.log(app.toString());
} else if (app.options.getValue("showConfig")) {
  console.log(app.options.getRawValues());
} else {
  // Our entry point is explicit: TypeDoc's legacy glob discovery is unnecessary
  // and depends on matchOne, which patched minimatch no longer exposes.
  const entryPoints = [createEntryPoint(app)];
  await app.initializeRepositories(entryPoints);
  const project = app.converter.convert(entryPoints);
  checkErrors(app);

  const warningsBeforeValidation = app.logger.warningCount;
  app.validate(project);
  checkErrors(app);
  if (
    app.options.getValue("treatValidationWarningsAsErrors") &&
    (app.logger.warningCount !== warningsBeforeValidation ||
      app.logger.validationWarningCount !== 0)
  ) {
    throw new Error(
      "Documentation validation warnings are configured as errors.",
    );
  }

  if (app.options.getValue("emit") !== "none") {
    await app.generateOutputs(project);
    checkErrors(app);
  }
}
