import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";

interface CodeBlockProps {
  children: string;
  language?: string;
  className?: string;
  variant?: "diff" | "regal" | "glass" | "brushed" | "minimal" | "premium";
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  children,
  language = "typescript",
  className = "",
  variant = "premium",
}) => {
  const [copied, setCopied] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (variant !== "premium") return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Gold palettes and variant styles
  const goldPrimary = "#d4af37"; // classic gold
  const goldLight = "#f5d76e"; // highlight
  const goldDeep = "#b8860b"; // deep accent

  const outerStyleMap: Record<
    Required<CodeBlockProps>["variant"],
    React.CSSProperties
  > = {
    diff: {},
    regal: {
      background: `conic-gradient(from 140deg at 50% 50%, ${goldLight}, ${goldPrimary}, ${goldDeep}, ${goldLight})`,
      boxShadow: "0 0 0 1px rgba(212,175,55,0.25), 0 10px 30px rgba(0,0,0,0.6)",
    },
    glass: {
      background: `linear-gradient(180deg, rgba(245,215,110,0.9), rgba(212,175,55,0.55))`,
      boxShadow:
        "0 2px 18px rgba(212,175,55,0.25), 0 12px 34px rgba(0,0,0,0.55)",
    },
    brushed: {
      background: `repeating-linear-gradient(135deg, ${goldPrimary}, ${goldPrimary} 8px, ${goldDeep} 8px, ${goldDeep} 16px)`,
      filter: "saturate(0.95)",
      boxShadow:
        "0 0 0 1px rgba(212,175,55,0.25), 0 10px 24px rgba(0,0,0,0.55)",
    },
    minimal: {
      background: `linear-gradient(90deg, ${goldLight}, ${goldPrimary})`,
      boxShadow: "0 0 0 1px rgba(212,175,55,0.35)",
    },
    premium: {
      background: "transparent",
    },
  };

  const innerStyleMap: Record<
    Required<CodeBlockProps>["variant"],
    React.CSSProperties
  > = {
    diff: {},
    regal: {
      background: `linear-gradient(135deg, rgba(230,198,91,0.95), rgba(184,134,11,0.95))`,
    },
    glass: {
      background: `linear-gradient(180deg, rgba(245,215,110,0.35), rgba(245,215,110,0.15))`,
    },
    brushed: {
      background: `linear-gradient(135deg, rgba(245,215,110,0.6), rgba(184,134,11,0.6))`,
    },
    minimal: {
      background: `linear-gradient(90deg, rgba(245,215,110,0.75), rgba(212,175,55,0.75))`,
    },
    premium: {
      background: "transparent",
    },
  };

  const contentStyleMap: Record<
    Required<CodeBlockProps>["variant"],
    React.CSSProperties
  > = {
    diff: {
      background:
        "radial-gradient(900px 600px at 85% 85%, rgba(255,255,255,0.05), rgba(255,255,255,0) 45%), linear-gradient(135deg, #1a093d 0%, #161c5e 48%, #0b2a7a 100%)",
      border: "none",
      borderRadius: "0.9rem",
      overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)",
    },
    regal: {
      background:
        "radial-gradient(1200px 400px at 10% -10%, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%), linear-gradient(135deg, #1a1446 0%, #0a1a5e 60%, #061334 100%)",
      border: "none",
      borderRadius: "0.75rem",
      overflow: "hidden",
      boxShadow:
        "inset 0 0 0 1px rgba(255,255,255,0.04), inset 0 -20px 60px rgba(0,0,0,0.35)",
    },
    glass: {
      background:
        "linear-gradient(135deg, rgba(12,18,44,0.75), rgba(6,14,34,0.85)), radial-gradient(700px 300px at 10% -10%, rgba(255,255,255,0.08), transparent 50%)",
      border: "1px solid rgba(245,215,110,0.25)",
      backdropFilter: "blur(6px)",
      borderRadius: "0.9rem",
      overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)",
    },
    brushed: {
      background:
        "linear-gradient(135deg, #161a3a 0%, #0d1740 50%, #0a1a5e 100%)",
      border: "none",
      borderRadius: "0.75rem",
      overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)",
    },
    minimal: {
      background: "linear-gradient(135deg, #171a2f, #0d1430)",
      border: "1px solid rgba(212,175,55,0.25)",
      borderRadius: "0.6rem",
      overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
    },
    premium: {
      background:
        "radial-gradient(1000px 400px at 20% -10%, rgba(139,92,246,0.12), rgba(99,102,241,0.08) 30%, transparent 70%), linear-gradient(135deg, #0f0a1a 0%, #1a0f2e 40%, #2a1a4a 100%)",
      border: "none",
      backdropFilter: "blur(8px)",
      borderRadius: "0.875rem",
      overflow: "hidden",
      boxShadow: "none",
      position: "relative",
      transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
    },
  };

  const buttonBaseClass =
    "absolute top-2 right-2 z-10 p-2 rounded-md transition-colors duration-200";
  const buttonClassMap: Record<
    Required<CodeBlockProps>["variant"],
    {
      className: string;
      style?: React.CSSProperties;
      iconCopiedClass?: string;
    }
  > = {
    diff: {
      className: `${buttonBaseClass} text-slate-200 hover:text-white`,
      style: {
        background: "rgba(10, 12, 24, 0.55)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(6px)",
      },
      iconCopiedClass: "text-emerald-300",
    },
    regal: {
      className: `${buttonBaseClass} text-amber-200 hover:text-amber-100`,
      style: {
        background: "rgba(8, 10, 18, 0.55)",
        border: "1px solid rgba(245, 215, 110, 0.25)",
        backdropFilter: "blur(6px)",
      },
      iconCopiedClass: "text-amber-300",
    },
    glass: {
      className: `${buttonBaseClass} text-amber-200 hover:text-amber-100`,
      style: {
        background: "rgba(12,16,34,0.55)",
        border: "1px solid rgba(245,215,110,0.25)",
        backdropFilter: "blur(8px)",
      },
      iconCopiedClass: "text-amber-300",
    },
    brushed: {
      className: `${buttonBaseClass} text-amber-100 hover:text-amber-50`,
      style: {
        background: "rgba(10,14,30,0.6)",
        border: "1px solid rgba(212,175,55,0.25)",
        backdropFilter: "blur(4px)",
      },
      iconCopiedClass: "text-amber-200",
    },
    minimal: {
      className: `${buttonBaseClass} text-amber-100 hover:text-amber-50`,
      style: {
        background: "rgba(8,12,24,0.5)",
        border: "1px solid rgba(212,175,55,0.2)",
      },
      iconCopiedClass: "text-amber-200",
    },
    premium: {
      className: `${buttonBaseClass} text-purple-200 hover:text-purple-100`,
      style: {
        background: "rgba(15,10,26,0.65)",
        border: "1px solid rgba(139,92,246,0.3)",
        backdropFilter: "blur(10px)",
        boxShadow:
          "0 0 0 0.5px rgba(255,255,255,0.1), 0 4px 12px rgba(139,92,246,0.15)",
      },
      iconCopiedClass: "text-purple-300",
    },
  };

  if (variant === "diff") {
    return (
      <div className={`relative rounded-xl overflow-hidden ${className}`}>
        <button
          onClick={copyToClipboard}
          className={buttonClassMap[variant].className}
          style={buttonClassMap[variant].style}
          title="Copy to clipboard"
        >
          {copied ? (
            <Check
              className={`w-4 h-4 ${
                buttonClassMap[variant].iconCopiedClass || ""
              }`}
            />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: "1.05rem",
            fontSize: "0.9rem",
            lineHeight: "1.6",
            ...contentStyleMap[variant],
          }}
          showLineNumbers={false}
          wrapLines={true}
          wrapLongLines={true}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <div
        className="relative rounded-2xl p-[2px]"
        style={outerStyleMap[variant]}
      >
        <div className="rounded-xl p-[2px]" style={innerStyleMap[variant]}>
          <div 
            className="relative rounded-lg overflow-hidden group"
            onMouseMove={handleMouseMove}
          >
            {/* Subtle hover gradient overlay */}
            {variant === "premium" && (
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out pointer-events-none z-[1]">
                <div 
                  className="absolute inset-0 transition-all duration-200 ease-out"
                  style={{
                    background: `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, rgba(139,92,246,0.08), rgba(59,130,246,0.04), transparent 50%)`
                  }}
                />
              </div>
            )}
            <button
              onClick={copyToClipboard}
              className={buttonClassMap[variant].className}
              style={buttonClassMap[variant].style}
              title="Copy to clipboard"
            >
              {copied ? (
                <Check
                  className={`w-4 h-4 ${
                    buttonClassMap[variant].iconCopiedClass || ""
                  }`}
                />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
            <SyntaxHighlighter
              language={language}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: "1.05rem",
                fontSize: "0.9rem",
                lineHeight: "1.6",
                ...contentStyleMap[variant],
              }}
              showLineNumbers={false}
              wrapLines={true}
              wrapLongLines={true}
            >
              {children}
            </SyntaxHighlighter>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeBlock;
