import { Link } from "react-router-dom";
import Meta from "../components/Meta";

const NotFoundPage: React.FC = () => {
  return (
    <div className="pt-24 pb-16">
      <Meta title="Page not found — Runner" description="The page you are looking for doesn’t exist." />
      <div className="max-w-2xl mx-auto text-center px-4">
        <h1 className="text-4xl font-bold text-white mb-4">404 — Not Found</h1>
        <p className="text-gray-400 mb-8">
          The page you’re after has been moved or doesn’t exist. Try our docs
          or go back home.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to="/" className="btn-primary">Home</Link>
          <Link to="/docs" className="btn-secondary">Docs</Link>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
