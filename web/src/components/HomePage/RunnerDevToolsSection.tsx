import { Link } from "react-router-dom";
import {
  Brain,
  Gauge,
  Zap,
  Settings,
  ArrowRight,
  GitBranch,
} from "lucide-react";
import { devToolsFeatures } from "../../constants/homePage";

const RunnerDevToolsSection: React.FC = () => {
  return (
    <section className="py-32 bg-white/50 dark:bg-gray-900/50 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-purple-50/20 to-pink-50/30 dark:from-blue-950/30 dark:via-purple-950/20 dark:to-pink-950/30"></div>

      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-purple-400/10 to-blue-400/10 rounded-full blur-3xl animate-pulse-slow"></div>
        <div
          className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-blue-400/10 to-pink-400/10 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: "1s" }}
        ></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-20">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-emerald-100/50 to-blue-100/50 dark:from-emerald-900/30 dark:to-blue-900/30 text-emerald-800 dark:text-emerald-200 text-sm font-medium mb-6">
            <Brain className="w-4 h-4 mr-2" />
            AI-Powered Development Tools
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
            Runner Dev Tools
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto mb-12">
            Introspection, live telemetry, and AI-powered debugging for your
            Runner apps. See your application's topology, monitor performance in
            real-time, and debug with AI assistance.
          </p>
        </div>

        {/* Features Grid with Images */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-16">
          {/* AI Assistant Feature */}
          <div className="card p-8 group hover:scale-105 transition-all duration-500">
            <div className="relative overflow-hidden rounded-lg mb-6">
              <img
                src="/runner-dev/ai-assistant-embedded-in-your-app.png"
                alt="AI Assistant embedded in your app"
                className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            </div>
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white ml-3">
                AI Assistant Integration
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Built-in MCP server lets AI assistants introspect your app, run
              tasks, debug issues, and even hot-swap functions for live
              debugging.
            </p>
          </div>

          {/* Live Telemetry Feature */}
          <div className="card p-8 group hover:scale-105 transition-all duration-500">
            <div className="relative overflow-hidden rounded-lg mb-6">
              <img
                src="/runner-dev/gain-granular-insights.png"
                alt="Gain granular insights"
                className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            </div>
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Gauge className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white ml-3">
                Live Telemetry
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Real-time logs, events, performance metrics, and system health.
              Monitor your app's behavior with granular insights and correlation
              tracking.
            </p>
          </div>

          {/* Hot Swapping Feature */}
          <div className="card p-8 group hover:scale-105 transition-all duration-500">
            <div className="relative overflow-hidden rounded-lg mb-6">
              <img
                src="/runner-dev/run-tasks-or-emit-events.png"
                alt="Run tasks or emit events"
                className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            </div>
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white ml-3">
                Hot-Swapping Debug
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Replace task functions live without restarting. Perfect for
              production debugging, A/B testing, and AI-driven development
              workflows.
            </p>
          </div>
        </div>

        {/* Additional Features Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          <div className="card p-6">
            <div className="flex items-start space-x-4">
              <div className="relative overflow-hidden rounded-lg w-24 h-24 flex-shrink-0">
                <img
                  src="/runner-dev/your-app-at-one-glance.png"
                  alt="Your app at one glance"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Complete App Topology
                </h4>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  Visualize tasks, resources, events, and their dependencies
                  with an interactive GraphQL API.
                </p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-start space-x-4">
              <div className="relative overflow-hidden rounded-lg w-24 h-24 flex-shrink-0">
                <img
                  src="/runner-dev/preview-and-edit-files-in-place.png"
                  alt="Preview and edit files in place"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Live File Preview & Edit
                </h4>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  Browse and edit your source files directly from the dev
                  interface with real-time updates.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Key Features List */}
        <div className="card p-10 mb-16">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-8 text-center">
            Everything You Need for Modern Development
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {devToolsFeatures.map((feature, index) => (
              <div key={index} className="flex items-center space-x-3">
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Call to Action */}
        <div className="text-center">
          <div className="inline-flex flex-col sm:flex-row gap-4">
            <Link to="/runner-dev" className="btn-primary group">
              <Settings className="w-5 h-5 mr-2" />
              Explore Runner Dev Tools
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>
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
          <div className="mt-8">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Try it now:{" "}
              <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-emerald-600 dark:text-emerald-400">
                npm install -g @bluelibs/runner-dev
              </code>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RunnerDevToolsSection;
