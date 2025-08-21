import * as fs from "fs";
import * as path from "path";
import { Store } from "./models/Store";
import { EventManager } from "./models/EventManager";
import { Logger } from "./models/Logger";
import { TaskRunner } from "./models/TaskRunner";
import { DependencyProcessor } from "./models/DependencyProcessor";
import { createDefaultUnhandledError } from "./models/UnhandledError";
import { IResource, ITask, IEvent, ITaskMiddleware, IResourceMiddleware } from "./defs";
import { isTask, isResource, isEvent, isTaskMiddleware, isResourceMiddleware } from "./definers/tools";

interface CLIOptions {
  extractDocs?: string;
  outDir?: string;
  help?: boolean;
}

interface ComponentInfo {
  id: string;
  type: 'resource' | 'task' | 'event' | 'taskMiddleware' | 'resourceMiddleware';
  meta?: {
    title?: string;
    description?: string;
  };
  dependencies?: string[];
  tags?: string[];
}

interface ProjectDocumentation {
  overview: {
    totalResources: number;
    totalTasks: number;
    totalEvents: number;
    totalMiddleware: number;
    generatedAt: string;
  };
  components: {
    resources: ComponentInfo[];
    tasks: ComponentInfo[];
    events: ComponentInfo[];
    middleware: ComponentInfo[];
  };
  dependencyGraph: {
    [componentId: string]: string[];
  };
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--extract-docs':
        options.extractDocs = args[++i];
        break;
      case '--out-dir':
        options.outDir = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
BlueLibs Runner Documentation Extractor

Usage:
  runner --extract-docs <entry-file> --out-dir <output-directory>

Options:
  --extract-docs <file>    Entry point file to analyze (e.g., index.ts)
  --out-dir <dir>         Output directory for documentation
  --help, -h              Show this help message

Examples:
  runner --extract-docs index.ts --out-dir ./documentation
  runner --extract-docs src/app.ts --out-dir ./docs
`);
}

async function extractDocumentationFromStore(store: Store): Promise<ProjectDocumentation> {
  const doc: ProjectDocumentation = {
    overview: {
      totalResources: 0,
      totalTasks: 0,
      totalEvents: 0,
      totalMiddleware: 0,
      generatedAt: new Date().toISOString(),
    },
    components: {
      resources: [],
      tasks: [],
      events: [],
      middleware: [],
    },
    dependencyGraph: {},
  };

  // Extract resources
  for (const [id, resourceElement] of store.resources.entries()) {
    const resource = resourceElement.resource;
    const info: ComponentInfo = {
      id,
      type: 'resource',
      meta: resource.meta,
      dependencies: extractDependencyIds(resource.dependencies),
      tags: extractTagIds(resource.tags),
    };
    doc.components.resources.push(info);
    doc.dependencyGraph[id] = info.dependencies || [];
  }

  // Extract tasks
  for (const [id, taskElement] of store.tasks.entries()) {
    const task = taskElement.task;
    const info: ComponentInfo = {
      id,
      type: 'task',
      meta: task.meta,
      dependencies: extractDependencyIds(task.dependencies),
      tags: extractTagIds(task.tags),
    };
    doc.components.tasks.push(info);
    doc.dependencyGraph[id] = info.dependencies || [];
  }

  // Extract events
  for (const [id, eventElement] of store.events.entries()) {
    const event = eventElement.event;
    const info: ComponentInfo = {
      id,
      type: 'event',
      meta: event.meta,
      tags: extractTagIds(event.tags),
    };
    doc.components.events.push(info);
  }

  // Extract task middleware
  for (const [id, middlewareElement] of store.taskMiddlewares.entries()) {
    const middleware = middlewareElement.middleware;
    const info: ComponentInfo = {
      id,
      type: 'taskMiddleware',
      meta: middleware.meta,
      dependencies: extractDependencyIds(middleware.dependencies),
      tags: extractTagIds(middleware.tags),
    };
    doc.components.middleware.push(info);
    doc.dependencyGraph[id] = info.dependencies || [];
  }

  // Extract resource middleware
  for (const [id, middlewareElement] of store.resourceMiddlewares.entries()) {
    const middleware = middlewareElement.middleware;
    const info: ComponentInfo = {
      id,
      type: 'resourceMiddleware',
      meta: middleware.meta,
      dependencies: extractDependencyIds(middleware.dependencies),
      tags: extractTagIds(middleware.tags),
    };
    doc.components.middleware.push(info);
    doc.dependencyGraph[id] = info.dependencies || [];
  }

  // Update overview counts
  doc.overview.totalResources = doc.components.resources.length;
  doc.overview.totalTasks = doc.components.tasks.length;
  doc.overview.totalEvents = doc.components.events.length;
  doc.overview.totalMiddleware = doc.components.middleware.length;

  return doc;
}

function extractDependencyIds(dependencies: any): string[] {
  if (!dependencies) return [];
  
  const ids: string[] = [];
  if (typeof dependencies === 'object') {
    for (const [key, dep] of Object.entries(dependencies)) {
      if (dep && typeof dep === 'object' && 'id' in dep) {
        ids.push((dep as any).id);
      }
    }
  }
  return ids;
}

function extractTagIds(tags: any): string[] {
  if (!Array.isArray(tags)) return [];
  
  return tags.map(tag => {
    if (typeof tag === 'string') return tag;
    if (tag && typeof tag === 'object' && 'id' in tag) return tag.id;
    return String(tag);
  });
}

async function generateDocumentationFiles(doc: ProjectDocumentation, outDir: string) {
  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Generate JSON documentation
  const jsonPath = path.join(outDir, 'documentation.json');
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));

  // Generate Markdown overview
  const markdownPath = path.join(outDir, 'README.md');
  const markdown = generateMarkdownOverview(doc);
  fs.writeFileSync(markdownPath, markdown);

  // Generate component-specific files
  await generateComponentFiles(doc, outDir);

  console.log(`Documentation generated successfully in: ${outDir}`);
  console.log(`- JSON: ${jsonPath}`);
  console.log(`- Overview: ${markdownPath}`);
}

function generateMarkdownOverview(doc: ProjectDocumentation): string {
  return `# Project Documentation

Generated on: ${doc.overview.generatedAt}

## Overview

- **Resources**: ${doc.overview.totalResources}
- **Tasks**: ${doc.overview.totalTasks}
- **Events**: ${doc.overview.totalEvents}
- **Middleware**: ${doc.overview.totalMiddleware}

## Resources

${doc.components.resources.map(r => `### ${r.id}

${r.meta?.title ? `**${r.meta.title}**` : ''}

${r.meta?.description || 'No description available.'}

- **Dependencies**: ${r.dependencies?.join(', ') || 'None'}
- **Tags**: ${r.tags?.join(', ') || 'None'}
`).join('\n')}

## Tasks

${doc.components.tasks.map(t => `### ${t.id}

${t.meta?.title ? `**${t.meta.title}**` : ''}

${t.meta?.description || 'No description available.'}

- **Dependencies**: ${t.dependencies?.join(', ') || 'None'}
- **Tags**: ${t.tags?.join(', ') || 'None'}
`).join('\n')}

## Events

${doc.components.events.map(e => `### ${e.id}

${e.meta?.title ? `**${e.meta.title}**` : ''}

${e.meta?.description || 'No description available.'}

- **Tags**: ${e.tags?.join(', ') || 'None'}
`).join('\n')}

## Middleware

${doc.components.middleware.map(m => `### ${m.id}

${m.meta?.title ? `**${m.meta.title}**` : ''}

${m.meta?.description || 'No description available.'}

- **Type**: ${m.type}
- **Dependencies**: ${m.dependencies?.join(', ') || 'None'}
- **Tags**: ${m.tags?.join(', ') || 'None'}
`).join('\n')}
`;
}

async function generateComponentFiles(doc: ProjectDocumentation, outDir: string) {
  // Create subdirectories for each component type
  const dirs = ['resources', 'tasks', 'events', 'middleware'];
  dirs.forEach(dir => {
    const dirPath = path.join(outDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });

  // Generate individual component files
  const allComponents = [
    ...doc.components.resources,
    ...doc.components.tasks,
    ...doc.components.events,
    ...doc.components.middleware,
  ];

  for (const component of allComponents) {
    const fileName = `${component.id.replace(/[^a-zA-Z0-9.-]/g, '_')}.md`;
    const componentDir = component.type === 'taskMiddleware' || component.type === 'resourceMiddleware' 
      ? 'middleware' 
      : component.type + 's';
    const filePath = path.join(outDir, componentDir, fileName);
    
    const content = generateComponentMarkdown(component, doc);
    fs.writeFileSync(filePath, content);
  }
}

function generateComponentMarkdown(component: ComponentInfo, doc: ProjectDocumentation): string {
  const dependents = Object.entries(doc.dependencyGraph)
    .filter(([id, deps]) => deps.includes(component.id))
    .map(([id]) => id);

  return `# ${component.id}

${component.meta?.title ? `## ${component.meta.title}` : ''}

${component.meta?.description || 'No description available.'}

## Details

- **Type**: ${component.type}
- **ID**: \`${component.id}\`
${component.tags?.length ? `- **Tags**: ${component.tags.map(t => `\`${t}\``).join(', ')}` : ''}

${component.dependencies?.length ? `## Dependencies

This component depends on:
${component.dependencies.map(dep => `- \`${dep}\``).join('\n')}
` : ''}

${dependents.length ? `## Dependents

The following components depend on this one:
${dependents.map(dep => `- \`${dep}\``).join('\n')}
` : ''}
`;
}

async function createStoreFromProject(entryFile: string): Promise<Store> {
  const resolvedPath = path.resolve(entryFile);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Entry file not found: ${resolvedPath}`);
  }

  // Create a minimal store setup similar to the run() function
  const eventManager = new EventManager();
  const logger = new Logger({
    printThreshold: "info",
    printStrategy: "pretty",
    bufferLogs: false
  }, {}, "cli");
  const onUnhandledError = createDefaultUnhandledError(logger);
  const store = new Store(eventManager, logger, onUnhandledError);
  const taskRunner = new TaskRunner(store, eventManager, logger);
  store.setTaskRunner(taskRunner);

  // Import the entry file dynamically
  try {
    const moduleExports = await import(resolvedPath);
    
    // Find and register all BlueLibs Runner components in the exported module
    const registeredItems = [];
    for (const [exportName, exportValue] of Object.entries(moduleExports)) {
      if (exportValue && typeof exportValue === 'object') {
        // Check if it's a BlueLibs component using the type guards
        if (isResource(exportValue) || isTask(exportValue) || isEvent(exportValue) || 
            isTaskMiddleware(exportValue) || isResourceMiddleware(exportValue)) {
          store.storeGenericItem(exportValue as any);
          registeredItems.push(exportName);
        }
      }
    }
    
    if (registeredItems.length === 0) {
      console.warn('Warning: No BlueLibs Runner components found in the entry file. Make sure you export your resources, tasks, events, and middleware.');
    } else {
      console.log(`Found and registered ${registeredItems.length} components: ${registeredItems.join(', ')}`);
    }
    
  } catch (error) {
    console.error(`Error loading entry file: ${error}`);
    throw error;
  }

  return store;
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || args.length === 0) {
    showHelp();
    return;
  }

  if (!options.extractDocs) {
    console.error('Error: --extract-docs option is required');
    showHelp();
    process.exit(1);
  }

  if (!options.outDir) {
    console.error('Error: --out-dir option is required');
    showHelp();
    process.exit(1);
  }

  try {
    console.log(`Loading project from: ${options.extractDocs}`);
    const store = await createStoreFromProject(options.extractDocs);
    
    console.log('Extracting documentation...');
    const documentation = await extractDocumentationFromStore(store);
    
    console.log(`Generating documentation files...`);
    await generateDocumentationFiles(documentation, options.outDir);
    
  } catch (error) {
    console.error('Error generating documentation:', error);
    process.exit(1);
  }
}

// Run the CLI
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}