import { Store } from '../Store';
import { EventManager } from '../EventManager';
import { IResource, ITask, IEventDefinition, IMiddleware } from '../defs';
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
      events: {
        beforeRun: { id: 'beforeRun' },
        afterRun: { id: 'afterRun' },
        onError: { id: 'onError' },
      },
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
