import { Server, Globe, Zap } from "lucide-react";

const platforms = [
  {
    name: "Node.js",
    icon: Server,
    description: "Server-side applications, APIs, and microservices",
    color: "from-green-500 to-emerald-600"
  },
  {
    name: "Browser",
    icon: Globe,
    description: "Client-side web applications and SPAs",
    color: "from-blue-500 to-cyan-600"
  },
  {
    name: "Edge/Universal",
    icon: Zap,
    description: "Edge functions, serverless, and universal runtime",
    color: "from-purple-500 to-violet-600"
  }
];

const PlatformsSection: React.FC = () => {
  return (
    <section className="py-16 bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Works Everywhere
          </h3>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            One framework, every platform
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {platforms.map((platform, index) => (
            <div
              key={index}
              className="group card p-6 text-center hover:scale-105 transition-all duration-300 cursor-default"
            >
              <div className={`w-16 h-16 bg-gradient-to-r ${platform.color} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:shadow-lg transition-all duration-300`}>
                <platform.icon className="w-8 h-8 text-white" />
              </div>
              <h4 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                {platform.name}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {platform.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PlatformsSection;