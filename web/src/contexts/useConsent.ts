import { createContext, useContext } from "react";

interface ConsentContextType {
  hasAnalyticsConsent: boolean | null;
  setAnalyticsConsent: (consent: boolean) => void;
  isLoading: boolean;
}

export const ConsentContext = createContext<ConsentContextType | undefined>(
  undefined,
);

export const useConsent = () => {
  const context = useContext(ConsentContext);
  if (context === undefined) {
    throw new Error("useConsent must be used within a ConsentProvider");
  }
  return context;
};
