import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Github, Star } from "lucide-react";
import { formatStarCount, useGithubStars } from "../hooks/useGithubStars";

interface NavbarProps {
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const Navbar: React.FC<NavbarProps> = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { count } = useGithubStars();

  const navigation = [
    { name: "Home", href: "/" },
    { name: "Start", href: "/quick-start" },
    { name: "Docs", href: "/docs" },
    { name: "Dev", href: "/runner-dev" },
    { name: "Bench", href: "/benchmarks" },
    { name: "Play", href: "/playground" },
  ];

  // Route module prefetchers (lazy import targets). Using dynamic imports allows
  // bundlers to prefetch/warm chunks even if routes are not lazily rendered yet.
  const prefetchers = useMemo(
    () =>
      ({
        "/": () => import("../pages/HomePage"),
        "/docs": () => import("../pages/DocsPage"),
        "/quick-start": () => import("../pages/QuickStartPage"),
        "/runner-dev": () => import("../pages/RunnerDevPage"),
        "/benchmarks": () => import("../pages/BenchmarksPage"),
        "/playground": () => import("../pages/PlaygroundPage"),
      } as Record<string, () => Promise<unknown>>),
    [],
  );

  const prefetchRoute = (path: string) => {
    const load = prefetchers[path];
    if (typeof load === "function") {
      // Fire and forget, ignore errors (already in main chunk, offline, etc.)
      try {
        load();
      } catch (e) {
        console.error(e);
        /* no-op */
      }
    }
  };

  // Idle prefetch: warm all non-active routes shortly after mount.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    const cancelIdle = window.cancelIdleCallback || ((id) => clearTimeout(id));
    const id = idle(() => {
      navigation
        .map((n) => n.href)
        .filter((p) => p !== location.pathname)
        .forEach((p) => prefetchRoute(p));
    });
    return () => cancelIdle(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      <nav className="fixed inset-x-0 top-0 z-50">
        {/* Main navbar with layered blur and shadow effects */}
        <div className="relative">
          {/* Background layer with gradient fade */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/90 via-white/70 to-white/30 dark:from-slate-950/90 dark:via-slate-950/70 dark:to-slate-950/30" />

          {/* Backdrop blur layer */}
          <div className="absolute inset-0 backdrop-blur-md" />

          {/* Content container */}
          <div className="nav-aware relative">
            {/* Subtle accent hairline */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent"
            />
            {/* Animated gradient overlay */}
            <div aria-hidden className="nav-animated-bg" />
            {/* Hover-aware blur boost */}
            <div aria-hidden className="nav-blur-boost" />
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <Link
                    to="/#"
                    className="flex items-center space-x-2 group"
                    onClick={(e) => {
                      if (location.pathname === "/") {
                        e.preventDefault();
                        e.stopPropagation();
                        window.scrollTo({ top: 0, behavior: "instant" });
                      }
                    }}
                  >
                    <img
                      src="/logo.png"
                      alt="Runner Logo"
                      className="w-8 h-8 transition-all duration-300 group-hover:scale-125 group-hover:rotate-12"
                    />
                    <span className="font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 dark:from-emerald-400 dark:via-teal-300 dark:to-sky-400">
                      runner
                    </span>
                  </Link>
                </div>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center space-x-8">
                  {navigation.map((item) => (
                    <Link
                      key={item.name}
                      to={item.href}
                      onMouseEnter={() => prefetchRoute(item.href)}
                      onFocus={() => prefetchRoute(item.href)}
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
                    {/* API Reference */}
                    <a
                      href="https://bluelibs.github.io/runner/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden lg:flex items-center space-x-2 px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all duration-300 backdrop-blur-sm"
                    >
                      <span className="text-sm font-medium">API Reference</span>
                    </a>
                    {/* GitHub Link */}
                    <a
                      href="https://github.com/bluelibs/runner"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all duration-300 backdrop-blur-sm"
                    >
                      <Github className="w-4 h-4" />
                      <span className="text-sm font-medium">GitHub</span>
                      <div className="flex items-center space-x-1">
                        <Star className="w-3 h-3" />
                        <span className="text-xs">
                          {formatStarCount(count)}
                        </span>
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
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden relative">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 backdrop-blur-xl border-t border-white/10 dark:border-white/5 bg-gradient-to-b from-white/80 to-white/40 dark:from-slate-950/70 dark:to-slate-950/30 nav-aware">
            <div aria-hidden className="nav-animated-bg" />
            <div aria-hidden className="nav-blur-boost" />
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsOpen(false)}
                onMouseEnter={() => prefetchRoute(item.href)}
                onFocus={() => prefetchRoute(item.href)}
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
              href="https://bluelibs.github.io/runner/"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 rounded-md text-base font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all duration-300"
            >
              API Reference
            </a>

            <a
              href="https://github.com/bluelibs/runner"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 px-3 py-2 rounded-md text-base font-medium bg-white/10 text-white hover:bg-white/20 transition-all duration-300 backdrop-blur-sm"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
