import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Github, Star } from "lucide-react";
import { formatStarCount, useGithubStars } from "../hooks/useGithubStars";

const LogoR: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="28"
    height="28"
    viewBox="0 0 512 512"
    preserveAspectRatio="xMidYMid meet"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Runner logo"
  >
    <defs>
      <linearGradient id="nav-g1" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="#7C3AED" />
        <stop offset="50%" stopColor="#2563EB" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
      <linearGradient id="nav-g2" x1="0" x2="1" y1="1" y2="0">
        <stop offset="0%" stopColor="#22D3EE" />
        <stop offset="100%" stopColor="#A78BFA" />
      </linearGradient>
    </defs>
    {/* Background tile, subtle to blend with navbar */}
    <rect
      x="48"
      y="48"
      width="416"
      height="416"
      rx="104"
      fill="#0B0B0F"
      opacity="0.9"
    />
    <rect
      x="48"
      y="48"
      width="416"
      height="416"
      rx="104"
      fill="url(#nav-g1)"
      opacity="0.10"
    />
    {/* Stylized R path (optically centered, no shadow) */}
    <g transform="translate(-20,-12)">
      <path
        d="M188 140h110c60 0 96 32 96 84 0 44-26 74-69 83l63 65c8 8 7 20-2 28-9 8-23 7-31-2l-85-92h-50v86c0 12-10 22-22 22s-22-10-22-22V162c0-12 10-22 22-22Zm110 122c34 0 52-14 52-38s-18-38-52-38h-88v76h88Z"
        fill="url(#nav-g2)"
      />
    </g>
    {/* Inner highlight */}
    <rect
      x="56"
      y="56"
      width="400"
      height="400"
      rx="96"
      fill="none"
      stroke="url(#nav-g2)"
      strokeOpacity="0.25"
      strokeWidth="2"
    />
  </svg>
);

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
    { name: "Quick Start", href: "/quick-start" },
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
          <div className="absolute inset-0 backdrop-blur-xl" />

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
                  <Link to="/" className="flex items-center space-x-2">
                    <LogoR className="w-8 h-8" />
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 dark:from-emerald-400 dark:via-teal-300 dark:to-sky-400">
                      Runner
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
