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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface DocItem {
  title: string;
  href: string;
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
      title: "Tasks",
      href: "#tasks",
      description: "Functions with superpowers - your business logic",
    },
    {
      title: "Resources",
      href: "#resources",
      description: "Singletons, services, and shared state",
    },
    {
      title: "Events",
      href: "#events",
      description: "Decoupled communication between components",
    },
    {
      title: "Middleware",
      href: "#middleware",
      description: "Cross-cutting concerns and lifecycle hooks",
    },
  ],
};

export const advancedSection: DocSection = {
  id: "advanced",
  title: "Advanced Features",
  icon: Zap,
  items: [
    {
      title: "Context",
      href: "#context",
      description: "Request-scoped data without prop drilling",
    },
    {
      title: "Interceptors",
      href: "#interceptors",
      description: "Dynamic task behavior modification",
    },
    {
      title: "Optional Dependencies",
      href: "#optional-deps",
      description: "Graceful degradation patterns",
    },
    {
      title: "Task Hooks",
      href: "#task-hooks",
      description: "Lifecycle event handling",
    },
  ],
};

export const enterpriseSection: DocSection = {
  id: "enterprise",
  title: "Enterprise Features",
  icon: Shield,
  items: [
    {
      title: "Logging",
      href: "#logging",
      description: "Structured logging with context",
    },
    {
      title: "Caching",
      href: "#caching",
      description: "Built-in LRU and custom cache providers",
    },
    {
      title: "Retries",
      href: "#retries",
      description: "Automatic retry with backoff strategies",
    },
    {
      title: "Timeouts",
      href: "#timeouts",
      description: "Operation timeout management",
    },
  ],
};

export const performanceSection: DocSection = {
  id: "performance",
  title: "Performance",
  icon: Timer,
  items: [
    {
      title: "Benchmarks",
      href: "#benchmarks",
      description: "Real-world performance metrics",
    },
    {
      title: "Optimization",
      href: "#optimization",
      description: "Best practices for high performance",
    },
    {
      title: "Monitoring",
      href: "#monitoring",
      description: "Debug and performance monitoring",
    },
    {
      title: "Memory Management",
      href: "#memory",
      description: "Resource lifecycle and cleanup",
    },
  ],
};

export const allDocSections = [
  coreConceptsSection,
  advancedSection,
  enterpriseSection,
  performanceSection,
];

export const conceptIcons = {
  tasks: Code,
  resources: Database,
  events: MessageSquare,
  middleware: Settings,
  context: Activity,
  logging: Eye,
  caching: HardDrive,
  retries: RotateCcw,
  timeouts: Clock,
  benchmarks: BarChart3,
  optimization: TrendingUp,
};
