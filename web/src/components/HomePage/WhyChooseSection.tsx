import { useState } from "react";
import { Link } from "react-router-dom";
import { 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  Shuffle, 
  Brain, 
  Zap as Lightning,
  Coffee 
} from "lucide-react";
import { authorQuotes, quoteIcons, whyChooseFeatures } from "../../constants/homePage";

const WhyChooseSection: React.FC = () => {
  const [quoteIndex, setQuoteIndex] = useState(0);

  const getRandomIcon = (index: number) => {
    return quoteIcons[index % quoteIcons.length];
  };

  return (
    <section className="py-32 bg-white/50 dark:bg-gray-900/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-12">
              Why Choose Runner?
            </h2>
            <div className="space-y-8">
              {whyChooseFeatures.map((feature, index) => (
                <div key={index} className="flex items-start space-x-3">
                  <Check className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-600 dark:text-gray-300">
                    {feature}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-12">
              <Link to="/docs" className="btn-primary">
                Read the Docs
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
            </div>
          </div>
          <div className="card p-10">
            <div className="text-gray-500 dark:text-gray-400 text-sm mb-4 flex items-center justify-between">
              <span>From the author:</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-gray-400 text-xs">
                  {quoteIndex + 1} / {authorQuotes.length}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setQuoteIndex(
                        (i) =>
                          (i - 1 + authorQuotes.length) % authorQuotes.length,
                      )
                    }
                    className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition text-xs"
                    aria-label="Previous quote"
                    title="Previous quote"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuoteIndex(
                        Math.floor(Math.random() * authorQuotes.length),
                      )
                    }
                    className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition text-xs"
                    aria-label="Random quote"
                    title="Random quote"
                  >
                    <Shuffle className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuoteIndex((i) => (i + 1) % authorQuotes.length)
                    }
                    className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition text-xs"
                    aria-label="Next quote"
                    title="Next quote"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-start space-x-3 mb-4">
              {(() => {
                const QuoteIcon = getRandomIcon(quoteIndex);
                return (
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                    <QuoteIcon className="w-4 h-4 text-white" />
                  </div>
                );
              })()}
              <blockquote className="text-lg text-gray-900 dark:text-white">
                "{authorQuotes[quoteIndex]}"
              </blockquote>
            </div>
            <div className="flex justify-end">
              <div className="flex items-center space-x-2">
                <div className="relative">
                  <div className="w-6 h-6 bg-gradient-to-br from-purple-500 via-blue-500 to-green-400 rounded-full flex items-center justify-center">
                    <Brain className="w-3 h-3 text-white" />
                  </div>
                  <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full flex items-center justify-center">
                    <Lightning className="w-1.5 h-1.5 text-white" />
                  </div>
                  <div className="absolute -bottom-0 -left-0 w-2 h-2 bg-gradient-to-r from-pink-400 to-red-400 rounded-full flex items-center justify-center">
                    <Coffee className="w-1 h-1 text-white" />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-light text-gray-600 dark:text-gray-400 tracking-wide">
                    Theodor Diaconu
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 font-extralight italic">
                    Author of Runner
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhyChooseSection;