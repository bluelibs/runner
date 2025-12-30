import { Sidebar } from './Sidebar';
import { Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-950/50">
        <div className="container mx-auto p-6 max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
