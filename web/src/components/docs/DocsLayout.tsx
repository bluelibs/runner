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
}) => {
  useEffect(() => {
    // Add smooth scrolling behavior
    const handleSmoothScroll = (e: Event) => {
      const rawTarget = e.target as HTMLElement | null;
      const anchor = rawTarget?.closest?.("a");
      const href = anchor?.getAttribute?.("href") || "";
      if (!anchor || !href.startsWith("#")) return;

      e.preventDefault();
      const id = href.slice(1);
      const element = document.getElementById(id);

      // Update the URL hash so back/forward and refresh work as expected
      if (id) {
        try {
          window.history.pushState(null, "", `#${id}`);
        } catch {
          // ignore history errors in older browsers or restricted contexts
        }
      }

      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        // Attempt to move focus for accessibility without jumping
        const focusable = element as HTMLElement;
        if (typeof focusable.focus === "function") {
          try {
            focusable.focus({ preventScroll: true } as unknown as FocusOptions);
          } catch {
            // fallback: simple focus
            focusable.focus();
          }
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
        <div className="text-center mb-16 rounded-2xl bg-gradient-to-b from-blue-50/50 via-transparent dark:from-blue-900/20 py-16">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold text-gray-900 dark:text-white mb-8 tracking-tighter">
            {title}
          </h1>
          <p className="text-lg text-gray-400 max-w-3xl mx-auto mb-6">
            {description}
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="https://bluelibs.github.io/runner/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-300 hover:text-white underline underline-offset-4"
            >
              API Reference
            </a>
            {/* <a
              href={editPath}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 hover:text-white underline underline-offset-4"
            >
              Edit this page on GitHub
            </a> */}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1 self-start sticky top-24">
            <DocsSidebar sections={sidebarSections} />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-12">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default DocsLayout;
