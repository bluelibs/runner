import React, { useState, useEffect } from "react";
import { ConsentContext } from "./useConsent";

interface ConsentProviderProps {
  children: React.ReactNode;
}

export const ConsentProvider: React.FC<ConsentProviderProps> = ({
  children,
}) => {
  const [hasAnalyticsConsent, setHasAnalyticsConsent] = useState<
    boolean | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing consent choice on mount
    const checkExistingConsent = () => {
      try {
        const consentChoice = localStorage.getItem("analytics-consent");
        if (consentChoice) {
          setHasAnalyticsConsent(consentChoice === "accepted");
        }
      } catch (error) {
        console.warn("Failed to read consent from localStorage:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkExistingConsent();
  }, []);

  const setAnalyticsConsent = (consent: boolean) => {
    try {
      localStorage.setItem(
        "analytics-consent",
        consent ? "accepted" : "rejected",
      );
      setHasAnalyticsConsent(consent);

      // Update Google Analytics consent
      if (typeof window !== "undefined" && window.gtag) {
        window.gtag("consent", "update", {
          analytics_storage: consent ? "granted" : "denied",
        });
      }
    } catch (error) {
      console.error("Failed to save consent to localStorage:", error);
    }
  };

  return (
    <ConsentContext.Provider
      value={{
        hasAnalyticsConsent,
        setAnalyticsConsent,
        isLoading,
      }}
    >
      {children}
    </ConsentContext.Provider>
  );
};

// // Type declaration for gtag
// declare global {
//   interface Window {
//     gtag?: (...args: any[]) => void;
//   }
// }
