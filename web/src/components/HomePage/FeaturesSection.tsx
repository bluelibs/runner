import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { features } from "../../constants/homePage";
import CodeBlock from "../CodeBlock";

const FeaturesSection: React.FC = () => {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  return (
    <section className="py-32 bg-white/50 dark:bg-gray-900/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-20">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            The Big Five
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Understanding these five concepts is key to using Runner
            effectively. They're not just buzzwords – they're the building
            blocks of maintainable applications.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
          {features.map((feature, index) => (
            <div
              key={index}
              className={`card p-10 transition-all duration-300 ${
                hoveredFeature === index ? "scale-105 shadow-2xl" : ""
              }`}
              onMouseEnter={() => setHoveredFeature(index)}
              onMouseLeave={() => setHoveredFeature(null)}
            >
              <div className="flex items-start space-x-6 mb-12">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-300">
                    {feature.description}
                  </p>
                  <div className="mt-3">
                    <Link
                      to={`/docs#${feature.docAnchor}`}
                      className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                    >
                      Learn more
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  </div>
                </div>
              </div>
              <div className="overflow-hidden">
                <CodeBlock>{feature.example}</CodeBlock>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;