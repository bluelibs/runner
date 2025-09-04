import { Play, Terminal, Package, Rocket } from "lucide-react";
import CodeBlock from "../components/CodeBlock";
import Meta from "../components/Meta";

const QuickStartPage: React.FC = () => {
  const steps = [
    {
      title: "Install Runner",
      description: "Get started with a simple npm install command",
      code: "npm install @bluelibs/runner",
      icon: Package,
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
      icon: Terminal,
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
      icon: Rocket,
    },
  ];

  const examples = [
    {
      title: "Express + OpenAPI + SQLite",
      description:
        "Complete REST API with OpenAPI documentation and SQLite database",
      link: "https://github.com/bluelibs/runner/tree/main/examples/express-openapi-sqlite",
    },
    // {
    //   title: "Microservice Template",
    //   description:
    //     "Production-ready microservice with logging, metrics, and health checks",
    //   link: "https://github.com/bluelibs/runner/tree/main/examples/microservice",
    // },
    // {
    //   title: "Event-Driven Architecture",
    //   description:
    //     "Showcase of events, hooks, and decoupled communication patterns",
    //   link: "https://github.com/bluelibs/runner/tree/main/examples/event-driven",
    // },
  ];

  return (
    <div className="pt-24 pb-16">
      <Meta
        title="Runner Quick Start — From install to first task in minutes"
        description="Install Runner, define a resource and a task, wire it up, and run. Step-by-step guide with copy-paste code."
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16 rounded-2xl bg-gradient-to-b from-blue-50/50 via-transparent dark:from-blue-900/20 py-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-6">
            <Play className="w-4 h-4 mr-2" />
            Quick Start Guide
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold text-gray-900 dark:text-white mb-8 tracking-tighter">
            Get Up and Running in
            <span className="gradient-text"> Minutes</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Runner is designed to get you productive immediately. Follow these
            steps and you'll have a running application in no time.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-12 mb-16">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              {/* Step number indicator */}
              <div className="flex items-center mb-4">
                <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-bold mr-4">
                  {index + 1}
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {step.title}
                </h3>
              </div>

              {/* Step content */}
              <div className="ml-12">
                <p className="text-gray-600 dark:text-gray-300 mb-6 text-lg">
                  {step.description}
                </p>

                <div className="card p-6">
                  <CodeBlock>{step.code}</CodeBlock>
                </div>
              </div>

              {/* Connecting line for non-last steps */}
              {index < steps.length - 1 && (
                <div className="absolute left-4 top-12 w-0.5 h-8 bg-gray-300 dark:bg-gray-600"></div>
              )}
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
            <a href="/docs" className="btn-primary">
              Read Full Documentation
            </a>
            <a href="/playground" className="btn-secondary">
              See Quick Examples
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">
            💡 Pro Tips
          </h2>
          <div className="space-y-6">
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="text-white text-sm font-semibold">1</span>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Start with debug mode
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-3">
                  Use debug mode to see exactly what's happening during development.
                </p>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                  <code className="text-sm text-gray-800 dark:text-gray-200">
                    {`run(app, { debug: "verbose" })`}
                  </code>
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="text-white text-sm font-semibold">2</span>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Test your tasks
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-3">
                  Tasks are just functions! Test them directly with mock dependencies.
                </p>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                  <code className="text-sm text-gray-800 dark:text-gray-200">
                    task.run(input, dependencies)
                  </code>
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="text-white text-sm font-semibold">3</span>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Use TypeScript
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Runner is TypeScript-first. You'll get amazing IntelliSense and catch errors at compile time.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickStartPage;
