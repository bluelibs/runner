export const rawBenchmarkData = {
  basicTaskExecution: {
    iterations: 1000,
    totalTimeMs: 0.4,
    avgTimePerTaskMs: 0.0004,
    tasksPerSecond: 2505744,
  },
  middlewareTaskExecution: {
    iterations: 1000,
    middlewareCount: 5,
    totalTimeMs: 9.16,
    avgTimePerTaskMs: 0.0092,
    tasksPerSecond: 109141,
    middlewareOverheadMs: 0.0088,
  },
  resourceInitialization: {
    resourceCount: 100,
    totalTimeMs: 4.95,
    avgTimePerResourceMs: 0.0495,
    resourcesPerSecond: 20191,
  },
  eventEmissionAndHandling: {
    iterations: 500,
    totalTimeMs: 3.82,
    avgTimePerEventMs: 0.0076,
    eventsPerSecond: 130819,
    eventHandlerCallCount: 500,
  },
  dependencyResolution: {
    iterations: 100,
    chainDepth: 10,
    totalTimeMs: 161.49,
    avgTimePerChainMs: 1.6149,
    chainsPerSecond: 619,
  },
  cacheMiddleware: {
    iterationsWithoutCache: 200,
    iterationsWithCache: 100,
    timeWithoutCacheMs: 15.71,
    timeWithCacheMs: 3.91,
    avgTimeWithoutCacheMs: 0.0786,
    avgTimeWithCacheMs: 0.0391,
    speedupFactor: 2.01,
  },
  memoryUsage: {
    before: {
      heapUsedMB: 214.49,
      heapTotalMB: 238.14,
    },
    afterInit: {
      heapUsedMB: 204.74,
      heapTotalMB: 239.64,
    },
    afterExecution: {
      heapUsedMB: 212.05,
      heapTotalMB: 239.64,
    },
    initOverheadMB: -9.74,
    executionOverheadMB: 7.31,
    componentCount: 100,
  },
};

// Formatted data for the BenchmarksPage component
export const benchmarkCategories = [
  { id: "core", label: "Core Operations", icon: "Zap" },
  { id: "middleware", label: "Middleware", icon: "Settings" },
  { id: "events", label: "Events", icon: "MessageSquare" },
  { id: "resources", label: "Resources", icon: "Database" },
  { id: "memory", label: "Memory", icon: "HardDrive" },
];

export const benchmarkData = {
  core: [
    {
      name: "Lightning Fast Tasks",
      value: "2.51M",
      unit: "tasks/sec",
      description: "Execute tasks at incredible speed",
      details: `Just ${rawBenchmarkData.basicTaskExecution.avgTimePerTaskMs}ms per task - faster than most alternatives`,
      color: "from-green-400 to-blue-500",
    },
    {
      name: "Smart Dependencies",
      value: "109K",
      unit: "tasks/sec",
      description: "Dependency injection with minimal overhead",
      details: `${rawBenchmarkData.middlewareTaskExecution.middlewareOverheadMs}ms overhead per middleware layer`,
      color: "from-blue-400 to-purple-500",
    },
    {
      name: "Complex Apps Made Simple",
      value: "619",
      unit: "chains/sec",
      description: "Handle complex dependency trees effortlessly",
      details: `10-level deep dependencies resolved in ${rawBenchmarkData.dependencyResolution.avgTimePerChainMs}ms`,
      color: "from-purple-400 to-pink-500",
    },
  ],
  middleware: [
    {
      name: "High-Performance Middleware",
      value: "109K",
      unit: "tasks/sec",
      description: "Execute middleware chains without slowing down",
      details: `Just ${rawBenchmarkData.middlewareTaskExecution.avgTimePerTaskMs}ms per task with 5 middleware layers`,
      color: "from-green-400 to-blue-500",
    },
    {
      name: "Minimal Overhead",
      value: "8.8",
      unit: "μs overhead",
      description: "Add middleware without performance penalty",
      details: `${
        rawBenchmarkData.middlewareTaskExecution.middlewareOverheadMs * 1000
      }μs overhead per middleware layer`,
      color: "from-blue-400 to-purple-500",
    },
    {
      name: "Built-in Caching",
      value: `${rawBenchmarkData.cacheMiddleware.speedupFactor}x`,
      unit: "faster",
      description: "Automatic performance boost with intelligent caching",
      details: `${rawBenchmarkData.cacheMiddleware.speedupFactor}x speedup for repeated operations`,
      color: "from-purple-400 to-pink-500",
    },
  ],
  events: [
    {
      name: "Reactive & Fast",
      value: "131K",
      unit: "events/sec",
      description: "Handle events in real-time with ease",
      details: `Lightning-fast event processing at ${rawBenchmarkData.eventEmissionAndHandling.avgTimePerEventMs}ms per event`,
      color: "from-green-400 to-blue-500",
    },
    {
      name: "Reliable Event Handling",
      value: "100%",
      unit: "success rate",
      description: "Every event gets handled, guaranteed",
      details: `${rawBenchmarkData.eventEmissionAndHandling.eventHandlerCallCount} handlers executed without a single miss`,
      color: "from-blue-400 to-purple-500",
    },
    {
      name: "Batch Processing",
      value: `${rawBenchmarkData.eventEmissionAndHandling.totalTimeMs}`,
      unit: "ms for 500 events",
      description: "Process hundreds of events in milliseconds",
      details: "Efficient batch processing for high-volume scenarios",
      color: "from-purple-400 to-pink-500",
    },
  ],
  resources: [
    {
      name: "Fast Resource Init",
      value: "20K",
      unit: "resources/sec",
      description: "Get your app running immediately",
      details: `Resources initialize in just ${rawBenchmarkData.resourceInitialization.avgTimePerResourceMs}ms each`,
      color: "from-green-400 to-blue-500",
    },
    {
      name: "Scale Without Worry",
      value: `${rawBenchmarkData.resourceInitialization.totalTimeMs}`,
      unit: "ms for 100 resources",
      description: "Handle hundreds of components effortlessly",
      details: `${rawBenchmarkData.resourceInitialization.resourceCount} resources ready in just ${rawBenchmarkData.resourceInitialization.totalTimeMs} milliseconds`,
      color: "from-blue-400 to-purple-500",
    },
    {
      name: "Production Ready",
      value: "100+",
      unit: "components",
      description: "Built for real-world applications",
      details: "Tested with large-scale component architectures",
      color: "from-purple-400 to-pink-500",
    },
  ],
  memory: [
    {
      name: "Efficient Memory Use",
      value: `${rawBenchmarkData.memoryUsage.executionOverheadMB}`,
      unit: "MB overhead",
      description: "Minimal memory footprint for maximum performance",
      details: `Just ${rawBenchmarkData.memoryUsage.executionOverheadMB}MB overhead for ${rawBenchmarkData.memoryUsage.componentCount} components`,
      color: "from-green-400 to-blue-500",
    },
    {
      name: "Smart Initialization",
      value: `${Math.abs(rawBenchmarkData.memoryUsage.initOverheadMB)}`,
      unit: "MB freed",
      description: "Framework optimizes memory during startup",
      details:
        "Framework frees memory during initialization - intelligent cleanup",
      color: "from-blue-400 to-purple-500",
    },
    {
      name: "Production Efficient",
      value: `${rawBenchmarkData.memoryUsage.afterExecution.heapUsedMB}`,
      unit: "MB total",
      description: "Efficient memory usage in real applications",
      details: `Stable memory consumption with ${rawBenchmarkData.memoryUsage.componentCount}+ components`,
      color: "from-purple-400 to-pink-500",
    },
  ],
};

// Homepage benchmarks (simplified version)
export const homeBenchmarks = [
  {
    value: "2.51M",
    label: "tasks/sec",
    color: "from-green-400 to-blue-500",
  },
  {
    value: "109K",
    label: "middleware tasks/sec",
    color: "from-blue-400 to-purple-500",
  },
  {
    value: "131K",
    label: "events/sec",
    color: "from-purple-400 to-pink-500",
  },
  {
    value: "20K",
    label: "resources/sec",
    color: "from-pink-400 to-red-500",
  },
];
