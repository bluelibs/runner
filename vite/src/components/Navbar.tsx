import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Github, Star } from "lucide-react";
import Search from "./../components/Search";

interface NavbarProps {
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const Navbar: React.FC<NavbarProps> = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  const navigation = [
    { name: "Home", href: "/" },
    { name: "Quick Start", href: "/quick-start" },
    { name: "Docs", href: "/docs" },
    { name: "Benchmarks", href: "/benchmarks" },
    { name: "Playground", href: "/playground" },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav
      className="fixed w-full z-50 backdrop-blur-lg border-b"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border-color)",
      }}
    >
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-white text-black px-3 py-2 rounded">Skip to content</a>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "var(--accent-color)" }}
              >
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="text-xl font-bold gradient-text">Runner</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 relative ${
                  isActive(item.href)
                    ? "text-white bg-gradient-to-r from-emerald-500/20 to-emerald-400/20 shadow-lg shadow-emerald-500/10"
                    : "text-gray-300 hover:text-white hover:bg-white/8 hover:shadow-md"
                }`}
              >
                {item.name}
              </Link>
            ))}

            <div className="flex items-center space-x-3">
              <Search />
              {/* GitHub Link */}
              <a
                href="https://github.com/bluelibs/runner"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all duration-300"
              >
                <Github className="w-4 h-4" />
                <span className="text-sm font-medium">GitHub</span>
                <div className="flex items-center space-x-1">
                  <Star className="w-3 h-3" />
                  <span className="text-xs">48</span>
                </div>
              </a>
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-all duration-300"
              aria-expanded="false"
            >
              {isOpen ? (
                <X className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden">
          <div
            className="px-2 pt-2 pb-3 space-y-1 sm:px-3 backdrop-blur-lg border-t"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border-color)",
            }}
          >
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsOpen(false)}
                className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-300 ${
                  isActive(item.href)
                    ? "text-white bg-gradient-to-r from-emerald-500/20 to-emerald-400/20 shadow-lg shadow-emerald-500/10"
                    : "text-gray-300 hover:text-white hover:bg-white/8"
                }`}
              >
                {item.name}
              </Link>
            ))}

            <a
              href="https://github.com/bluelibs/runner"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 px-3 py-2 rounded-md text-base font-medium bg-white/10 text-white hover:bg-white/20 transition-all duration-300"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
