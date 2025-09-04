import * as React from "react";
import { Building2, Settings, Code, Shield } from "lucide-react";

const BusinessInquirySection: React.FC = () => {
  return (
    <section
      id="enterprise"
      className="py-32 bg-gray-900 dark:bg-gray-950 relative overflow-hidden scroll-mt-20"
    >
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800/20 to-gray-700/20"></div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-800/80 dark:bg-gray-800/60 border border-gray-700/50 text-gray-300 text-sm font-medium mb-6">
            <Building2 className="w-4 h-4 mr-2" />
            Enterprise Solutions
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Enterprise-Grade Solutions
          </h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto mb-12">
            Scale Runner across your organization with dedicated support,
            professional services, and enterprise-grade security. From
            evaluation to production deployment.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="bg-gray-800/50 dark:bg-gray-800/30 border border-gray-700/50 rounded-xl p-8 text-center group hover:bg-gray-800/70 transition-all duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-gray-700 rounded-lg flex items-center justify-center">
              <Settings className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-4">
              Professional Training
            </h3>
            <p className="text-gray-300 leading-relaxed">
              Comprehensive onboarding programs, best practices workshops, and
              technical certification for your development teams.
            </p>
          </div>

          <div className="bg-gray-800/50 dark:bg-gray-800/30 border border-gray-700/50 rounded-xl p-8 text-center group hover:bg-gray-800/70 transition-all duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-gray-700 rounded-lg flex items-center justify-center">
              <Code className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-4">
              Migration Services
            </h3>
            <p className="text-gray-300 leading-relaxed">
              Strategic planning and execution support for migrating legacy
              systems to Runner with minimal business disruption.
            </p>
          </div>

          <div className="bg-gray-800/50 dark:bg-gray-800/30 border border-gray-700/50 rounded-xl p-8 text-center group hover:bg-gray-800/70 transition-all duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-gray-700 rounded-lg flex items-center justify-center">
              <Shield className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-4">
              Enterprise Support
            </h3>
            <p className="text-gray-300 leading-relaxed">
              24/7 priority support, SLA guarantees, architectural reviews, and
              dedicated technical account management.
            </p>
          </div>
        </div>

        <div className="bg-gray-800/30 dark:bg-gray-800/20 border border-gray-700/50 rounded-xl p-10">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-semibold text-white mb-4">
              Ready to Scale Your Enterprise?
            </h3>
            <p className="text-gray-300 max-w-2xl mx-auto">
              Contact our enterprise team to discuss your requirements, get a
              custom proposal, and schedule a technical consultation.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <div className="text-center">
              <p className="text-sm text-gray-400 mb-2">Enterprise Inquiries</p>
              <a
                href="mailto:theodor@bluelibs.com"
                className="inline-flex items-center px-6 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-100 transition-colors"
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
