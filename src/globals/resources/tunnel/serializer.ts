export interface Serializer {
  stringify(value: unknown): string;
  parse<T = unknown>(text: string): T;
}

export const JsonSerializer: Serializer = {
  stringify(value: unknown): string {
    return JSON.stringify(value);
  },
  parse<T = unknown>(text: string): T {
    return JSON.parse(text) as T;
  },
};

// Placeholder for future EJSON default detection.
// For now, default to JSON; if an external EJSON becomes available,
// we can attempt dynamic resolution here.
export function getDefaultSerializer(): Serializer {
  return JsonSerializer;
}
