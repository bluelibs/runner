import { Link } from "react-router-dom";
import { Gauge, Timer, TrendingUp } from "lucide-react";
import { benchmarks } from "../../constants/homePage";

const BenchmarksSection: React.FC = () => {
  return (
    <section className="py-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-20">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            <Gauge className="w-8 h-8 inline-block mr-2" />
            Built for Performance
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Real benchmarks from our comprehensive test suite. These aren't
            marketing numbers – they're what you'll actually see in
            production.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-20">
          {benchmarks.map((benchmark, index) => (
            <div key={index} className="card p-8 text-center">
              <div
                className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r ${benchmark.color} flex items-center justify-center`}
              >
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {benchmark.value}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {benchmark.label}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link to="/benchmarks" className="btn-primary">
            <Timer className="w-5 h-5 mr-2" />
            See All Benchmarks
          </Link>
        </div>
      </div>
    </section>
  );
};

export default BenchmarksSection;