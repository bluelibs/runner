import { useForm } from "react-hook-form";
import { Play, SkipForward, AlertOctagon, Terminal, Save } from "lucide-react";
import { api } from "@/api";
import { useState } from "react";

type CrashControlProps = {
  executionId: string;
};

type EditStateForm = {
  newStateJson: string;
  stepId: string;
};

export function CrashControl({ executionId }: CrashControlProps) {
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditStateForm>({
    defaultValues: {
      stepId: "",
      newStateJson:
        '{\n  "status": "success",\n  "result": { "refundId": "ref_123" }\n}',
    },
  });

  const handleAction = async (
    action: () => Promise<void>,
    successMessage: string,
  ) => {
    if (!confirm("Are you sure? This action is irreversible.")) return;
    setLoading(true);
    try {
      await action();
      alert(successMessage);
      window.location.reload(); // Simple refresh to show new state
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const onRetry = () =>
    handleAction(
      () => api.operator.retryRollback(executionId),
      "Execution retried",
    );

  const onSkip = () => {
    const stepId = prompt("Enter Step ID to skip:");
    if (!stepId) return;
    handleAction(
      () => api.operator.skipStep(executionId, stepId),
      `Step ${stepId} skipped`,
    );
  };

  const onForceFail = () => {
    const reason = prompt("Enter failure reason:");
    if (!reason) return;
    handleAction(
      () => api.operator.forceFail(executionId, reason),
      "Execution forced to failure",
    );
  };

  const onEditState = async (data: EditStateForm) => {
    if (!data.stepId) {
      alert("Please enter a Step ID to patch");
      return;
    }
    await handleAction(async () => {
      const parsed = JSON.parse(data.newStateJson);
      await api.operator.editState(executionId, data.stepId, parsed);
    }, "State patched successfully");
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-pink-500">
          <AlertOctagon className="w-5 h-5 animate-pulse" />
          <h3 className="font-bold">Crash Control</h3>
        </div>
        <span className="text-xs font-mono text-slate-500">{executionId}</span>
      </div>

      <div className="p-6 space-y-6 flex-1 overflow-auto">
        {/* Actions Grid */}
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={onRetry}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-4 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            Retry Execution
          </button>
          <button
            onClick={onSkip}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-4 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 font-medium transition-colors border border-slate-700 disabled:opacity-50"
          >
            <SkipForward className="w-4 h-4" />
            Skip Step
          </button>
          <button
            onClick={onForceFail}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-4 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-red-500 font-medium transition-colors border border-red-500/20 col-span-2 disabled:opacity-50"
          >
            <AlertOctagon className="w-4 h-4" />
            Force Fail Workflow
          </button>
        </div>

        {/* Edit State Form */}
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2 text-slate-300">
            <Terminal className="w-4 h-4" />
            <span className="text-sm font-medium">Manual State Patch</span>
          </div>

          <form onSubmit={handleSubmit(onEditState)} className="space-y-4">
            <div>
              <input
                {...register("stepId")}
                placeholder="Target Step ID"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 mb-2"
              />
              <div className="relative">
                <textarea
                  {...register("newStateJson", {
                    required: true,
                    validate: (v) => {
                      try {
                        JSON.parse(v);
                        return true;
                      } catch {
                        return "Invalid JSON";
                      }
                    },
                  })}
                  className="w-full h-48 bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-sm text-green-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                />
                {errors.newStateJson && (
                  <span className="absolute bottom-4 right-4 text-xs text-red-500 bg-slate-900 px-2 py-1 rounded">
                    {errors.newStateJson.message || "Invalid JSON"}
                  </span>
                )}
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Apply Patch
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
