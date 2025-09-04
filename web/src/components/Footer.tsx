import { Github, ExternalLink, CheckCircle, Star } from "lucide-react";
import { formatStarCount, useGithubStars } from "../hooks/useGithubStars";

const Footer: React.FC = () => {
  const { count } = useGithubStars();
  return (
    <footer className="relative overflow-hidden bg-black/80 backdrop-blur-sm border-t border-gray-800/50 dark:bg-gradient-to-b dark:from-violet-950/60 dark:via-black/70 dark:to-black">
      {/* Dark mode gradient glow background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 hidden dark:block"
      >
        {/* Top-right glow */}
        <div className="absolute -top-28 -right-24 h-[34rem] w-[34rem] rounded-full bg-gradient-to-br from-fuchsia-500/25 via-indigo-500/15 to-cyan-500/25 blur-3xl" />
        {/* Bottom-left glow */}
        <div className="absolute -bottom-28 -left-24 h-[30rem] w-[30rem] rounded-full bg-gradient-to-tr from-emerald-400/20 via-sky-500/10 to-purple-500/20 blur-3xl" />
        {/* Subtle horizon line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 sm:gap-12 mb-12 sm:mb-16">
          {/* Brand */}
          <div className="col-span-1 sm:col-span-2 lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              {/* <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                <span className="text-black font-semibold text-sm">R</span>
              </div> */}
              <span className="text-2xl font-semibold text-white">Runner</span>
            </div>
            <p className="text-gray-400 max-w-sm mb-8 leading-relaxed">
              TypeScript-first framework for functional programming with simple
              dependency injection.
            </p>
            <div className="flex flex-col space-y-4">
              <a
                href="https://github.com/bluelibs/runner"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-white text-black hover:bg-gray-100 transition-colors duration-200 w-fit text-sm font-medium"
              >
                <Github className="w-4 h-4" />
                <span>Star on GitHub</span>
              </a>
              <div className="flex items-center space-x-2 text-sm text-gray-400">
                <Star className="w-4 h-4" />
                <span>{formatStarCount(count)} stars</span>
              </div>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-sm font-medium text-white mb-6">Product</h3>
            <ul className="space-y-4">
              <li>
                <a
                  href="/quick-start"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  Quick Start
                </a>
              </li>
              <li>
                <a
                  href="/docs"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  Documentation
                </a>
              </li>
              <li>
                <a
                  href="/benchmarks"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  Benchmarks
                </a>
              </li>
              <li>
                <a
                  href="/playground"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  Playground
                </a>
              </li>
              <li>
                <a
                  href="/runner-dev"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  Dev Tools
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-sm font-medium text-white mb-6">Resources</h3>
            <ul className="space-y-4">
              <li>
                <a
                  href="https://github.com/bluelibs/runner/tree/main/examples"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>Examples</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://bluelibs.github.io/runner/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>API Reference</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/bluelibs/runner/blob/main/AI.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>AI Docs</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/bluelibs/runner/blob/main/readmes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>Runner Lore</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/bluelibs/runner-dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>Runner Dev Tools</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://chatgpt.com/g/g-68b756abec648191aa43eaa1ea7a7945-runner?model=gpt-5-thinking"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>OpenAI Chatbot</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Company */}
          {/* <div>
            <h3 className="text-sm font-medium text-white mb-6">
              Company
            </h3>
            <ul className="space-y-4">
              <li>
                <a href="/about" className="text-gray-400 hover:text-white transition-colors duration-200">
                  About
                </a>
              </li>
              <li>
                <a href="/careers" className="text-gray-400 hover:text-white transition-colors duration-200">
                  Careers
                </a>
              </li>
              <li>
                <a href="/privacy" className="text-gray-400 hover:text-white transition-colors duration-200">
                  Privacy
                </a>
              </li>
              <li>
                <a href="/terms" className="text-gray-400 hover:text-white transition-colors duration-200">
                  Terms
                </a>
              </li>
            </ul>
          </div> */}

          {/* Community */}
          <div>
            <h3 className="text-sm font-medium text-white mb-6">Community</h3>
            <ul className="space-y-4">
              <li>
                <a
                  href="https://github.com/bluelibs/runner/discussions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>Discussions</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/bluelibs/runner/discussions/new/choose"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>Ask a Question</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/bluelibs/runner/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors duration-200 flex items-center space-x-1"
                >
                  <span>Issues</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="mailto:theodor@bluelibs.com"
                  className="text-gray-400 hover:text-white transition-colors duration-200"
                >
                  <span>Business Inquiries</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Newsletter Signup */}
        {/* <div className="bg-gray-900/50 rounded-2xl p-8 mb-12">
          <div className="max-w-md">
            <h3 className="text-lg font-medium text-white mb-2">
              Stay updated
            </h3>
            <p className="text-gray-400 mb-6 text-sm">
              Get the latest updates on new features and releases.
            </p>
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
              <input
                type="email"
                placeholder="Enter your email"
                className="flex-1 bg-black/40 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-colors"
              />
              <button className="bg-white text-black px-6 py-2.5 rounded-lg font-medium hover:bg-gray-100 transition-colors duration-200 flex items-center justify-center space-x-2 w-full sm:w-auto">
                <Mail className="w-4 h-4" />
                <span>Subscribe</span>
              </button>
            </div>
          </div>
        </div> */}

        {/* Bottom Section */}
        <div className="border-t border-gray-800/60 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center space-y-6 md:space-y-0">
            <div className="flex flex-col space-y-2">
              <span className="text-gray-400 text-sm">
                © 2025 Runner. All rights reserved.
              </span>
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm text-gray-400">
                  All systems operational
                </span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-8">
              <div className="flex items-center space-x-2 text-sm text-gray-400">
                <span>Tests:</span>
                <span className="bg-gray-800 text-gray-300 px-2.5 py-1 rounded-md text-xs font-medium">
                  Passing
                </span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-400">
                <span>Coverage:</span>
                <span className="bg-gray-800 text-gray-300 px-2.5 py-1 rounded-md text-xs font-medium">
                  100%
                </span>
              </div>
              {/* <div className="flex items-center space-x-2 text-sm text-gray-400">
                <span>Uptime:</span>
                <span className="bg-gray-800 text-gray-300 px-2.5 py-1 rounded-md text-xs font-medium">
                  99.9%
                </span>
              </div> */}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
