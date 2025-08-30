import { useState } from 'react';
import { Copy, Check, Play, Terminal, Package, Rocket } from 'lucide-react';

const QuickStartPage: React.FC = () => {
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const copyToClipboard = (text: string, stepIndex: number) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(stepIndex);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  const steps = [
    {
      title: "Install BlueLibs Runner",
      description: "Get started with a simple npm install command",
      code: "npm install @bluelibs/runner",
      icon: Package
    },
    {
      title: "Create Your First App",
      description: "Set up the basic structure with resources and tasks",
      code: `import express from "express";
import { resource, task, run } from "@bluelibs/runner";

// A resource is anything you want to share across your app
const server = resource({
  id: "app.server",
  init: async (config: { port: number }) => {
    const app = express();
    const server = app.listen(config.port);
    console.log(\`Server running on port \${config.port}\`);
    return { app, server };
  },
  dispose: async ({ server }) => server.close(),
});

// Tasks are your business logic - pure, testable functions
const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { server },
  run: async (userData: { name: string }, { server }) => {
    // Your actual business logic here
    return { id: "user-123", ...userData };
  },
});`,
      icon: Terminal
    },
    {
      title: "Wire Everything Together",
      description: "Connect your components and start the application",
      code: `// Wire everything together
const app = resource({
  id: "app",
  register: [server.with({ port: 3000 }), createUser],
  dependencies: { server, createUser },
  init: async (_, { server, createUser }) => {
    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  },
});

// Start your application
const { dispose } = await run(app);`,
      icon: Rocket
    }
  ];

  const examples = [
    {
      title: "Express + OpenAPI + SQLite",
      description: "Complete REST API with OpenAPI documentation and SQLite database",
      link: "https://github.com/bluelibs/runner/tree/main/examples/express-openapi-sqlite"
    },
    {
      title: "Microservice Template",
      description: "Production-ready microservice with logging, metrics, and health checks",
      link: "https://github.com/bluelibs/runner/tree/main/examples/microservice"
    },
    {
      title: "Event-Driven Architecture",
      description: "Showcase of events, hooks, and decoupled communication patterns",
      link: "https://github.com/bluelibs/runner/tree/main/examples/event-driven"
    }
  ];

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-4">
            <Play className="w-4 h-4 mr-2" />
            Quick Start Guide
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Get Up and Running in
            <span className="gradient-text"> Minutes</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            BlueLibs Runner is designed to get you productive immediately. 
            Follow these steps and you'll have a running application in no time.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-12 mb-16">
          {steps.map((step, index) => (
            <div key={index} className="card p-8">
              <div className="flex items-start space-x-4 mb-6">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <step.icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
                      Step {index + 1}
                    </span>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                      {step.title}
                    </h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 mb-4">
                    {step.description}
                  </p>
                </div>
              </div>
              
              <div className="relative">
                <div className="absolute top-2 right-2 z-10">
                  <button
                    onClick={() => copyToClipboard(step.code, index)}
                    className="p-2 bg-gray-800/80 hover:bg-gray-700/80 rounded text-gray-300 hover:text-white transition-colors duration-200"
                    title="Copy to clipboard"
                  >
                    {copiedStep === index ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <pre className="code-block text-sm overflow-x-auto">
                  <code>{step.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>

        {/* What's Next */}
        <div className="card p-8 mb-16">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            🎉 Congratulations! What's Next?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Learn the Core Concepts
              </h3>
              <ul className="space-y-2 text-gray-600 dark:text-gray-300">
                <li>• Tasks - Your business logic functions</li>
                <li>• Resources - Singletons and services</li>
                <li>• Events - Decoupled communication</li>
                <li>• Middleware - Cross-cutting concerns</li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Explore Advanced Features
              </h3>
              <ul className="space-y-2 text-gray-600 dark:text-gray-300">
                <li>• Context for request-scoped data</li>
                <li>• Built-in caching and retry logic</li>
                <li>• Performance monitoring</li>
                <li>• Graceful shutdown handling</li>
              </ul>
            </div>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-4">
            <a
              href="/docs"
              className="btn-primary"
            >
              Read Full Documentation
            </a>
            <a
              href="/playground"
              className="btn-secondary"
            >
              Try Interactive Examples
            </a>
          </div>
        </div>

        {/* Example Projects */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-8 text-center">
            Example Projects
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {examples.map((example, index) => (
              <a
                key={index}
                href={example.link}
                target="_blank"
                rel="noopener noreferrer"
                className="card p-6 hover:scale-105 transition-transform duration-200 cursor-pointer"
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                  {example.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">
                  {example.description}
                </p>
                <div className="text-blue-600 dark:text-blue-400 text-sm font-medium">
                  View on GitHub →
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div className="card p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            💡 Pro Tips
          </h2>
          <div className="space-y-4 text-gray-600 dark:text-gray-300">
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs font-bold">1</span>
              </div>
              <p>
                <strong className="text-gray-900 dark:text-white">Start with debug mode:</strong> 
                Use <code className="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">{`run(app, { debug: "verbose" })`}</code> 
                to see exactly what's happening during development.
              </p>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs font-bold">2</span>
              </div>
              <p>
                <strong className="text-gray-900 dark:text-white">Test your tasks:</strong> 
                Tasks are just functions! Test them by calling <code className="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">task.run(input, dependencies)</code> 
                directly with mock dependencies.
              </p>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs font-bold">3</span>
              </div>
              <p>
                <strong className="text-gray-900 dark:text-white">Use TypeScript:</strong> 
                Runner is TypeScript-first. You'll get amazing IntelliSense and catch errors at compile time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickStartPage;