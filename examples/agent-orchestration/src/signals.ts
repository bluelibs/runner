import { r } from "@bluelibs/runner";

export const ReviewDecision = r
  .event<{
    decision: "approve" | "revise";
    reviewer: string;
    feedback?: string;
  }>("reviewDecision")
  .build();

export const RevisedDraft = r
  .event<{ summary: string; author: string }>("revisedDraft")
  .build();

export const StressPolicyDecision = r
  .event<{
    decision: "approve" | "revise" | "abort";
    reviewer: string;
    feedback?: string;
  }>("stressPolicyDecision")
  .build();

export const StressRevisionDraft = r
  .event<{ summary: string; citations: number; author: string }>(
    "stressRevisionDraft",
  )
  .build();

export const ComplianceDecision = r
  .event<{
    decision: "proceed" | "reject";
    reviewer: string;
    note?: string;
  }>("complianceDecision")
  .build();
