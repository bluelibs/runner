import { useState } from "react";
import {
  TrendingUp,
  Zap,
  Activity,
  BarChart3,
  HardDrive,
  Database,
  MessageSquare,
  Settings,
  Info,
} from "lucide-react";
import CodeBlock from "../components/CodeBlock";
import Meta from "../components/Meta";
import { benchmarkCategories, benchmarkData } from "../constants/benchmarkData";

const BenchmarksPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState("core");

  const iconMap = {
    Zap,
    Settings,
    MessageSquare,
    Database,
    HardDrive,
  };

  // Note: We intentionally avoid cross-framework comparison tables here.
  // Public benchmarks (eg. Fastify benchmarks, TechEmpower) measure HTTP servers
  // under specific setups and do not map 1:1 to Runner's task semantics.

  const currentBenchmarks =
    benchmarkData[selectedCategory as keyof typeof benchmarkData];

  return (
    <div className="py-24 sm:py-32">
      <Meta
        title="Runner Benchmarks — Real performance numbers"
        description="Throughput and latency benchmarks for tasks, middleware, events, and resources. Reproducible methodology on M1 Max."
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16 rounded-2xl bg-gradient-to-b from-blue-50/50 via-transparent dark:from-blue-900/20 py-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-6">
            <TrendingUp className="w-4 h-4 mr-2" />
            Real Performance Data
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold text-gray-900 dark:text-white mb-8 tracking-tighter">
            Performance
            <span className=""> Benchmarks</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            These aren't marketing numbers. They're real benchmarks from our
            comprehensive test suite running on an M1 Max. See exactly what you
            can expect in production.
          </p>
        </div>

        {/* Category Selector */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {benchmarkCategories.map((category) => {
            const IconComponent =
              iconMap[category.icon as keyof typeof iconMap];
            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer ${
                  selectedCategory === category.id
                    ? "bg-blue-600 text-white shadow-lg"
                    : "bg-white/10 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-white/20 dark:hover:bg-gray-700/50"
                }`}
              >
                <IconComponent className="w-4 h-4" />
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>

        {/* Benchmark Results */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {currentBenchmarks.map((benchmark, index) => (
            <div
              key={index}
              className="card p-6 hover:scale-105 transition-transform duration-200"
            >
              <div
                className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r ${benchmark.color} flex items-center justify-center`}
              >
                <Activity className="w-8 h-8 text-white" />
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                  {benchmark.value}
                </div>
                <div className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-3">
                  {benchmark.unit}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {benchmark.name}
                </h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm mb-3">
                  {benchmark.description}
                </p>
                <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100/50 dark:bg-gray-800/50 rounded px-2 py-1">
                  {benchmark.details}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* External Benchmarks (links only) */}
        <section className="mb-16">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
              External Benchmarks
            </h2>
            <p className="text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              For HTTP framework performance (hello world/JSON), see
              community-maintained benchmarks. These measure web servers under
              specific setups and are not directly comparable to Runner’s task
              throughput.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              className="card p-5 hover:scale-[1.01] transition"
              href="https://github.com/fastify/benchmarks"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="font-semibold text-gray-900 dark:text-white mb-1">
                Fastify Benchmarks (GitHub)
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Comparative Node.js HTTP framework results with methodology and
                scripts.
              </div>
            </a>
            <a
              className="card p-5 hover:scale-[1.01] transition"
              href="https://www.techempower.com/benchmarks/"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="font-semibold text-gray-900 dark:text-white mb-1">
                TechEmpower Framework Benchmarks
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Large, standardized cross-language web framework benchmarks;
                results vary by test.
              </div>
            </a>
          </div>
        </section>

        {/* Methodology */}
        <section className="card p-8 mb-16">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center">
            <Info className="w-6 h-6 mr-2" />
            Benchmark Methodology
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Test Environment
              </h3>
              <ul className="space-y-2 text-gray-600 dark:text-gray-300">
                <li>• MacBook Pro M1 Max, 32GB RAM</li>
                <li>• Node.js 20.x, TypeScript 5.x</li>
                <li>• 1000 iterations per benchmark</li>
                <li>• JIT warmup and GC settling</li>
                <li>• Isolated test environment</li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                What We Measure
              </h3>
              <ul className="space-y-2 text-gray-600 dark:text-gray-300">
                <li>• Operations per second (throughput)</li>
                <li>• Average execution time (latency)</li>
                <li>• Memory consumption (RSS)</li>
                <li>• CPU utilization patterns</li>
                <li>• Resource cleanup efficiency</li>
              </ul>
            </div>
          </div>
          <div className="mt-6 p-4 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <strong>Note:</strong> You may see negative middleware overhead in
              micro-benchmarks. This is a measurement artifact due to JIT
              optimization, CPU scheduling, and cache effects. Interpret small
              negatives as ≈ 0 overhead.
            </p>
          </div>
        </section>

        {/* Run Your Own */}
        <section className="text-center">
          <div className="card p-8 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Run Your Own Benchmarks
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Don't just take our word for it. Clone the repository and run the
              benchmarks yourself.
            </p>
            <CodeBlock language="bash" className="mb-6 text-left">
              {`git clone https://github.com/bluelibs/runner.git
cd runner
npm install
npm run benchmark`}
            </CodeBlock>
            <a
              href="https://github.com/bluelibs/runner/blob/main/src/__tests__/benchmark/comprehensive-benchmark.test.ts"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              <BarChart3 className="w-5 h-5 mr-2" />
              View Benchmark Code
            </a>
          </div>
        </section>
      </div>
    </div>
  );
};

export default BenchmarksPage;
