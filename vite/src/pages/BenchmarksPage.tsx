import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Zap, 
  Clock, 
  Activity, 
  BarChart3,
  Cpu,
  HardDrive,
  Database,
  MessageSquare,
  Settings,
  Info
} from 'lucide-react';

const BenchmarksPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState('core');

  const benchmarkCategories = [
    { id: 'core', label: 'Core Operations', icon: Zap },
    { id: 'middleware', label: 'Middleware', icon: Settings },
    { id: 'events', label: 'Events', icon: MessageSquare },
    { id: 'resources', label: 'Resources', icon: Database },
    { id: 'memory', label: 'Memory', icon: HardDrive }
  ];

  const benchmarkData = {
    core: [
      {
        name: 'Basic Task Execution',
        value: '2.2M',
        unit: 'tasks/sec',
        description: 'Simple task execution without middleware',
        details: 'Average execution time: ~0.0005ms per task',
        color: 'from-green-400 to-blue-500'
      },
      {
        name: 'Task with Dependencies',
        value: '1.8M',
        unit: 'tasks/sec',
        description: 'Task execution with dependency injection',
        details: 'Includes dependency resolution overhead',
        color: 'from-blue-400 to-purple-500'
      },
      {
        name: 'Dependency Chain (10 levels)',
        value: '8.4K',
        unit: 'chains/sec',
        description: 'Complex dependency resolution chain',
        details: 'Deep dependency graph resolution',
        color: 'from-purple-400 to-pink-500'
      }
    ],
    middleware: [
      {
        name: 'Single Middleware',
        value: '1.9M',
        unit: 'tasks/sec',
        description: 'Task with one middleware layer',
        details: 'Overhead: ~0.0003ms per middleware',
        color: 'from-green-400 to-blue-500'
      },
      {
        name: '5 Middleware Chain',
        value: '244K',
        unit: 'tasks/sec',
        description: 'Task with five middleware layers',
        details: 'Total middleware overhead: ~0.0013ms',
        color: 'from-blue-400 to-purple-500'
      },
      {
        name: 'Auth + Logging + Metrics',
        value: '180K',
        unit: 'tasks/sec',
        description: 'Real-world middleware combination',
        details: 'Production-like middleware stack',
        color: 'from-purple-400 to-pink-500'
      }
    ],
    events: [
      {
        name: 'Event Emission',
        value: '246K',
        unit: 'events/sec',
        description: 'Event emission and handling',
        details: 'Includes hook execution time',
        color: 'from-green-400 to-blue-500'
      },
      {
        name: 'Multiple Hooks (5)',
        value: '95K',
        unit: 'events/sec',
        description: 'Event with 5 concurrent hooks',
        details: 'Parallel hook execution',
        color: 'from-blue-400 to-purple-500'
      },
      {
        name: 'Wildcard Listeners',
        value: '180K',
        unit: 'events/sec',
        description: 'Events with wildcard hook listeners',
        details: 'Global event monitoring overhead',
        color: 'from-purple-400 to-pink-500'
      }
    ],
    resources: [
      {
        name: 'Resource Initialization',
        value: '59.7K',
        unit: 'resources/sec',
        description: 'Resource creation and initialization',
        details: 'Includes dependency resolution',
        color: 'from-green-400 to-blue-500'
      },
      {
        name: 'Resource with Context',
        value: '45K',
        unit: 'resources/sec',
        description: 'Resource with private context',
        details: 'Additional context initialization overhead',
        color: 'from-blue-400 to-purple-500'
      },
      {
        name: 'Complex Resource Graph',
        value: '12K',
        unit: 'resources/sec',
        description: '20-resource dependency graph',
        details: 'Large-scale resource orchestration',
        color: 'from-purple-400 to-pink-500'
      }
    ],
    memory: [
      {
        name: 'Memory per Component',
        value: '33',
        unit: 'KB',
        description: 'Average memory footprint per component',
        details: 'Includes metadata and lifecycle hooks',
        color: 'from-green-400 to-blue-500'
      },
      {
        name: '100 Components',
        value: '3.3',
        unit: 'MB',
        description: 'Total memory for 100 components',
        details: 'Linear memory scaling',
        color: 'from-blue-400 to-purple-500'
      },
      {
        name: 'Cache Hit Speedup',
        value: '3.65x',
        unit: 'faster',
        description: 'Performance improvement with caching',
        details: 'Built-in LRU cache performance',
        color: 'from-purple-400 to-pink-500'
      }
    ]
  };

  const comparisonData = [
    {
      framework: 'BlueLibs Runner',
      taskExecution: '2.2M/sec',
      memoryOverhead: '33KB/component',
      bootTime: '~50ms',
      features: ['DI', 'Middleware', 'Events', 'Type Safety'],
      color: 'bg-gradient-to-r from-blue-500 to-purple-600'
    },
    {
      framework: 'Express.js',
      taskExecution: '~800K/sec',
      memoryOverhead: '~45KB/route',
      bootTime: '~20ms',
      features: ['Middleware', 'Routing'],
      color: 'bg-gradient-to-r from-gray-500 to-gray-600'
    },
    {
      framework: 'NestJS',
      taskExecution: '~120K/sec',
      memoryOverhead: '~150KB/component',
      bootTime: '~500ms',
      features: ['DI', 'Decorators', 'Guards', 'Type Safety'],
      color: 'bg-gradient-to-r from-red-500 to-red-600'
    },
    {
      framework: 'Fastify',
      taskExecution: '~1.1M/sec',
      memoryOverhead: '~25KB/route',
      bootTime: '~30ms',
      features: ['High Performance', 'JSON Schema'],
      color: 'bg-gradient-to-r from-green-500 to-green-600'
    }
  ];

  const currentBenchmarks = benchmarkData[selectedCategory as keyof typeof benchmarkData];

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-4">
            <TrendingUp className="w-4 h-4 mr-2" />
            Real Performance Data
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Performance
            <span className="gradient-text"> Benchmarks</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            These aren't marketing numbers. They're real benchmarks from our comprehensive test suite 
            running on an M1 Max. See exactly what you can expect in production.
          </p>
        </div>

        {/* Category Selector */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {benchmarkCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                selectedCategory === category.id
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white/10 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-white/20 dark:hover:bg-gray-700/50'
              }`}
            >
              <category.icon className="w-4 h-4" />
              <span>{category.label}</span>
            </button>
          ))}
        </div>

        {/* Benchmark Results */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {currentBenchmarks.map((benchmark, index) => (
            <div key={index} className="card p-6 hover:scale-105 transition-transform duration-200">
              <div className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r ${benchmark.color} flex items-center justify-center`}>
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

        {/* Performance Comparison */}
        <section className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Framework Comparison
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              How BlueLibs Runner compares to other popular Node.js frameworks
            </p>
          </div>
          
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/50 dark:bg-gray-800/50">
                  <tr>
                    <th className="text-left py-4 px-6 font-semibold text-gray-900 dark:text-white">Framework</th>
                    <th className="text-center py-4 px-6 font-semibold text-gray-900 dark:text-white">Task Execution</th>
                    <th className="text-center py-4 px-6 font-semibold text-gray-900 dark:text-white">Memory/Component</th>
                    <th className="text-center py-4 px-6 font-semibold text-gray-900 dark:text-white">Boot Time</th>
                    <th className="text-center py-4 px-6 font-semibold text-gray-900 dark:text-white">Features</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/20 dark:divide-gray-700/20">
                  {comparisonData.map((framework, index) => (
                    <tr key={index} className="hover:bg-gray-50/30 dark:hover:bg-gray-800/30">
                      <td className="py-4 px-6">
                        <div className="flex items-center space-x-3">
                          <div className={`w-3 h-3 rounded-full ${framework.color}`}></div>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {framework.framework}
                          </span>
                        </div>
                      </td>
                      <td className="text-center py-4 px-6 text-gray-600 dark:text-gray-300">
                        {framework.taskExecution}
                      </td>
                      <td className="text-center py-4 px-6 text-gray-600 dark:text-gray-300">
                        {framework.memoryOverhead}
                      </td>
                      <td className="text-center py-4 px-6 text-gray-600 dark:text-gray-300">
                        {framework.bootTime}
                      </td>
                      <td className="text-center py-4 px-6">
                        <div className="flex flex-wrap justify-center gap-1">
                          {framework.features.map((feature, featureIndex) => (
                            <span
                              key={featureIndex}
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded"
                            >
                              {feature}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Test Environment</h3>
              <ul className="space-y-2 text-gray-600 dark:text-gray-300">
                <li>• MacBook Pro M1 Max, 32GB RAM</li>
                <li>• Node.js 20.x, TypeScript 5.x</li>
                <li>• 1000 iterations per benchmark</li>
                <li>• JIT warmup and GC settling</li>
                <li>• Isolated test environment</li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">What We Measure</h3>
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
              <strong>Note:</strong> You may see negative middleware overhead in micro-benchmarks. 
              This is a measurement artifact due to JIT optimization, CPU scheduling, and cache effects. 
              Interpret small negatives as ≈ 0 overhead.
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
              Don't just take our word for it. Clone the repository and run the benchmarks yourself.
            </p>
            <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 mb-6 text-left">
              <pre className="text-green-400 text-sm">
                <code>{`git clone https://github.com/bluelibs/runner.git
cd runner
npm install
npm run benchmark`}</code>
              </pre>
            </div>
            <a
              href="https://github.com/bluelibs/runner"
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