import { Link } from "react-router-dom";
import { ArrowRight, Play } from "lucide-react";
import CodeBlock from "../CodeBlock";

const HeroSection: React.FC = () => {
  return (
    <section className="min-h-[90vh] sm:min-h-screen flex items-center justify-center relative">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-pink-50/50 dark:from-blue-950/50 dark:via-purple-950/30 dark:to-pink-950/50"></div>

      {/* Full screen gradient swipe animation */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-400/30 via-purple-400/20 to-pink-400/30 animate-gradient-swipe"></div>
      </div>

      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse-slow animate-fade-in-right"></div>
        <div
          className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-purple-400/20 to-pink-400/20 rounded-full blur-3xl animate-pulse-slow animate-fade-in-left"
          style={{ animationDelay: "0.5s" }}
        ></div>
      </div>

      <div className="max-w-7xl mx-auto px-12 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center py-20 sm:py-28">
          <div className="mb-12 sm:mb-16">
            <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-white mb-10 sm:mb-12 px-4 sm:px-0">
              <span className="block">Stop Worrying and</span>
              <span className="">Love Dependency Injection</span>
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto mb-12 sm:mb-16 leading-relaxed px-4 sm:px-0">
              Runner is the anti-framework framework. It gets out of your way
              and lets you build stuff that actually works.
              <strong className="text-gray-900 dark:text-white">
                {" "}
                No magic, no surprises
              </strong>
              , just elegant code.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-6 justify-center mb-16 sm:mb-24">
            <Link to="/quick-start" className="btn-primary group">
              Get Started
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/playground" className="btn-secondary group">
              <Play className="w-5 h-5 mr-2" />
              Try Playground
            </Link>
            <a
              href="https://bluelibs.github.io/runner/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary group"
            >
              API Reference
            </a>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-12 mb-20 sm:mb-28">
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">
                2.49M
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Tasks/sec
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">
                100%
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Test Coverage
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">
                0ms
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Magic Overhead
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-pink-600 dark:text-pink-400">
                Simple
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Dependency Injection
              </div>
            </div>
          </div>

          {/* Code Preview */}
          <div className="max-w-4xl mx-auto">
            <div className="card p-4 sm:p-6">
              <div className="text-left">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Quick Example
                  </h3>
                  <div className="flex space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  </div>
                </div>
                <CodeBlock>
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
const { dispose, value } = await run(server);`}
                </CodeBlock>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;