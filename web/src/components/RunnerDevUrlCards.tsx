import { Database, Eye, FileText } from "lucide-react";

interface RunnerDevUrlCardsProps {
  variant?: "full" | "compact";
}

const RunnerDevUrlCards: React.FC<RunnerDevUrlCardsProps> = ({ variant = "full" }) => {
  const isCompact = variant === "compact";
  
  const cards = [
    {
      icon: Database,
      label: "GraphQL Playground",
      shortLabel: "GraphQL",
      url: isCompact ? ":1337/graphql" : "localhost:1337/graphql",
      gradient: "from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30",
      iconColor: "text-blue-600 dark:text-blue-400"
    },
    {
      icon: Eye,
      label: "Schema Explorer", 
      shortLabel: "Voyager",
      url: isCompact ? ":1337/voyager" : "localhost:1337/voyager",
      gradient: "from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30",
      iconColor: "text-purple-600 dark:text-purple-400"
    },
    {
      icon: FileText,
      label: "Runner Docs",
      shortLabel: "Docs", 
      url: isCompact ? ":1337/docs" : "localhost:1337/docs",
      gradient: "from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30",
      iconColor: "text-emerald-600 dark:text-emerald-400"
    }
  ];

  const iconSize = isCompact ? "w-3 h-3" : "w-4 h-4";
  const padding = isCompact ? "px-3 py-2" : "px-4 py-3";
  const textSize = isCompact ? "text-xs" : "text-sm";
  const labelTextSize = isCompact ? "text-xs" : "text-xs";

  return (
    <div className={`grid grid-cols-1 ${isCompact ? "sm:grid-cols-3 gap-3 max-w-2xl" : "md:grid-cols-3 gap-4 max-w-4xl"} mx-auto`}>
      {cards.map((card, index) => (
        <div key={index} className={`inline-flex items-center ${padding} bg-gradient-to-r ${card.gradient} rounded-lg`}>
          <card.icon className={`${iconSize} ${card.iconColor} mr-2`} />
          <div className="text-left">
            <div className={`${labelTextSize} text-gray-600 dark:text-gray-400`}>
              {isCompact ? card.shortLabel : card.label}
            </div>
            <code className={`${textSize} text-emerald-600 dark:text-emerald-400`}>
              {card.url}
            </code>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RunnerDevUrlCards;