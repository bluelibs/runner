import { useState } from 'react';
import { 
  Book, 
  Code, 
  Database, 
  MessageSquare, 
  Settings, 
  Zap, 
  Shield, 
  Timer,
  Search,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

const DocsPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['core-concepts']));

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const documentation = [
    {
      id: 'core-concepts',
      title: 'Core Concepts',
      icon: Book,
      items: [
        { title: 'Tasks', href: '#tasks', description: 'Functions with superpowers - your business logic' },
        { title: 'Resources', href: '#resources', description: 'Singletons, services, and shared state' },
        { title: 'Events', href: '#events', description: 'Decoupled communication between components' },
        { title: 'Middleware', href: '#middleware', description: 'Cross-cutting concerns and lifecycle hooks' }
      ]
    },
    {
      id: 'advanced',
      title: 'Advanced Features',
      icon: Zap,
      items: [
        { title: 'Context', href: '#context', description: 'Request-scoped data without prop drilling' },
        { title: 'Interceptors', href: '#interceptors', description: 'Dynamic task behavior modification' },
        { title: 'Optional Dependencies', href: '#optional-deps', description: 'Graceful degradation patterns' },
        { title: 'Task Hooks', href: '#task-hooks', description: 'Lifecycle event handling' }
      ]
    },
    {
      id: 'enterprise',
      title: 'Enterprise Features',
      icon: Shield,
      items: [
        { title: 'Logging', href: '#logging', description: 'Structured logging with context' },
        { title: 'Caching', href: '#caching', description: 'Built-in LRU and custom cache providers' },
        { title: 'Retries', href: '#retries', description: 'Automatic retry with backoff strategies' },
        { title: 'Timeouts', href: '#timeouts', description: 'Operation timeout management' }
      ]
    },
    {
      id: 'performance',
      title: 'Performance',
      icon: Timer,
      items: [
        { title: 'Benchmarks', href: '#benchmarks', description: 'Real-world performance metrics' },
        { title: 'Optimization', href: '#optimization', description: 'Best practices for high performance' },
        { title: 'Monitoring', href: '#monitoring', description: 'Debug and performance monitoring' },
        { title: 'Memory Management', href: '#memory', description: 'Resource lifecycle and cleanup' }
      ]
    }
  ];

  const conceptExamples = {
    tasks: `const sendEmail = task({
  id: "app.tasks.sendEmail",
  dependencies: { emailService, logger },
  run: async ({ to, subject, body }, { emailService, logger }) => {
    await logger.info(\`Sending email to \${to}\`);
    return await emailService.send({ to, subject, body });
  },
});

// Test it like a normal function
const result = await sendEmail.run(
  { to: "user@example.com", subject: "Hi", body: "Hello!" },
  { emailService: mockEmailService, logger: mockLogger }
);`,
    resources: `const database = resource({
  id: "app.db",
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL);
    await client.connect();
    return client;
  },
  dispose: async (client) => await client.close(),
});

const userService = resource({
  id: "app.services.user",
  dependencies: { database },
  init: async (_, { database }) => ({
    async createUser(userData) {
      return database.collection("users").insertOne(userData);
    },
    async getUser(id) {
      return database.collection("users").findOne({ _id: id });
    },
  }),
});`,
    events: `const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
});

const registerUser = task({
  id: "app.tasks.registerUser",
  dependencies: { userService, userRegistered },
  run: async (userData, { userService, userRegistered }) => {
    const user = await userService.createUser(userData);
    
    // Tell the world about it
    await userRegistered({ userId: user.id, email: user.email });
    return user;
  },
});

// Listen with hooks
const sendWelcomeEmail = hook({
  id: "app.hooks.sendWelcomeEmail",
  on: userRegistered,
  run: async (eventData) => {
    console.log(\`Welcome email sent to \${eventData.data.email}\`);
  },
});`,
    middleware: `const authMiddleware = taskMiddleware({
  id: "app.middleware.auth",
  run: async ({ task, next }, _deps, config) => {
    // Auth logic here
    if (!task.input.user.authenticated) {
      throw new Error("Unauthorized");
    }
    return await next(task.input);
  },
});

const adminTask = task({
  id: "app.tasks.adminOnly", 
  middleware: [authMiddleware],
  run: async (input) => "Secret admin data",
});`
  };

  const filteredDocs = documentation.map(section => ({
    ...section,
    items: section.items.filter(item => 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(section => section.items.length > 0 || searchQuery === '');

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Documentation
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-8">
            Comprehensive guides and API reference for BlueLibs Runner. 
            Everything you need to build production-ready applications.
          </p>
          
          {/* Search */}
          <div className="max-w-md mx-auto relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search documentation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-lg bg-white/10 dark:bg-gray-800/50 border border-gray-200/20 dark:border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="card p-6 sticky top-24">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Table of Contents
              </h2>
              <div className="space-y-2">
                {filteredDocs.map((section) => (
                  <div key={section.id}>
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="flex items-center justify-between w-full text-left py-2 px-3 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors duration-200"
                    >
                      <div className="flex items-center space-x-2">
                        <section.icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {section.title}
                        </span>
                      </div>
                      {expandedSections.has(section.id) ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    {expandedSections.has(section.id) && (
                      <div className="ml-6 space-y-1">
                        {section.items.map((item) => (
                          <a
                            key={item.href}
                            href={item.href}
                            className="block py-1 px-3 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                          >
                            {item.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-12">
            {/* Core Concepts */}
            <section id="core-concepts" className="scroll-mt-24">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
                <Book className="w-8 h-8 mr-3" />
                Core Concepts
              </h2>
              
              {/* Tasks */}
              <div id="tasks" className="card p-8 mb-8 scroll-mt-24">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <Code className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Tasks</h3>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Tasks are functions with superpowers. They're pure-ish, testable, and composable. 
                  Unlike classes that accumulate methods like a hoarder accumulates stuff, tasks do one thing well.
                </p>
                <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto mb-6">
                  <pre className="text-green-400 text-sm">
                    <code>{conceptExamples.tasks}</code>
                  </pre>
                </div>
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">When to use tasks:</h4>
                  <ul className="space-y-2 text-gray-600 dark:text-gray-300">
                    <li>• High-level business actions: "app.user.register", "app.order.process"</li>
                    <li>• Operations that need middleware (auth, caching, retry)</li>
                    <li>• Functions called from multiple places</li>
                    <li>• Complex operations that benefit from dependency injection</li>
                  </ul>
                </div>
              </div>

              {/* Resources */}
              <div id="resources" className="card p-8 mb-8 scroll-mt-24">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <Database className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Resources</h3>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Resources are the singletons, services, configs, and connections that live throughout your app's lifecycle. 
                  They initialize once and stick around until cleanup time.
                </p>
                <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto mb-6">
                  <pre className="text-green-400 text-sm">
                    <code>{conceptExamples.resources}</code>
                  </pre>
                </div>
              </div>

              {/* Events */}
              <div id="events" className="card p-8 mb-8 scroll-mt-24">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h3>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Events let different parts of your app talk to each other without tight coupling. 
                  It's like having a really good office messenger who never forgets anything.
                </p>
                <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto mb-6">
                  <pre className="text-green-400 text-sm">
                    <code>{conceptExamples.events}</code>
                  </pre>
                </div>
              </div>

              {/* Middleware */}
              <div id="middleware" className="card p-8 scroll-mt-24">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
                    <Settings className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Middleware</h3>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Middleware wraps around your tasks and resources, adding cross-cutting concerns 
                  without polluting your business logic.
                </p>
                <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-green-400 text-sm">
                    <code>{conceptExamples.middleware}</code>
                  </pre>
                </div>
              </div>
            </section>

            {/* Quick Reference */}
            <section className="card p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Quick Reference
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    Essential Imports
                  </h3>
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                    <code className="text-sm text-gray-800 dark:text-gray-200">
                      import &#123; resource, task, event, hook, run &#125; from "@bluelibs/runner";
                    </code>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    Run Options
                  </h3>
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                    <code className="text-sm text-gray-800 dark:text-gray-200">
                      run(app, &#123; debug: "verbose", shutdownHooks: true &#125;)
                    </code>
                  </div>
                </div>
              </div>
            </section>

            {/* External Links */}
            <section className="card p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Additional Resources
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <a
                  href="https://bluelibs.github.io/runner/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 border border-gray-200/20 dark:border-gray-700/50 rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">TypeDocs</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Complete API reference with TypeScript definitions
                  </p>
                </a>
                <a
                  href="https://github.com/bluelibs/runner/tree/main/examples"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 border border-gray-200/20 dark:border-gray-700/50 rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Examples</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Real-world examples and starter templates
                  </p>
                </a>
                <a
                  href="https://github.com/bluelibs/runner/blob/main/AI.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 border border-gray-200/20 dark:border-gray-700/50 rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">AI-Friendly Docs</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Condensed documentation for AI assistance
                  </p>
                </a>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocsPage;