import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import DocsPage from "./pages/DocsPage";
import QuickStartPage from "./pages/QuickStartPage";
import RunnerDevPage from "./pages/RunnerDevPage";
import BenchmarksPage from "./pages/BenchmarksPage";
import PlaygroundPage from "./pages/PlaygroundPage";
import Footer from "./components/Footer";
import ScrollToTop from "./components/ScrollToTop";
import NotFoundPage from "./pages/NotFoundPage";
import { ConsentProvider } from "./contexts/ConsentContext";
import ConsentBanner from "./components/ConsentBanner";

// Type declaration for gtag
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function App() {
  useEffect(() => {
    // Force dark mode always - no exceptions
    document.documentElement.classList.add("dark");
    localStorage.setItem("theme", "dark");
  }, []);

  const handleConsentChange = (hasConsent: boolean) => {
    // Update gtag consent when user makes a choice
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("consent", "update", {
        analytics_storage: hasConsent ? "granted" : "denied",
      });
    }
  };

  return (
    <ConsentProvider>
      <Router>
        <div className="min-h-screen bg-white dark:bg-black dark">
          <ScrollToTop />
          <Navbar darkMode={true} toggleDarkMode={() => {}} />
          <main id="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/quick-start" element={<QuickStartPage />} />
              <Route path="/runner-dev" element={<RunnerDevPage />} />
              <Route path="/benchmarks" element={<BenchmarksPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          <Footer />
          <ConsentBanner onConsentChange={handleConsentChange} />
        </div>
      </Router>
    </ConsentProvider>
  );
}

export default App;
