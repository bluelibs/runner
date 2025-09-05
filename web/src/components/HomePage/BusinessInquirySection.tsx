import * as React from "react";
import { Building2, Settings, Code, Shield, Mail } from "lucide-react";

const BusinessInquirySection: React.FC = () => {
  return (
    <section
      id="enterprise"
      className="py-24 bg-gray-900 dark:bg-gray-950 relative overflow-hidden scroll-mt-20"
    >
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/10 to-purple-900/10"></div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-12">
          <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 text-blue-300 text-xs font-medium mb-4">
            <Building2 className="w-3 h-3 mr-1.5" />
            Enterprise Solutions
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Enterprise-Grade Solutions
          </h2>
          <p className="text-base text-gray-400 max-w-2xl mx-auto">
            Scale Runner across your organization with dedicated support,
            professional services, and enterprise-grade security.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6 text-center group hover:border-blue-500/30 hover:bg-gray-800/40 transition-all duration-300">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-lg flex items-center justify-center">
              <Settings className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-lg font-medium text-white mb-3">
              Professional Training
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Comprehensive onboarding programs, best practices workshops, and
              technical certification for your development teams.
            </p>
          </div>

          <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6 text-center group hover:border-purple-500/30 hover:bg-gray-800/40 transition-all duration-300">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg flex items-center justify-center">
              <Code className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="text-lg font-medium text-white mb-3">
              Migration Services
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Strategic planning and execution support for migrating legacy
              systems to Runner with minimal business disruption.
            </p>
          </div>

          <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6 text-center group hover:border-green-500/30 hover:bg-gray-800/40 transition-all duration-300">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-lg font-medium text-white mb-3">
              Enterprise Support
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              24/7 priority support, SLA guarantees, architectural reviews, and
              dedicated technical account management.
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-gray-800/20 to-gray-700/20 border border-gray-700/30 rounded-xl p-8">
          <div className="text-center mb-6">
            <h3 className="text-xl font-medium text-white mb-3">
              Ready to Scale Your Enterprise?
            </h3>
            <p className="text-sm text-gray-400 max-w-xl mx-auto">
              Contact our enterprise team to discuss your requirements and get a
              custom proposal.
            </p>
          </div>

          <div className="flex justify-center">
            <div className="inline-flex items-center bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-3 hover:border-blue-500/30 hover:bg-gray-800/70 transition-all duration-300 group">
              <Mail className="w-4 h-4 text-blue-400 mr-2 group-hover:text-blue-300" />
              <div className="text-left">
                <a
                  href="mailto:theodor@bluelibs.com"
                  className="text-sm text-gray-300 hover:text-white transition-colors"
                >
                  theodor@bluelibs.com
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default BusinessInquirySection;
