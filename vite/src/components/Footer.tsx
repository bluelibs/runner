import { Github, Heart, Zap } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-white/10 dark:bg-gray-900/50 backdrop-blur-lg border-t border-gray-200/20 dark:border-gray-700/20">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="text-xl font-bold gradient-text">BlueLibs Runner</span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mb-4">
              The TypeScript-first framework that embraces functional programming principles 
              while keeping dependency injection simple and your code readable.
            </p>
            <div className="flex items-center space-x-4">
              <a
                href="https://github.com/bluelibs/runner"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-800 text-white hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors duration-200"
              >
                <Github className="w-4 h-4" />
                <span className="text-sm font-medium">Star on GitHub</span>
              </a>
              <div className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
                <img 
                  src="https://img.shields.io/github/stars/bluelibs/runner?style=social" 
                  alt="GitHub Stars"
                  className="h-5"
                />
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-4">
              Documentation
            </h3>
            <ul className="space-y-3">
              <li>
                <a href="/quick-start" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200">
                  Quick Start
                </a>
              </li>
              <li>
                <a href="/docs" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200">
                  API Reference
                </a>
              </li>
              <li>
                <a href="/benchmarks" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200">
                  Benchmarks
                </a>
              </li>
              <li>
                <a href="/playground" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200">
                  Playground
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-4">
              Resources
            </h3>
            <ul className="space-y-3">
              <li>
                <a 
                  href="https://github.com/bluelibs/runner/tree/main/examples" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  Examples
                </a>
              </li>
              <li>
                <a 
                  href="https://bluelibs.github.io/runner/" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  TypeDocs
                </a>
              </li>
              <li>
                <a 
                  href="https://github.com/bluelibs/runner/blob/main/readmes/MIGRATION.md" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  Migration Guide
                </a>
              </li>
              <li>
                <a 
                  href="https://github.com/bluelibs/runner/issues" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  Issues
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-200/20 dark:border-gray-700/20">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400 mb-4 md:mb-0">
              <span>© 2025 BlueLibs Runner. Made with</span>
              <Heart className="w-4 h-4 text-red-500" fill="currentColor" />
              <span>and</span>
              <Zap className="w-4 h-4 text-yellow-500" />
              <span>by the BlueLibs team.</span>
            </div>
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                <span>Coverage:</span>
                <span className="bg-green-500 text-white px-2 py-1 rounded text-xs font-semibold">100%</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                <span>Build:</span>
                <span className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold">Passing</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;