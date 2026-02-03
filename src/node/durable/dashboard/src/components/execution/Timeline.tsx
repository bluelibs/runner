import { CheckCircle2, Clock, XCircle, AlertOctagon } from "lucide-react";
import { ExecutionStatus } from "@/api";

export type TimelineStep = {
  id: string;
  name: string;
  status: ExecutionStatus;
  duration?: string;
  errorMessage?: string;
};

type TimelineProps = {
  steps: TimelineStep[];
};

type StatusIconProps = {
  status: ExecutionStatus;
  className?: string;
};

function StatusIcon({ status, className = "" }: StatusIconProps) {
  switch (status) {
    case ExecutionStatus.Completed:
      return <CheckCircle2 className={`text-green-500 ${className}`} />;
    case ExecutionStatus.Running:
      return <Clock className={`text-blue-500 animate-spin ${className}`} />;
    case ExecutionStatus.Failed:
      return <XCircle className={`text-red-500 ${className}`} />;
    case ExecutionStatus.Cancelled:
      return <XCircle className={`text-slate-400 ${className}`} />;
    case ExecutionStatus.CompensationFailed:
      return (
        <AlertOctagon className={`text-pink-500 animate-pulse ${className}`} />
      );
    default:
      return (
        <div
          className={`w-5 h-5 rounded-full border-2 border-slate-700 ${className}`}
        />
      );
  }
}

export function Timeline({ steps }: TimelineProps) {
  return (
    <div className="space-y-8 relative">
      <div className="absolute left-[19px] top-6 bottom-6 w-0.5 bg-slate-800" />

      {steps.map((step) => (
        <div key={step.id} className="relative flex items-start group">
          <div className="relative z-10 bg-slate-900 ring-4 ring-slate-900 rounded-full">
            <StatusIcon status={step.status} className="w-10 h-10" />
          </div>

          <div className="ml-6 flex-1 bg-slate-900 border border-slate-800 rounded-lg p-4 group-hover:border-slate-700 transition-colors cursor-pointer">
            <div className="flex items-center justify-between">
              <h4
                className={`font-mono font-medium ${step.status === ExecutionStatus.CompensationFailed ? "text-pink-500" : "text-slate-200"}`}
              >
                {step.name}
              </h4>
              <span className="text-xs text-slate-500 font-mono">
                {step.duration}
              </span>
            </div>
            {step.errorMessage && (
              <div className="mt-3 text-sm text-red-400 bg-red-500/5 p-2 rounded border border-red-500/10">
                {step.errorMessage}
              </div>
            )}
            {step.status === ExecutionStatus.CompensationFailed && (
              <div className="mt-3 text-sm text-pink-400 bg-pink-500/5 p-2 rounded border border-pink-500/10">
                Critical Error: Compensation logic failed. Manual intervention
                required.
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
