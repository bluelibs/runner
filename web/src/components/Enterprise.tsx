import { ArrowRight, Brain, Layers, Settings, Shield } from "lucide-react";

const Enterprise: React.FC = () => {
  return (
    <section className="py-32 bg-gradient-to-br from-gray-950/80 via-slate-900/70 to-gray-900/80 relative overflow-hidden">
      {/* Subtle Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-r from-slate-400/5 to-gray-400/5 rounded-full blur-3xl animate-pulse-slow"></div>
        <div
          className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-r from-gray-400/5 to-slate-400/5 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: "1.2s" }}
        ></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 text-gray-300 text-sm font-medium mb-8">
            <Shield className="w-4 h-4 mr-2 text-gray-400" />
            Enterprise Solutions
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-8">
            Need Something Custom?
          </h2>
          <p className="text-lg text-gray-400 max-w-4xl mx-auto mb-12 leading-relaxed">
            Whether it's custom integrations, specialized tooling, or enterprise-grade features,
            let's build the perfect development solution for your team.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-16">
          <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-xl p-8 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-500 group">
            <div className="w-10 h-10 bg-gradient-to-r from-slate-600/50 to-gray-600/50 rounded-lg flex items-center justify-center mb-6 group-hover:from-slate-500/60 group-hover:to-gray-500/60 transition-all duration-300">
              <Brain className="w-5 h-5 text-gray-300" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-4">Custom AI Integration</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Tailored AI assistants with your specific workflows, custom prompts, and specialized automation for your development processes.
            </p>
          </div>
          
          <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-xl p-8 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-500 group">
            <div className="w-10 h-10 bg-gradient-to-r from-slate-600/50 to-gray-600/50 rounded-lg flex items-center justify-center mb-6 group-hover:from-slate-500/60 group-hover:to-gray-500/60 transition-all duration-300">
              <Layers className="w-5 h-5 text-gray-300" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-4">Enterprise Features</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Advanced security, SSO integration, audit logging, custom dashboards, and enterprise-grade monitoring solutions.
            </p>
          </div>
          
          <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-xl p-8 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-500 group">
            <div className="w-10 h-10 bg-gradient-to-r from-slate-600/50 to-gray-600/50 rounded-lg flex items-center justify-center mb-6 group-hover:from-slate-500/60 group-hover:to-gray-500/60 transition-all duration-300">
              <Settings className="w-5 h-5 text-gray-300" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-4">Custom Tooling</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Specialized development tools, custom visualizations, and bespoke integrations tailored to your unique requirements.
            </p>
          </div>
        </div>

        <div className="text-center">
          <a
            href="mailto:theodor@bluelibs.com?subject=Enterprise Runner Dev Tools Inquiry"
            className="inline-flex items-center px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white font-medium rounded-lg hover:bg-white/15 hover:border-white/30 transition-all duration-300 group"
          >
            <Brain className="w-5 h-5 mr-3 text-gray-300 group-hover:text-white transition-colors" />
            Let's Build Something Amazing
            <ArrowRight className="w-4 h-4 ml-3 text-gray-300 group-hover:text-white group-hover:translate-x-1 transition-all duration-300" />
          </a>
          <p className="text-gray-500 text-sm mt-4">
            Contact: <span className="text-gray-300">theodor@bluelibs.com</span>
          </p>
        </div>
      </div>
    </section>
  );
};

export default Enterprise;