/**
 * Common metadata you can attach to tasks/resources/events/middleware.
 * Useful for docs, filtering and middleware decisions.
 */

export interface IMeta {
  title?: string;
  description?: string;
}

export interface ITaskMeta extends IMeta {}
export interface IResourceMeta extends IMeta {}
export interface IEventMeta extends IMeta {}
export interface IMiddlewareMeta extends IMeta {}
export interface ITagMeta extends IMeta {}
