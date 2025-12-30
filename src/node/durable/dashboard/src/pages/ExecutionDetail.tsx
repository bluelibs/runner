import { useParams, Link } from 'react-router-dom';
import { Timeline, TimelineStep } from '@/components/execution/Timeline';
import { CrashControl } from '@/components/execution/CrashControl';
import { ArrowLeft, Clock, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, Execution } from '@/api';

export function ExecutionDetail() {
  const { id } = useParams();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExecution = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await api.executions.get(id);
      setExecution(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExecution();
  }, [id]);

  if (loading) return <div className="text-slate-400 p-8">Loading execution details...</div>;
  if (error) return <div className="text-red-400 p-8">Error: {error}</div>;
  if (!execution) return <div className="text-slate-400 p-8">Execution not found</div>;

  // Build timeline steps from the API response
  // The API now returns a `steps` array with StepResult objects
  const timelineSteps: TimelineStep[] = [];
  
  if (execution.steps && execution.steps.length > 0) {
    execution.steps.forEach((step) => {
      timelineSteps.push({
        id: step.stepId,
        name: step.stepId,
        status: 'completed',
        duration: step.completedAt ? new Date(step.completedAt).toLocaleTimeString() : undefined
      });
    });
  }
  
  // Add error step if execution failed
  if (execution.status === 'failed' || execution.status === 'compensation_failed') {
    timelineSteps.push({
      id: 'error',
      name: 'execution-failure',
      status: execution.status,
      duration: 'stopped',
      errorMessage: execution.error?.message
    });
  }
  
  // Add pending step if execution is still running
  if (execution.status === 'running' || execution.status === 'pending') {
    timelineSteps.push({
      id: 'current',
      name: 'in-progress',
      status: 'running',
      duration: 'running...'
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/executions" className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-100">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
               <h1 className="text-2xl font-bold text-slate-100 font-mono">{execution.id}</h1>
               <span className={`px-2 py-1 rounded font-medium border text-xs ${
                   execution.status === 'compensation_failed' ? 'bg-pink-500/10 text-pink-500 border-pink-500/20 animate-pulse' :
                   execution.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                   execution.status === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                   'bg-blue-500/10 text-blue-500 border-blue-500/20'
               }`}>
                 {execution.status.toUpperCase()}
               </span>
            </div>
            <div className="flex items-center gap-2 text-slate-500 text-sm mt-1">
              <Clock className="w-3 h-3" />
              <span>Started: {new Date(execution.createdAt).toLocaleString()}</span>
              {execution.updatedAt && <span>• Updated: {new Date(execution.updatedAt).toLocaleTimeString()}</span>}
            </div>
          </div>
        </div>
        <button onClick={fetchExecution} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors" title="Refresh">
            <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
        {/* Left: Timeline */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Execution Flow</h3>
          {timelineSteps.length === 0 ? (
              <div className="text-slate-500 italic">No steps recorded yet.</div>
          ) : (
              <Timeline steps={timelineSteps} />
          )}
          
          <div className="mt-8 border-t border-slate-800 pt-6">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Input Data</h4>
              <pre className="bg-slate-950 p-4 rounded-lg overflow-auto text-xs font-mono text-slate-300 border border-slate-800">
                  {JSON.stringify(execution.input, null, 2)}
              </pre>
          </div>
        </div>

        {/* Right: Crash Control */}
        <div>
          <CrashControl executionId={execution.id} />
        </div>
      </div>
    </div>
  );
}
