import { 
  MessageSquare, 
  Settings, 
  Code, 
  Heart 
} from "lucide-react";

const BusinessInquirySection: React.FC = () => {
  return (
    <section className="py-32 bg-gradient-to-br from-blue-50/80 via-purple-50/60 to-pink-50/80 dark:from-blue-950/80 dark:via-purple-950/60 dark:to-pink-950/80 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-100/30 via-purple-100/20 to-pink-100/30 dark:from-blue-900/30 dark:via-purple-900/20 dark:to-pink-900/30"></div>

      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-r from-blue-400/10 to-purple-400/10 rounded-full blur-2xl animate-pulse-slow"></div>
        <div
          className="absolute -bottom-20 -left-20 w-40 h-40 bg-gradient-to-r from-purple-400/10 to-pink-400/10 rounded-full blur-2xl animate-pulse-slow"
          style={{ animationDelay: "1.5s" }}
        ></div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-blue-100/80 to-purple-100/80 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-200 text-sm font-medium mb-6">
            <MessageSquare className="w-4 h-4 mr-2" />
            Enterprise Solutions
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-6">
            Need Runner for Your Enterprise?
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-12">
            From proof-of-concept to production deployment, we help
            enterprises adopt Runner successfully with custom training,
            migration support, and ongoing consultation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="card p-8 text-center group hover:scale-105 transition-all duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <Settings className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Custom Training
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Hands-on workshops and training sessions tailored to your team's
              needs and existing codebase.
            </p>
          </div>

          <div className="card p-8 text-center group hover:scale-105 transition-all duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-r from-purple-500 to-pink-600 rounded-full flex items-center justify-center">
              <Code className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Migration Support
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Strategic guidance and hands-on assistance for migrating
              existing applications to Runner architecture.
            </p>
          </div>

          <div className="card p-8 text-center group hover:scale-105 transition-all duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-r from-pink-500 to-red-600 rounded-full flex items-center justify-center">
              <Heart className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Ongoing Support
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Priority support, architectural reviews, and performance
              optimization for mission-critical applications.
            </p>
          </div>
        </div>

        <div className="card p-10">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Let's Build Something Great Together
            </h3>
            <p className="text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Whether you're evaluating Runner for a new project or planning a
              large-scale migration, we're here to ensure your success.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-center items-center">
            <div className="text-center sm:text-left">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Reach out directly:
              </p>
              <a
                href="mailto:theodor@bluelibs.com"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
              >
                theodor@bluelibs.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default BusinessInquirySection;