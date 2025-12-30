import { LayoutDashboard, Activity, CalendarClock, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

// Inline utility for now to save a file creation step, or can create lib/utils.ts
function classNames(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Sidebar() {
  const navItems = [
    { icon: LayoutDashboard, label: 'Overview', to: '/' },
    { icon: Activity, label: 'Executions', to: '/executions' },
    { icon: CalendarClock, label: 'Schedules', to: '/schedules' },
  ];

  return (
    <aside className="w-16 md:w-64 border-r border-slate-800 bg-slate-950 flex flex-col">
      <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-slate-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
           <span className="font-bold text-white">D</span>
        </div>
        <span className="ml-3 font-bold text-slate-100 hidden md:block">Durable</span>
      </div>

      <nav className="flex-1 py-6 space-y-2 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              classNames(
                "flex items-center px-4 py-3 rounded-lg transition-colors group",
                isActive 
                  ? "bg-blue-600/10 text-blue-500" 
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
              )
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="ml-3 font-medium hidden md:block">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <button className="flex items-center text-slate-400 hover:text-slate-100 transition-colors w-full px-4 py-2">
          <Settings className="w-5 h-5" />
          <span className="ml-3 hidden md:block">Settings</span>
        </button>
      </div>
    </aside>
  );
}
