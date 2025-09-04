import React, { useState, useRef, useCallback } from "react";
import { X, ZoomIn } from "lucide-react";

interface IntelligentZoomImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  gradient?: string;
}

const IntelligentZoomImage: React.FC<IntelligentZoomImageProps> = ({
  src,
  alt,
  className = "",
  containerClassName = "",
  gradient = "from-blue-500 to-purple-600",
}) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleZoomToggle = useCallback(() => {
    setIsZoomed(!isZoomed);
    if (!isZoomed) {
      // Prevent body scroll when zoomed
      document.body.style.overflow = "hidden";
    } else {
      // Restore body scroll
      document.body.style.overflow = "unset";
    }
  }, [isZoomed]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && isZoomed) {
      handleZoomToggle();
    }
  }, [isZoomed, handleZoomToggle]);

  React.useEffect(() => {
    if (isZoomed) {
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "unset";
      };
    }
  }, [isZoomed, handleKeyDown]);

  return (
    <>
      {/* Main Image Container */}
      <div
        className={`relative overflow-hidden rounded-xl shadow-2xl cursor-zoom-in ${containerClassName}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleZoomToggle}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className={`w-full h-auto transition-transform duration-500 hover:scale-105 ${className}`}
        />
        
        {/* Hover overlay with zoom indicator */}
        <div
          className={`absolute inset-0 bg-black/20 rounded-xl flex items-center justify-center transition-opacity duration-300 ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
            <ZoomIn className="w-8 h-8 text-white" />
          </div>
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent"></div>
        
        {/* Floating elements */}
        <div className="absolute -top-4 -right-4 w-8 h-8 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full opacity-80 animate-pulse"></div>
        <div
          className="absolute -bottom-4 -left-4 w-6 h-6 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full opacity-60 animate-pulse"
          style={{ animationDelay: "1s" }}
        ></div>
      </div>

      {/* Full Screen Zoom Modal */}
      {isZoomed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
          {/* Close button */}
          <button
            onClick={handleZoomToggle}
            className="absolute top-6 right-6 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-3 transition-all duration-200 hover:scale-110"
            aria-label="Close zoom view"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {/* ESC hint */}
          <div className="absolute top-6 left-6 z-10 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
            <span className="text-white text-sm font-medium">Press ESC to close</span>
          </div>

          {/* Zoomed image container */}
          <div 
            className="relative max-w-[95vw] max-h-[95vh] cursor-zoom-out"
            onClick={handleZoomToggle}
          >
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-300"
            />
            
            {/* Subtle glow around zoomed image */}
            <div className={`absolute -inset-4 bg-gradient-to-r ${gradient} rounded-2xl blur-xl opacity-30 -z-10`}></div>
          </div>

          {/* Click outside to close overlay */}
          <div 
            className="absolute inset-0 -z-10"
            onClick={handleZoomToggle}
          />
        </div>
      )}
    </>
  );
};

export default IntelligentZoomImage;