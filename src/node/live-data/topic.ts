import { validationError } from "../../errors";
import type { LiveTopic } from "./types";

const MAX_TOPIC_SEGMENTS = 32;
const MAX_TOPIC_SEGMENT_LENGTH = 256;

/** Creates an exact, structured live-data topic. */
export function topic(...segments: string[]): LiveTopic {
  if (segments.length === 0 || segments.length > MAX_TOPIC_SEGMENTS) {
    return validationError.throw({
      subject: "Live topic",
      id: "liveData",
      originalError: `Topics require between 1 and ${MAX_TOPIC_SEGMENTS} segments.`,
    });
  }

  for (const segment of segments) {
    if (
      typeof segment !== "string" ||
      segment.length === 0 ||
      segment.length > MAX_TOPIC_SEGMENT_LENGTH
    ) {
      return validationError.throw({
        subject: "Live topic",
        id: "liveData",
        originalError: `Topic segments must be non-empty strings of at most ${MAX_TOPIC_SEGMENT_LENGTH} characters.`,
      });
    }
  }

  return Object.freeze({ segments: Object.freeze([...segments]) });
}

export function topicKey(value: LiveTopic): string {
  if (!value || !Array.isArray(value.segments)) {
    return validationError.throw({
      subject: "Live topic",
      id: "liveData",
      originalError: "Expected a topic created by live.topic(...segments).",
    });
  }

  topic(...value.segments);
  return JSON.stringify(value.segments);
}

export function normalizeTopics(
  values: LiveTopic | readonly LiveTopic[],
): readonly LiveTopic[] {
  const topics = Array.isArray(values) ? values : [values];
  if (topics.length === 0) {
    return validationError.throw({
      subject: "Live query topics",
      id: "liveData",
      originalError: "Every live query must observe at least one topic.",
    });
  }

  const unique = new Map<string, LiveTopic>();
  for (const value of topics) unique.set(topicKey(value), value);
  return [...unique.values()];
}
