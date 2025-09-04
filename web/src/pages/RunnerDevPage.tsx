import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Zap,
  Gauge,
  Check,
  Play,
  GitBranch,
  Database,
  Settings,
  Brain,
  Eye,
  FileText,
  Terminal,
  Activity,
  Layers,
  Search,
  Download,
} from "lucide-react";
import CodeBlock from "../components/CodeBlock";
import Meta from "../components/Meta";
import RunnerDevUrlCards from "../components/RunnerDevUrlCards";
import IntelligentZoomImage from "../components/IntelligentZoomImage";

// Feature showcase data with corresponding images
const features = [
  {
    id: "ai-assistant",
    title: "AI Assistant Integration",
    description:
      "Built-in MCP server that allows AI assistants to introspect your app, run tasks, debug issues, and even hot-swap functions for live debugging.",
    image: "/runner-dev/ai-assistant-embedded-in-your-app.png",
    icon: Brain,
    gradient: "from-emerald-500 to-teal-600",
    details: [
      "Model Context Protocol (MCP) server for seamless AI integration",
      "AI can introspect your entire application topology",
      "Debug and modify running applications with AI assistance",
      "Query tasks, resources, events, and middleware programmatically",
    ],
  },
  {
    id: "app-overview",
    title: "Complete Application Topology",
    description:
      "Visualize your entire app structure with tasks, resources, events, hooks, and their dependencies in one comprehensive view.",
    image: "/runner-dev/your-app-at-one-glance.png",
    icon: Eye,
    gradient: "from-blue-500 to-purple-600",
    details: [
      "Interactive GraphQL API for deep exploration",
      "Built-in GraphQL Playground for query testing",
      "Voyager schema visualization for graph exploration",
      "Dependency graph visualization",
      "Real-time topology updates",
      "File-aware metadata with source locations",
    ],
  },
  {
    id: "insights",
    title: "Granular Performance Insights",
    description:
      "Monitor your application's performance with real-time metrics, execution traces, and correlation tracking across your entire system.",
    image: "/runner-dev/gain-granular-insights.png",
    icon: Gauge,
    gradient: "from-purple-500 to-pink-600",
    details: [
      "Real-time performance monitoring",
      "Memory, CPU, and event loop metrics",
      "Execution time tracking per task",
      "Correlation ID tracing across operations",
    ],
  },
  {
    id: "diagnostics",
    title: "Smart Diagnostics",
    description:
      "Advanced diagnostics system that detects orphaned events, unused middleware, missing files, and other potential issues automatically.",
    image: "/runner-dev/diagnostics-for-your-app.png",
    icon: Search,
    gradient: "from-pink-500 to-red-600",
    details: [
      "Automatic issue detection and reporting",
      "Orphaned event detection",
      "Unused middleware identification",
      "File system integrity checks",
    ],
  },
  {
    id: "file-editing",
    title: "Live File Preview & Editing",
    description:
      "Browse and edit your source files directly from the dev interface with syntax highlighting and real-time file system integration.",
    image: "/runner-dev/preview-and-edit-files-in-place.png",
    icon: FileText,
    gradient: "from-red-500 to-orange-600",
    details: [
      "In-browser file editing with syntax highlighting",
      "Real-time file system synchronization",
      "Source location links from GraphQL data",
      "Integrated development workflow",
    ],
  },
  {
    id: "task-execution",
    title: "Interactive Task Execution",
    description:
      "Run tasks, emit events, and test your application logic directly from the interface with full input/output serialization.",
    image: "/runner-dev/run-tasks-or-emit-events.png",
    icon: Play,
    gradient: "from-orange-500 to-yellow-600",
    details: [
      "Execute tasks with custom inputs",
      "JavaScript expression evaluation",
      "Pure mode bypass for testing",
      "Real-time execution feedback",
    ],
  },
  {
    id: "custom-ai",
    title: "Customize Your AI Experience",
    description:
      "Tailor the AI assistant integration to your workflow with custom prompts, specialized agents, and development-specific automations.",
    image: "/runner-dev/customize-your-own-ai.png",
    icon: Settings,
    gradient: "from-yellow-500 to-green-600",
    details: [
      "Customizable AI provider",
      "Development workflow automation",
      "Context-aware code generation",
      "Intelligent debugging assistance",
    ],
  },
  {
    id: "visualization-type",
    title: "Type-Based Visualization",
    description:
      "Advanced visualization options that let you explore your application by types, schemas, and data relationships.",
    image: "/runner-dev/vizualize-them-your-way-type.png",
    icon: Layers,
    gradient: "from-green-500 to-blue-600",
    details: [
      "Schema-aware data visualization",
      "Type relationship mapping",
      "JSON Schema integration with Zod",
      "Data flow visualization",
    ],
  },
  {
    id: "visualization-namespace",
    title: "Namespace Organization",
    description:
      "Organize and visualize your application components by namespaces for better architecture understanding and navigation.",
    image: "/runner-dev/vizualize-them-your-way-namespace.png",
    icon: Database,
    gradient: "from-blue-500 to-purple-600",
    details: [
      "Hierarchical namespace organization",
      "Domain-driven design visualization",
      "Component grouping and filtering",
      "Architecture overview at a glance",
    ],
  },
];

const RunnerDevPage: React.FC = () => {
  const [selectedFeature, setSelectedFeature] = useState<number>(0);

  const installationSteps = [
    {
      title: "Global Installation",
      code: "npm install -g @bluelibs/runner-dev",
      description:
        "Install the CLI tools globally for scaffolding and project management.",
    },
    {
      title: "Add to Your App",
      code: `import { resource } from "@bluelibs/runner";
import { dev } from "@bluelibs/runner-dev";

export const app = resource({
  id: "app",
  register: [
    dev.with({
      port: 1337, // GraphQL server port
      maxEntries: 10000, // Log entries to keep
    }),
    // ... your other resources
  ],
});`,
      description: "Register the dev resource in your Runner application.",
    },
    {
      title: "Configure AI Integration",
      code: `{
  "mcpServers": {
    "runner-dev": {
      "command": "npx",
      "args": ["@bluelibs/runner-dev", "mcp"],
      "env": {
        "ENDPOINT": "http://localhost:1337/graphql",
        "ALLOW_MUTATIONS": "true"
      }
    }
  }
}`,
      description: "Add MCP server configuration for AI assistant integration.",
    },
  ];

  const cliCommands = [
    {
      command: "runner-dev new my-app",
      description: "Create a new Runner project with complete TypeScript setup",
    },
    {
      command: "runner-dev new task user-create --ns app.users",
      description: "Scaffold a new task with proper namespace organization",
    },
    {
      command: "runner-dev query 'query { tasks { id } }'",
      description: "Query your running application via GraphQL",
    },
    {
      command: "runner-dev overview --details 10",
      description: "Generate a comprehensive project overview with insights",
    },
  ];

  return (
    <div className="pt-16">
      <Meta
        title="Runner Dev Tools — AI-powered development environment"
        description="Introspection, live telemetry, and AI-powered debugging for Runner applications. Complete development toolkit with GraphQL API, hot-swapping, and real-time monitoring."
        image="/og/runner-dev-og.svg"
      />

      {/* Hero Section */}
      <section className="min-h-[90vh] flex items-center justify-center relative overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-pink-50/50 dark:from-blue-950/50 dark:via-purple-950/30 dark:to-pink-950/50"></div>

        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-purple-400/20 to-blue-400/20 rounded-full blur-3xl animate-pulse-slow"></div>
          <div
            className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-blue-400/20 to-pink-400/20 rounded-full blur-3xl animate-pulse-slow"
            style={{ animationDelay: "0.5s" }}
          ></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center py-20">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-emerald-100/50 to-blue-100/50 dark:from-emerald-900/30 dark:to-blue-900/30 text-emerald-800 dark:text-emerald-200 text-sm font-medium mb-8">
              <Brain className="w-4 h-4 mr-2" />
              AI-Powered Development Environment
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 dark:text-white mb-8">
              <span className="block">Runner Dev Tools</span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400">
                See Everything, Debug Anything
              </span>
            </h1>
            <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto mb-12 leading-relaxed">
              Complete introspection and debugging environment for Runner
              applications.
              <strong className="text-gray-900 dark:text-white">
                {" "}
                Monitor, debug, and develop
              </strong>{" "}
              with AI assistance, live telemetry, and revolutionary hot-swapping
              capabilities.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-6 justify-center mb-16">
              <a href="#installation" className="btn-primary group">
                <Download className="w-5 h-5 mr-2" />
                Get Started
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </a>
              <a href="#features" className="btn-secondary group">
                <Eye className="w-5 h-5 mr-2" />
                Explore Features
              </a>
              <a
                href="https://github.com/bluelibs/runner-dev"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary group"
              >
                <GitBranch className="w-5 h-5 mr-2" />
                View Source
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section id="features" className="py-32 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
              Complete Development Toolkit
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Everything you need to build, debug, and optimize Runner
              applications with AI assistance.
            </p>
          </div>

          {/* Feature Navigation */}
          <div className="flex flex-wrap justify-center gap-3 mb-16">
            {features.map((feature, index) => (
              <button
                key={feature.id}
                onClick={() => setSelectedFeature(index)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                  selectedFeature === index
                    ? `bg-gradient-to-r ${feature.gradient} text-white shadow-lg`
                    : "bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-white/20"
                }`}
              >
                <feature.icon className="w-4 h-4 inline mr-2" />
                {feature.title}
              </button>
            ))}
          </div>

          {/* Selected Feature Display */}
          <div className="card p-12">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-16 items-center">
              <div className="lg:col-span-2">
                <div className="flex items-center mb-6">
                  <div
                    className={`w-12 h-12 bg-gradient-to-r ${features[selectedFeature].gradient} rounded-lg flex items-center justify-center flex-shrink-0`}
                  >
                    {(() => {
                      const SelectedFeatureIcon =
                        features[selectedFeature].icon;

                      return (
                        <SelectedFeatureIcon className="w-6 h-6 text-white" />
                      );
                    })()}
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white ml-4">
                    {features[selectedFeature].title}
                  </h3>
                </div>
                <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
                  {features[selectedFeature].description}
                </p>
                <ul className="space-y-3">
                  {features[selectedFeature].details.map((detail, index) => (
                    <li key={index} className="flex items-start space-x-3">
                      <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-600 dark:text-gray-300">
                        {detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:col-span-3">
                <IntelligentZoomImage
                  src={features[selectedFeature].image}
                  alt={features[selectedFeature].title}
                  gradient={features[selectedFeature].gradient}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Installation Guide */}
      <section id="installation" className="py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
              Get Started in Seconds
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-8">
              Three simple steps to supercharge your Runner development
              experience.
            </p>
          </div>

          <div className="space-y-12">
            {installationSteps.map((step, index) => (
              <div key={index} className="card p-10">
                <div className="flex items-start space-x-6">
                  <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-lg">
                      {index + 1}
                    </span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                      {step.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300 mb-6">
                      {step.description}
                    </p>
                    <CodeBlock>{step.code}</CodeBlock>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Hot-Swapping Deep Dive */}
      <section className="py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
              🔥 Revolutionary Hot-Swapping
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto">
              Replace function logic in running applications without restarts.
              Perfect for production debugging, A/B testing, and AI-driven
              development workflows.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Live Function Replacement
              </h3>
              <div className="space-y-6">
                <div className="card p-6">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    Production Debugging
                  </h4>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Add logging, modify logic, or test fixes without downtime.
                    Debug live issues with surgical precision.
                  </p>
                </div>
                <div className="card p-6">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    AI-Driven Development
                  </h4>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Let AI assistants analyze, debug, and improve your code in
                    real-time. The ultimate development copilot.
                  </p>
                </div>
                <div className="card p-6">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    A/B Testing & Experimentation
                  </h4>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Compare implementations side-by-side. Test new algorithms
                    without deployment complexity.
                  </p>
                </div>
              </div>
            </div>
            <div className="card p-8">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                GraphQL Hot-Swap API
              </h3>
              <CodeBlock>
                {`mutation SwapTask($taskId: ID!, $runCode: String!) {
  swapTask(taskId: $taskId, runCode: $runCode) {
    success
    error
    taskId
  }
}

# Variables:
{
  "taskId": "user.create",
  "runCode": """
    async function run(input, deps) {
      // Add debug logging
      // Modify certain bits of code
      // Easily get the function value from Runner Documentation.
    }
  """
}`}
              </CodeBlock>
            </div>
          </div>
        </div>
      </section>

      {/* GraphQL Development Tools */}
      <section className="py-32 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
              <Database className="w-8 h-8 inline-block mr-2" />
              GraphQL Development Suite
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto">
              Complete GraphQL development experience with interactive tools for
              querying, exploring, and understanding your application's data
              graph.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-16">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">
                Professional GraphQL Tooling
              </h3>
              <div className="space-y-6">
                <div className="card p-6">
                  <div className="flex items-center mb-4">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                      <Play className="w-4 h-4 text-white" />
                    </div>
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white ml-3">
                      GraphQL Playground
                    </h4>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Interactive query editor with syntax highlighting,
                    auto-completion, and real-time query execution against your
                    running app.
                  </p>
                </div>
                <div className="card p-6">
                  <div className="flex items-center mb-4">
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                      <Eye className="w-4 h-4 text-white" />
                    </div>
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white ml-3">
                      Voyager Schema Explorer
                    </h4>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Beautiful visual schema exploration that maps your entire
                    GraphQL graph, showing relationships and dependencies in an
                    intuitive interface.
                  </p>
                </div>
                <div className="card p-6">
                  <div className="flex items-center mb-4">
                    <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
                      <Activity className="w-4 h-4 text-white" />
                    </div>
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white ml-3">
                      Real-time Introspection
                    </h4>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Live schema introspection that updates automatically as your
                    app changes, ensuring your development tools always reflect
                    the current state.
                  </p>
                </div>
              </div>
            </div>
            <div className="card p-8">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Example: Explore Your App Topology
              </h3>
              <CodeBlock>
                {`# Query all tasks with their dependencies
query TaskTopology {
  tasks {
    id
    filePath
    dependencies: dependsOnResolved {
      tasks { id }
      resources { id }
      hooks { id }
    }
    middleware: middlewareResolved {
      id
      config
    }
    emits
    emitsResolved {
      id
      listenedToByResolved {
        id
      }
    }
  }
}

# Or explore live telemetry
query LiveMetrics {
  live {
    logs(last: 10) {
      timestampMs
      level
      message
      correlationId
    }
    runs(last: 5) {
      nodeId
      durationMs
      executionTimeMs
    }
  }
}`}
              </CodeBlock>
            </div>
          </div>

          <div className="text-center">
            <RunnerDevUrlCards />
          </div>
        </div>
      </section>

      {/* CLI Tools */}
      <section className="py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
              <Terminal className="w-8 h-8 inline-block mr-2" />
              Powerful CLI Tools
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Comprehensive command-line interface for project scaffolding,
              querying, and development workflows.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {cliCommands.map((cmd, index) => (
              <div key={index} className="card p-8">
                <div className="flex items-start space-x-4">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Terminal className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <code className="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                      {cmd.command}
                    </code>
                    <p className="text-gray-600 dark:text-gray-300 text-sm mt-3">
                      {cmd.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link
              to="https://bluelibs.github.io/runner-dev"
              target="_blank"
              className="btn-secondary"
            >
              <FileText className="w-5 h-5 mr-2" />
              Full CLI Documentation
            </Link>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-32 bg-gradient-to-br from-blue-950/50 via-purple-950/30 to-pink-950/50 relative overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-emerald-400/20 to-teal-400/20 rounded-full blur-3xl animate-pulse-slow"></div>
          <div
            className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse-slow"
            style={{ animationDelay: "1s" }}
          ></div>
        </div>

        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-8">
            Ready to Transform Your Development?
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-12">
            Join developers already using Runner Dev Tools to build better
            applications faster with AI assistance.
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <a
              href="https://www.npmjs.com/package/@bluelibs/runner-dev"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-lg px-8 py-4"
            >
              <Download className="w-6 h-6 mr-2" />
              Install Now
            </a>
            <Link to="/playground" className="btn-secondary text-lg px-8 py-4">
              <Play className="w-6 h-6 mr-2" />
              Try Interactive Demo
            </Link>
          </div>
          <div className="mt-16">
            <RunnerDevUrlCards />
          </div>
        </div>
      </section>
    </div>
  );
};

export default RunnerDevPage;
