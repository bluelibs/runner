import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  Activity,
  CheckCircle2,
  AlertOctagon,
  Clock,
  RefreshCw,
  Power,
  LucideIcon,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { api, Execution, ExecutionStatus } from "@/api";
import { Link } from "react-router-dom";

const COLORS: Record<string, string> = {
  [ExecutionStatus.Running]: "#3b82f6", // blue-500
  [ExecutionStatus.Completed]: "#22c55e", // green-500
  [ExecutionStatus.Failed]: "#ef4444", // red-500
  [ExecutionStatus.CompensationFailed]: "#ec4899", // pink-500
  [ExecutionStatus.Cancelled]: "#64748b", // slate-500
  [ExecutionStatus.Pending]: "#eab308", // yellow-500
  [ExecutionStatus.Sleeping]: "#a855f7", // purple-500
  [ExecutionStatus.Retrying]: "#f97316", // orange-500
};

const POLLING_INTERVAL = 5000; // 5 seconds

type StatCardProps = {
  title: string;
  value: number;
  icon: LucideIcon;
  color: string;
};

function StatCard({ title, value, icon: Icon, color }: StatCardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex items-start justify-between">
      <div>
        <p className="text-slate-400 text-sm font-medium">{title}</p>
        <h3 className="text-3xl font-bold mt-2 text-slate-100">{value}</h3>
      </div>
      <div className={`p-3 rounded-lg bg-opacity-10 ${color}`}>
        <Icon className={`w-6 h-6 ${color.replace("bg-", "text-")}`} />
      </div>
    </div>
  );
}

export function Dashboard() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await api.executions.list();
      setExecutions(data);
    } catch (e) {
      console.error("Failed to fetch executions", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Set up auto-refresh
    if (autoRefresh) {
      intervalRef.current = setInterval(
        () => fetchData(true),
        POLLING_INTERVAL,
      );
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh]);

  const activeStatuses: ExecutionStatus[] = [
    ExecutionStatus.Running,
    ExecutionStatus.Pending,
    ExecutionStatus.Retrying,
    ExecutionStatus.Sleeping,
  ];

  // Compute stats
  const stats = {
    total: executions.length,
    active: executions.filter((e) => activeStatuses.includes(e.status)).length,
    completed: executions.filter((e) => e.status === ExecutionStatus.Completed)
      .length,
    critical: executions.filter(
      (e) =>
        e.status === ExecutionStatus.CompensationFailed ||
        e.status === ExecutionStatus.Failed,
    ).length,
  };

  const chartData = Object.entries(COLORS)
    .map(([status, color]) => ({
      name: status,
      value: executions.filter((e) => e.status === status).length,
      color,
    }))
    .filter((d) => d.value > 0);

  const recentAlerts = executions
    .filter(
      (e) =>
        e.status === ExecutionStatus.CompensationFailed ||
        e.status === ExecutionStatus.Failed,
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Mission Control</h1>
          <p className="text-slate-400 mt-2">
            Durable Engine Status:{" "}
            <span className="text-green-500 font-mono">ONLINE</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-2 rounded-lg transition-colors flex items-center gap-2 text-sm ${
              autoRefresh
                ? "bg-green-600/20 text-green-500 border border-green-600/30"
                : "bg-slate-800 text-slate-400 border border-slate-700"
            }`}
            title={autoRefresh ? "Auto-refresh ON (5s)" : "Auto-refresh OFF"}
          >
            <Power className="w-4 h-4" />
            <span className="hidden md:inline">
              {autoRefresh ? "Live" : "Paused"}
            </span>
          </button>
          <button
            onClick={() => fetchData()}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          title="Total Executions"
          value={stats.total}
          icon={Activity}
          color="bg-blue-500 text-blue-500"
        />
        <StatCard
          title="Active"
          value={stats.active}
          icon={Clock}
          color="bg-yellow-500 text-yellow-500"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          color="bg-green-500 text-green-500"
        />
        <StatCard
          title="Failures"
          value={stats.critical}
          icon={AlertOctagon}
          color="bg-pink-500 text-pink-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-6">Execution Health</h3>
          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        stroke="none"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      borderColor: "#334155",
                      borderRadius: "8px",
                    }}
                    itemStyle={{ color: "#f8fafc" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500">
                No data available
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-6">Recent Alerts</h3>
          <div className="space-y-4">
            {recentAlerts.length === 0 ? (
              <div className="text-slate-500 text-sm">No recent alerts.</div>
            ) : (
              recentAlerts.map((e) => (
                <Link
                  to={`/executions/${e.id}`}
                  key={e.id}
                  className="block group"
                >
                  <div className="flex items-start gap-4 p-4 rounded-lg bg-pink-500/10 border border-pink-500/20 group-hover:bg-pink-500/20 transition-colors">
                    <AlertOctagon className="w-5 h-5 text-pink-500 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-pink-500 capitalize">
                        {e.status.replace("_", " ")}
                      </h4>
                      <p className="text-sm text-slate-400 mt-1">
                        Execution {e.id}
                      </p>
                      <p className="text-xs text-slate-500 mt-2 font-mono">
                        {new Date(e.updatedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Executions List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-6">Recent Executions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-slate-950/50 text-slate-200 uppercase font-medium">
              <tr>
                <th className="p-4 rounded-tl-lg">ID</th>
                <th className="p-4">Task</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created</th>
                <th className="p-4 rounded-tr-lg">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {executions.slice(0, 10).map((e) => (
                <tr
                  key={e.id}
                  className="hover:bg-slate-800/50 transition-colors"
                >
                  <td className="p-4 font-mono text-slate-300">{e.id}</td>
                  <td className="p-4">{e.taskId}</td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium border ${
                        // Reuse logic or map from COLORS
                        e.status === ExecutionStatus.Completed
                          ? "bg-green-500/10 text-green-500 border-green-500/20"
                          : e.status === ExecutionStatus.Failed
                            ? "bg-red-500/10 text-red-500 border-red-500/20"
                            : e.status === ExecutionStatus.CompensationFailed
                              ? "text-pink-500 border-pink-500/20 bg-pink-500/10"
                              : e.status === ExecutionStatus.Cancelled
                                ? "bg-slate-500/10 text-slate-300 border-slate-500/20"
                                : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                      }`}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="p-4">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <Link
                      to={`/executions/${e.id}`}
                      className="text-blue-400 hover:text-blue-300 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {executions.length === 0 && !loading && (
            <div className="p-8 text-center text-slate-500">
              No executions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
