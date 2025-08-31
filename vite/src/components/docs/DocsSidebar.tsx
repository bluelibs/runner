import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { DocSection } from "../../data/documentation";

interface DocsSidebarProps {
  sections: DocSection[];
  defaultExpanded?: string[];
}

const DocsSidebar: React.FC<DocsSidebarProps> = ({
  sections,
  defaultExpanded = ["core-concepts"],
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(defaultExpanded),
  );

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  return (
    <div className="card p-6 max-h-[calc(100vh-10rem)] overflow-y-auto fine-scrollbar">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Table of Contents
      </h2>
      <div className="space-y-2">
        {sections.map((section) => (
          <div key={section.id}>
            <button
              onClick={() => toggleSection(section.id)}
              className="flex items-center justify-between w-full text-left py-2 px-3 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors duration-200"
            >
              <div className="flex items-center space-x-2">
                <section.icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {section.title}
                </span>
              </div>
              {expandedSections.has(section.id) ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>
            {expandedSections.has(section.id) && (
              <div className="ml-6 space-y-1">
                {section.items.map((item) => (
                  <a
                    key={item.id}
                    href={"#" + item.id}
                    className="block py-1 px-3 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                  >
                    {item.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocsSidebar;
