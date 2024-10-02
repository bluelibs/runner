import { Store } from '../Store';
import { EventManager } from '../EventManager';
import { IResource, ITask, IEventDefinition, IMiddleware, IResourceWithConfig } from '../defs';
import { Errors } from '../errors';
import { globalResources } from '../globalResources';

// Mocks
jest.mock('../EventManager');
jest.mock('../errors');

describe('Store', () => {
  let eventManager: EventManager;
  let store: Store;

  beforeEach(() => {
    eventManager = new EventManager();
    store = new Store(eventManager);
  });

  describe('Initialization', () => {
    test('should initialize the store with root resource', () => {
      const rootResource: IResource = {
        id: 'root',
        run: jest.fn(),
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };
      const config = {};

      store.initializeStore(rootResource, config);

      expect(store.root.resource).toBe(rootResource);
      expect(store.resources.get('root')).toBeDefined();
      expect(store.resources.get('root')?.config).toEqual(config);
    });

    test('should throw error if initializing store twice', () => {
      const rootResource: IResource = {
        id: 'root',
        run: jest.fn(),
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };
      const config = {};

      store.initializeStore(rootResource, config);

      expect(() => store.initializeStore(rootResource, config)).toThrow(
        'Store is already initialized.'
      );
    });
  });

  describe('Item Storage', () => {
    test('should store a task', () => {
      const task: ITask = {
        id: 'testTask',
        run: jest.fn(),
        events: {
          beforeRun: { id: 'beforeRun' },
          afterRun: { id: 'afterRun' },
          onError: { id: 'onError' },
        },
      };

      store.storeGenericItem(task);

      const storedTask = store.tasks.get('testTask');
      expect(storedTask).toBeDefined();
      expect(storedTask?.task).toBe(task);
      expect(storedTask?.isInitialized).toBe(false);
    });

    test('should store a resource', () => {
      const resource: IResource = {
        id: 'testResource',
        run: jest.fn(),
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };

      store.storeGenericItem(resource);

      const storedResource = store.resources.get('testResource');
      expect(storedResource).toBeDefined();
      expect(storedResource?.resource).toBe(resource);
      expect(storedResource?.isInitialized).toBe(false);
    });

    test('should store a middleware', () => {
      const middleware: IMiddleware = {
        id: 'testMiddleware',
        run: jest.fn(),
        global: jest.fn(),
      };

      store.storeGenericItem(middleware);

      const storedMiddleware = store.middlewares.get('testMiddleware');
      expect(storedMiddleware).toBeDefined();
      expect(storedMiddleware?.middleware).toBe(middleware);
    });

    test('should store an event', () => {
      const event: IEventDefinition = { id: 'testEvent' };

      store.storeEvent(event);

      const storedEvent = store.events.get('testEvent');
      expect(storedEvent).toBeDefined();
      expect(storedEvent?.event).toBe(event);
    });

    test('should store a resource with config', () => {
      const resourceWithConfig: IResourceWithConfig = {
        resource: {
          id: 'testResourceWithConfig',
          run: jest.fn(),
          events: {
            beforeInit: { id: 'beforeInit' },
            afterInit: { id: 'afterInit' },
            onError: { id: 'onError' },
          },
          register: [],
        },
        config: { someConfig: 'value' },
      };

      store.storeGenericItem(resourceWithConfig);

      const storedResource = store.resources.get('testResourceWithConfig');
      expect(storedResource).toBeDefined();
      expect(storedResource?.resource).toBe(resourceWithConfig.resource);
      expect(storedResource?.config).toEqual(resourceWithConfig.config);
    });
  });

  describe('Error Handling', () => {
    test('should throw error on duplicate task registration', () => {
      const task: ITask = {
        id: 'duplicateTask',
        run: jest.fn(),
        events: {
          beforeRun: { id: 'beforeRun' },
          afterRun: { id: 'afterRun' },
          onError: { id: 'onError' },
        },
      };

      store.storeGenericItem(task);

      expect(() => store.storeGenericItem(task)).toThrow(
        Errors.duplicateRegistration('Task', 'duplicateTask')
      );
    });

    test('should throw error on duplicate resource registration', () => {
      const resource: IResource = {
        id: 'duplicateResource',
        run: jest.fn(),
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };

      store.storeGenericItem(resource);

      expect(() => store.storeGenericItem(resource)).toThrow(
        Errors.duplicateRegistration('Resource', 'duplicateResource')
      );
    });

    test('should throw error on duplicate event registration', () => {
      const event: IEventDefinition = { id: 'duplicateEvent' };

      store.storeEvent(event);

      expect(() => store.storeEvent(event)).toThrow(
        Errors.duplicateRegistration('Event', 'duplicateEvent')
      );
    });
  });

  describe('Store Locking', () => {
    test('should lock the store and prevent modifications', () => {
      const rootResource: IResource = {
        id: 'root',
        run: jest.fn(),
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };
      const config = {};

      store.initializeStore(rootResource, config);
      store.lock();

      const newTask: ITask = {
        id: 'newTask',
        run: jest.fn(),
        events: {
          beforeRun: { id: 'beforeRun' },
          afterRun: { id: 'afterRun' },
          onError: { id: 'onError' },
        },
      };

      expect(() => store.storeGenericItem(newTask)).toThrow(
        'Cannot modify the Store when it is locked.'
      );
    });

    test('should not allow modifications after locking', () => {
      store.lock();
      expect(store.isLocked).toBe(true);

      const event: IEventDefinition = { id: 'testEvent' };
      expect(() => store.storeEvent(event)).toThrow('Cannot modify the Store when it is locked.');
    });
  });

  describe('Resource Disposal', () => {
    test('should dispose resources', async () => {
      const disposeMock = jest.fn().mockResolvedValue(undefined);
      const resource: IResource = {
        id: 'resource1',
        run: jest.fn(),
        dispose: disposeMock,
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };

      store.storeGenericItem(resource);

      await store.dispose();

      expect(disposeMock).toHaveBeenCalledWith(
        undefined,
        {},
        {}
      );
    });

    test('should handle errors during resource disposal', async () => {
      const disposeMock = jest.fn().mockRejectedValue(new Error('Disposal error'));
      const resource: IResource = {
        id: 'resource1',
        run: jest.fn(),
        dispose: disposeMock,
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };

      store.storeGenericItem(resource);

      await expect(store.dispose()).rejects.toThrow('Disposal error');
    });
  });

  describe('Dependency Management', () => {
    test('should retrieve dependent nodes', () => {
      const task: ITask = {
        id: 'task1',
        run: jest.fn(),
        dependencies: { dep1: {} },
        events: {
          beforeRun: { id: 'beforeRun' },
          afterRun: { id: 'afterRun' },
          onError: { id: 'onError' },
        },
      };

      const middleware: IMiddleware = {
        id: 'middleware1',
        run: jest.fn(),
        global: jest.fn(),
      };

      const resource: IResource = {
        id: 'resource1',
        run: jest.fn(),
        dependencies: { dep2: {} },
        events: {
          beforeInit: { id: 'beforeInit' },
          afterInit: { id: 'afterInit' },
          onError: { id: 'onError' },
        },
        register: [],
      };

      store.storeGenericItem(task);
      store.storeGenericItem(middleware);
      store.storeGenericItem(resource);

      const dependentNodes = store.getDependentNodes();

      expect(dependentNodes).toContainEqual({
        id: 'task1',
        dependencies: { dep1: {} },
      });
      expect(dependentNodes).toContainEqual({
        id: 'middleware1',
        dependencies: undefined,
      });
      expect(dependentNodes).toContainEqual({
        id: 'resource1',
        dependencies: { dep2: {} },
      });
    });
  });

  describe('Global Middleware', () => {
    test('should get global middlewares', () => {
      const globalMiddleware: IMiddleware = {
        id: 'globalMiddleware',
        run: jest.fn(),
        global: jest.fn(),
        [Symbol.for('middlewareGlobal')]: true,
      };

      const localMiddleware: IMiddleware = {
        id: 'localMiddleware',
        run: jest.fn(),
        global: jest.fn(),
      };

      store.storeGenericItem(globalMiddleware);
      store.storeGenericItem(localMiddleware);

      const globalMiddlewares = store.getGlobalMiddlewares([]);
      expect(globalMiddlewares).toHaveLength(1);
      expect(globalMiddlewares[0]).toBe(globalMiddleware);
    });

    test('should exclude specified middleware IDs from global middlewares', () => {
      const globalMiddleware1: IMiddleware = {
        id: 'globalMiddleware1',
        run: jest.fn(),
        global: jest.fn(),
        [Symbol.for('middlewareGlobal')]: true,
      };

      const globalMiddleware2: IMiddleware = {
        id: 'globalMiddleware2',
        run: jest.fn(),
        global: jest.fn(),
        [Symbol.for('middlewareGlobal')]: true,
      };

      store.storeGenericItem(globalMiddleware1);
      store.storeGenericItem(globalMiddleware2);

      const globalMiddlewares = store.getGlobalMiddlewares(['globalMiddleware1']);
      expect(globalMiddlewares).toHaveLength(1);
      expect(globalMiddlewares[0]).toBe(globalMiddleware2);
    });
  });
});
