import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { ExecutionDetail } from "@/pages/ExecutionDetail";
import { Schedules } from "@/pages/Schedules";
import { getDashboardBasePath } from "./basePath";

function App() {
  const basePath = getDashboardBasePath();

  return (
    <BrowserRouter basename={basePath || undefined}>
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
