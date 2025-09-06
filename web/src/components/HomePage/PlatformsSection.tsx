import { Server, Globe, Zap, Heart, Brain, Shield } from "lucide-react";

const platforms = [
  {
    name: "Node.js",
    icon: Server,
    description: "Server-side applications, APIs, and microservices",
    color: "from-green-500 to-emerald-600",
  },
  {
    name: "Browser",
    icon: Globe,
    description: "Client-side web applications and SPAs",
    color: "from-blue-500 to-cyan-600",
  },
  {
    name: "Edge/Universal",
    icon: Zap,
    description: "Edge functions, serverless, and universal runtime",
    color: "from-purple-500 to-violet-600",
  },
];

const PlatformsSection: React.FC = () => {
  return (
    <section className="py-20 bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          {/* Works Everywhere Section */}
          <div className="text-center">
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
              Works Everywhere
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-10">
              One framework, every platform
            </p>

            <div className="grid grid-cols-3 gap-6">
              {platforms.map((platform, index) => (
                <div key={index} className="flex flex-col items-center group">
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors duration-200">
                    <platform.icon className="w-7 h-7 text-gray-600 dark:text-gray-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {platform.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Designed for Humans and AI Section */}
          <div className="text-center">
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
              For Humans and AI
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-10">
              Built with both in mind
            </p>

            <div className="grid grid-cols-3 gap-6">
              <div className="flex flex-col items-center group">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors duration-200">
                  <Heart className="w-7 h-7 text-gray-600 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Human-Friendly
                </span>
              </div>

              <div className="flex flex-col items-center group">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors duration-200">
                  <Brain className="w-7 h-7 text-gray-600 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  AI-Ready
                </span>
              </div>

              <div className="flex flex-col items-center group">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors duration-200">
                  <Shield className="w-7 h-7 text-gray-600 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Type-Safe
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlatformsSection;
