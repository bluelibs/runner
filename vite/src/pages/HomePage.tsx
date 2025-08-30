import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowRight, 
  Zap, 
  Shield, 
  Code, 
  Gauge, 
  Users, 
  Check,
  Play,
  GitBranch,
  Database,
  MessageSquare,
  Settings,
  Star,
  TrendingUp,
  Timer,
  Award
} from 'lucide-react';

const HomePage: React.FC = () => {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  const features = [
    {
      icon: Code,
      title: 'Tasks are Functions',
      description: 'Not classes with 47 methods you swear you\'ll refactor. Pure, testable, composable functions with superpowers.',
      example: `const sendEmail = task({
  id: "app.tasks.sendEmail",
  dependencies: { emailService },
  run: async ({ to, subject, body }) => {
    return await emailService.send({ to, subject, body });
  }
});`
    },
    {
      icon: Database,
      title: 'Resources are Singletons',
      description: 'Database connections, configs, services - the usual suspects. Initialize once, use everywhere.',
      example: `const database = resource({
  id: "app.db",
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL);
    await client.connect();
    return client;
  },
  dispose: async (client) => await client.close()
});`
    },
    {
      icon: MessageSquare,
      title: 'Events are Just Events',
      description: 'Revolutionary concept, we know. Loose coupling without the tight coupling headaches.',
      example: `const userRegistered = event<{ userId: string }>({
  id: "app.events.userRegistered"
});

// Emit events
await userRegistered({ userId: "123" });`
    },
    {
      icon: Settings,
      title: 'Middleware with Power',
      description: 'Cross-cutting concerns with full lifecycle interception. Like onions, but useful.',
      example: `const authMiddleware = taskMiddleware({
  id: "app.middleware.auth",
  run: async ({ task, next }) => {
    // Auth logic here
    return await next(task.input);
  }
});`
    }
  ];

  const benchmarks = [
    { label: 'Basic Task Execution', value: '2.2M tasks/sec', color: 'from-green-400 to-blue-500' },
    { label: 'With 5 Middlewares', value: '244K tasks/sec', color: 'from-blue-400 to-purple-500' },
    { label: 'Event Handling', value: '246K events/sec', color: 'from-purple-400 to-pink-500' },
    { label: 'Resource Init', value: '59.7K resources/sec', color: 'from-pink-400 to-red-500' }
  ];

  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center relative overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-pink-50/50 dark:from-blue-950/50 dark:via-purple-950/30 dark:to-pink-950/50"></div>
        
        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse-slow"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-purple-400/20 to-pink-400/20 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }}></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center">
            <div className="mb-8">
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-4">
                <Star className="w-4 h-4 mr-2" />
                TypeScript-First Framework
              </div>
              <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-white mb-6">
                <span className="block">Stop Worrying and</span>
                <span className="gradient-text">Love Dependency Injection</span>
              </h1>
              <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto mb-8 leading-relaxed">
                BlueLibs Runner is the anti-framework framework. It gets out of your way and lets you build stuff that actually works. 
                <strong className="text-gray-900 dark:text-white"> No magic, no surprises</strong>, just elegant code.
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Link to="/quick-start" className="btn-primary group">
                Get Started
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link to="/playground" className="btn-secondary group">
                <Play className="w-5 h-5 mr-2" />
                Try Playground
              </Link>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">2.2M</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Tasks/sec</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">100%</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Test Coverage</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">0ms</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Magic Overhead</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-pink-600 dark:text-pink-400">1.2k</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">GitHub Stars</div>
              </div>
            </div>

            {/* Code Preview */}
            <div className="max-w-4xl mx-auto">
              <div className="card p-6">
                <div className="text-left">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Quick Example</h3>
                    <div className="flex space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                  </div>
                  <pre className="code-block text-sm">
{`import { resource, task, run } from "@bluelibs/runner";

const server = resource({
  id: "app.server",
  init: async ({ port }: { port: number }) => {
    const app = express();
    return app.listen(port);
  }
});

const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { server },
  run: async (userData, { server }) => {
    // Your business logic here
    return { id: "user-123", ...userData };
  }
});

// That's it. Clean, simple, testable.
const { dispose } = await run(app);`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              The Big Four
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Understanding these four concepts is key to using Runner effectively. 
              They're not just buzzwords – they're the building blocks of maintainable applications.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className={`card p-8 cursor-pointer transition-all duration-300 ${
                  hoveredFeature === index ? 'scale-105 shadow-2xl' : ''
                }`}
                onMouseEnter={() => setHoveredFeature(index)}
                onMouseLeave={() => setHoveredFeature(null)}
              >
                <div className="flex items-start space-x-4 mb-6">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      {feature.description}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-green-400 text-sm font-mono">
                    <code>{feature.example}</code>
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Performance Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              <Gauge className="w-8 h-8 inline-block mr-2" />
              Built for Performance
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Real benchmarks from our comprehensive test suite. These aren't marketing numbers – 
              they're what you'll actually see in production.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {benchmarks.map((benchmark, index) => (
              <div key={index} className="card p-6 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r ${benchmark.color} flex items-center justify-center`}>
                  <TrendingUp className="w-8 h-8 text-white" />
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {benchmark.value}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {benchmark.label}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link to="/benchmarks" className="btn-primary">
              <Timer className="w-5 h-5 mr-2" />
              See All Benchmarks
            </Link>
          </div>
        </div>
      </section>

      {/* Why Choose Section */}
      <section className="py-24 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-8">
                Why Choose BlueLibs Runner?
              </h2>
              <div className="space-y-6">
                {[
                  'No magic, no surprises - explicit beats implicit',
                  'TypeScript-first with zero compromise on type safety',
                  'High performance - 2.2M+ tasks per second',
                  'Enterprise ready with graceful shutdown, error boundaries',
                  'Comprehensive logging, caching, and retry mechanisms',
                  'Functional programming with simple dependency injection',
                  '100% test coverage - because quality matters'
                ].map((feature, index) => (
                  <div key={index} className="flex items-start space-x-3">
                    <Check className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-600 dark:text-gray-300">{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link to="/docs" className="btn-primary">
                  Read the Docs
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              </div>
            </div>
            <div className="card p-8">
              <div className="text-gray-500 dark:text-gray-400 text-sm mb-4">What developers are saying:</div>
              <blockquote className="text-lg text-gray-900 dark:text-white mb-4">
                "Finally, a framework that doesn't make me question my life choices at 3am. 
                Runner gets out of my way and lets me build actual features."
              </blockquote>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gray-300 rounded-full"></div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">Alex Chen</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Senior Developer</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Ready to Stop Worrying?
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
            Join thousands of developers who've already made the switch to cleaner, 
            more maintainable TypeScript applications.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/quick-start" className="btn-primary text-lg px-8 py-4">
              <Zap className="w-6 h-6 mr-2" />
              Get Started Now
            </Link>
            <a 
              href="https://github.com/bluelibs/runner" 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn-secondary text-lg px-8 py-4"
            >
              <GitBranch className="w-6 h-6 mr-2" />
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;