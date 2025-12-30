import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { ExecutionDetail } from '@/pages/ExecutionDetail';
import { Schedules } from '@/pages/Schedules';

function App() {
  return (
    <BrowserRouter basename="/durable">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/executions" element={<Dashboard />} />
          <Route path="/executions/:id" element={<ExecutionDetail />} />
          <Route path="/schedules" element={<Schedules />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
