import { useEffect } from "react";
import type { ReactNode } from "react";
import DocsSidebar from "./DocsSidebar";
import { allDocSections } from "../../data/documentation";

interface DocsLayoutProps {
  children: ReactNode;
  title: string;
  description: string;
  sidebarSections?: typeof allDocSections;
  editPath?: string; // GitHub edit link
}

const DocsLayout: React.FC<DocsLayoutProps> = ({
  children,
  title,
  description,
  sidebarSections = allDocSections,
  editPath = "https://github.com/bluelibs/runner/blob/main/vite/src/pages/DocsPage.tsx",
}) => {
  useEffect(() => {
    // Add smooth scrolling behavior
    const handleSmoothScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "A" &&
        target.getAttribute("href")?.startsWith("#")
      ) {
        e.preventDefault();
        const id = target.getAttribute("href")?.slice(1);
        const element = document.getElementById(id!);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    };

    document.addEventListener("click", handleSmoothScroll);
    return () => document.removeEventListener("click", handleSmoothScroll);
  }, []);

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {title}
          </h1>
          <p className="text-lg text-gray-400 max-w-3xl mx-auto mb-6">{description}</p>
          <div className="flex justify-center">
            <a
              href={editPath}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 hover:text-white underline underline-offset-4"
            >
              Edit this page on GitHub
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1 self-start sticky top-24">
            <DocsSidebar sections={sidebarSections} />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-12">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocsLayout;
