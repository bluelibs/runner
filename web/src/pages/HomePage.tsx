import { useEffect } from "react";
import Meta from "../components/Meta";
import HeroSection from "../components/HomePage/HeroSection";
import FeaturesSection from "../components/HomePage/FeaturesSection";
import BenchmarksSection from "../components/HomePage/BenchmarksSection";
import RunnerDevToolsSection from "../components/HomePage/RunnerDevToolsSection";
import TldrSection from "../components/HomePage/TldrSection";
import WhyChooseSection from "../components/HomePage/WhyChooseSection";
import PlatformsSection from "../components/HomePage/PlatformsSection";
import CtaSection from "../components/HomePage/CtaSection";
import BusinessInquirySection from "../components/HomePage/BusinessInquirySection";
import { useLocation } from "react-router-dom";

const HomePage: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const handleHashNavigation = () => {
      const hash = window.location.hash.substring(1);
      if (hash) {
        setTimeout(() => {
          const element = document.getElementById(hash);
          if (element) {
            element.scrollIntoView({ behavior: "instant", block: "start" });
          }
        }, 100);
      }
    };

    // Handle initial hash on page load
    handleHashNavigation();

    // Handle hash changes
    window.addEventListener("hashchange", handleHashNavigation);

    return () => {
      window.removeEventListener("hashchange", handleHashNavigation);
    };
  }, [location.pathname]);
  return (
    <div className="pt-16">
      <Meta
        title="Runner — TypeScript-first DI framework: fast, explicit, testable"
        description="Build production-ready TypeScript apps with tasks, resources, events, and middleware. No magic, full type-safety, 2.49M+ tasks/sec."
        image="/og/runner-og.svg"
      />
      <HeroSection />
      <PlatformsSection />
      <FeaturesSection />
      <BenchmarksSection />
      <RunnerDevToolsSection />
      <TldrSection />
      <WhyChooseSection />
      <CtaSection />
      <BusinessInquirySection />
    </div>
  );
};

export default HomePage;
