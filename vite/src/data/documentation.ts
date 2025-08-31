import {
  Book,
  Code,
  Database,
  MessageSquare,
  Settings,
  Zap,
  Shield,
  Timer,
  Activity,
  Eye,
  HardDrive,
  RotateCcw,
  Clock,
  BarChart3,
  TrendingUp,
  Power,
  PowerOff,
  AlertTriangle,
  Bug,
  Tags,
  Rocket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface DocItem {
  id: string;
  title: string;
  description: string;
}

export interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  items: DocItem[];
}

export const coreConceptsSection: DocSection = {
  id: "core-concepts",
  title: "Core Concepts",
  icon: Book,
  items: [
    {
      id: "tasks",
      title: "Tasks",
      description: "Functions with superpowers - your business logic",
    },
    {
      id: "resources",
      title: "Resources",
      description: "Singletons, services, and shared state",
    },
    {
      id: "events",
      title: "Events",
      description: "Decoupled communication between components",
    },
    {
      id: "hooks",
      title: "Hooks",
      description: "Lightweight event listeners",
    },
    {
      id: "middleware",
      title: "Middleware",
      description: "Cross-cutting concerns and lifecycle hooks",
    },
  ],
};

export const executionSection: DocSection = {
  id: "execution",
  title: "Execution",
  icon: Rocket,
  items: [
    {
      id: "run-options",
      title: "Run & RunOptions",
      description: "Booting your application and configuring its runtime.",
    },
  ],
};

export const advancedSection: DocSection = {
  id: "advanced",
  title: "Advanced Features",
  icon: Zap,
  items: [
    {
      id: "context",
      title: "Context",
      description: "Request-scoped data without prop drilling",
    },
    {
      id: "interceptors",
      title: "Interceptors",
      description: "Dynamic task behavior modification",
    },
    {
      id: "optional-deps",
      title: "Optional Dependencies",
      description: "Graceful degradation patterns",
    },
    {
      id: "meta-and-tags",
      title: "Meta & Tags",
      description: "Describe and control your components",
    },
    {
      id: "debug-resource",
      title: "Debug Resource",
      description: "Professional-grade debugging",
    },
  ],
};

export const enterpriseSection: DocSection = {
  id: "enterprise",
  title: "Enterprise Features",
  icon: Shield,
  items: [
    {
      id: "logging",
      title: "Logging",
      description: "Structured logging with context",
    },
    {
      id: "caching",
      title: "Caching",
      description: "Built-in LRU and custom cache providers",
    },
    {
      id: "retries",
      title: "Retries",
      description: "Automatic retry with backoff strategies",
    },
    {
      id: "timeouts",
      title: "Timeouts",
      description: "Operation timeout management",
    },
    {
      id: "shutdown",
      title: "System Shutdown",
      description: "Graceful shutdown and cleanup",
    },
    {
      id: "unhandled-errors",
      title: "Unhandled Errors",
      description: "Catch and handle unexpected errors",
    },
  ],
};

export const performanceSection: DocSection = {
  id: "performance",
  title: "Performance",
  icon: Timer,
  items: [
    {
      id: "benchmarks",
      title: "Benchmarks",
      description: "Real-world performance metrics",
    },
    {
      id: "optimization",
      title: "Optimization",
      description: "Best practices for high performance",
    },
    {
      id: "monitoring",
      title: "Monitoring",
      description: "Debug and performance monitoring",
    },
    {
      id: "memory",
      title: "Memory Management",
      description: "Resource lifecycle and cleanup",
    },
  ],
};

export const allDocSections = [
  coreConceptsSection,
  executionSection,
  advancedSection,
  enterpriseSection,
  performanceSection,
];

export const conceptIcons: Record<string, LucideIcon> = {
  tasks: Code,
  resources: Database,
  events: MessageSquare,
  hooks: Code,
  middleware: Settings,
  "run-options": Power,
  context: Activity,
  interceptors: Zap,
  "optional-deps": Bug,
  "meta-and-tags": Tags,
  "debug-resource": Bug,
  logging: Eye,
  caching: HardDrive,
  retries: RotateCcw,
  timeouts: Clock,
  shutdown: PowerOff,
  "unhandled-errors": AlertTriangle,
  benchmarks: BarChart3,
  optimization: TrendingUp,
  monitoring: Activity,
  memory: HardDrive,
};