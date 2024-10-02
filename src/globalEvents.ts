import { defineEvent } from "./define";
import { ITask, IResource } from "./defs";

export const globalEvents = {
  beforeInit: defineEvent({
    id: "global.beforeInit",
  }),
  afterInit: defineEvent({
    id: "global.afterInit",
  }),
  tasks: {
    beforeRun: defineEvent<{
      task: ITask<any, any, any>;
      input: any;
    }>({
      id: "global.tasks.beforeRun",
    }),
    afterRun: defineEvent<{
      task: ITask<any, any, any>;
      input: any;
      output: any;
    }>({
      id: "global.tasks.afterRun",
    }),
    onError: defineEvent<{
      error: Error;
      task: ITask<any, any, any>;
    }>({
      id: "global.tasks.onError",
    }),
  },
  resources: {
    beforeInit: defineEvent<{
      resource: IResource<any, any, any>;
      config: any;
    }>({
      id: "global.resources.beforeInit",
    }),
    afterInit: defineEvent<{
      resource: IResource<any, any, any>;
      config: any;
      value: any;
    }>({
      id: "global.resources.afterInit",
    }),
    onError: defineEvent<{
      error: Error;
      resource: IResource<any, any, any>;
    }>({
      id: "global.resources.onError",
    }),
  },
};

export const globalEventsArray = [
  globalEvents.beforeInit,
  globalEvents.afterInit,
  globalEvents.tasks.beforeRun,
  globalEvents.tasks.afterRun,
  globalEvents.tasks.onError,
  globalEvents.resources.beforeInit,
  globalEvents.resources.afterInit,
  globalEvents.resources.onError,
];
