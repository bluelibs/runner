import { CalendarClock } from 'lucide-react';

export function Schedules() {
  return (
    <div className="flex flex-col items-center justify-center h-[50vh] text-slate-500 space-y-4">
      <CalendarClock className="w-16 h-16 opacity-20" />
      <h2 className="text-xl font-semibold">Schedules Coming Soon</h2>
      <p>Manage your CroninJobs here.</p>
    </div>
  );
}
