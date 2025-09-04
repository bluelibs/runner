import { Link } from "react-router-dom";
import { Zap, GitBranch } from "lucide-react";

const CtaSection: React.FC = () => {
  return (
    <section className="py-32">
      <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-8">
          Ready to Stop Worrying?
        </h2>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-12">
          Join the developers who've already made the switch to cleaner, more
          maintainable TypeScript applications.
        </p>
        <div className="flex flex-col sm:flex-row gap-6 justify-center">
          <Link to="/quick-start" className="btn-primary text-lg px-8 py-4">
            <Zap className="w-6 h-6 mr-2" />
            Get Started Now
          </Link>
          <a
            href="https://github.com/bluelibs/runner"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-lg px-8 py-4"
          >
            <GitBranch className="w-6 h-6 mr-2" />
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
};

export default CtaSection;
