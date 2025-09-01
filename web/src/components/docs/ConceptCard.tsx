import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import CodeBlock from "../CodeBlock";

interface ConceptCardProps {
  id: string;
  title: string;
  icon: LucideIcon;
  iconBgGradient: string;
  description: string;
  codeExample?: string;
  apiHref?: string;
  children?: ReactNode;
  className?: string;
}

const ConceptCard: React.FC<ConceptCardProps> = ({
  id,
  title,
  icon: Icon,
  iconBgGradient,
  description,
  codeExample,
  apiHref,
  children,
  className = "",
}) => {
  return (
    <div id={id} className={`card p-8 scroll-mt-24 ${className}`}>
      <div className="flex items-center space-x-3 mb-6">
        <div className={`w-10 h-10 ${iconBgGradient} rounded-lg flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
          {title}
        </h3>
      </div>
      
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        {description}
      </p>
      
      {codeExample && (
        <CodeBlock className="mb-6">{codeExample}</CodeBlock>
      )}
      
      {children}

      {apiHref && (
        <div className="mt-4">
          <a
            href={apiHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View in API Reference
          </a>
        </div>
      )}
    </div>
  );
};

export default ConceptCard;
