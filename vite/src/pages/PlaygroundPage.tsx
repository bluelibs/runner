import { useState } from 'react';
import { 
  Play, 
  Copy, 
  Check, 
  RotateCcw, 
  Code, 
  Database, 
  MessageSquare, 
  Settings,
  Terminal,
  Lightbulb
} from 'lucide-react';
import CodeBlock from '../components/CodeBlock';

const PlaygroundPage: React.FC = () => {
  const [selectedExample, setSelectedExample] = useState('basic-task');
  const [code, setCode] = useState('');
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const examples = {
    'basic-task': {
      title: 'Basic Task',
      description: 'Simple task creation and execution',
      icon: Code,
      code: `import { task, run, resource } from '@bluelibs/runner';

// Create a simple task
const greetUser = task({
  id: 'app.tasks.greetUser',
  run: async (name: string) => {
    return \`Hello, \${name}! Welcome to BlueLibs Runner.\`;
  }
});

// Create a root resource to register the task
const app = resource({
  id: 'app',
  register: [greetUser],
  dependencies: { greetUser },
  init: async (_, { greetUser }) => {
    // Execute the task
    const greeting = await greetUser('World');
    console.log(greeting);
    return greeting;
  }
});

// Run the application
const { dispose, value } = await run(app);
console.log('App result:', value);

// Clean up resources
await dispose();`
    },
    'task-with-deps': {
      title: 'Task with Dependencies',
      description: 'Tasks using dependency injection',
      icon: Database,
      code: `import { task, resource, run } from '@bluelibs/runner';

// Create a logger resource
const logger = resource({
  id: 'app.logger',
  init: async () => ({
    info: (message: string) => console.log(\`[INFO] \${message}\`),
    error: (message: string) => console.log(\`[ERROR] \${message}\`)
  })
});

// Create a database mock resource
const database = resource({
  id: 'app.database',
  dependencies: { logger },
  init: async (_, { logger }) => {
    logger.info('Database connected');
    return {
      users: [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' }
      ]
    };
  }
});

// Task that uses both dependencies
const getUserById = task({
  id: 'app.tasks.getUserById',
  dependencies: { database, logger },
  run: async (userId: number, { database, logger }) => {
    logger.info(\`Looking up user with ID: \${userId}\`);
    const user = database.users.find(u => u.id === userId);
    
    if (user) {
      logger.info(\`Found user: \${user.name}\`);
      return user;
    } else {
      logger.error(\`User not found with ID: \${userId}\`);
      throw new Error('User not found');
    }
  }
});

const app = resource({
  id: 'app',
  register: [logger, database, getUserById],
  dependencies: { getUserById },
  init: async (_, { getUserById }) => {
    try {
      const user = await getUserById(1);
      return { success: true, user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

const { dispose, value } = await run(app);
console.log('Result:', value);
await dispose();`
    },
    'events': {
      title: 'Events & Hooks',
      description: 'Event-driven communication',
      icon: MessageSquare,
      code: `import { event, hook, task, resource, run } from '@bluelibs/runner';

// Define an event
const userRegistered = event<{ userId: string; email: string }>({
  id: 'app.events.userRegistered'
});

// Create hooks to listen for events
const sendWelcomeEmail = hook({
  id: 'app.hooks.sendWelcomeEmail',
  on: userRegistered,
  run: async (eventData) => {
    console.log(\`📧 Sending welcome email to \${eventData.data.email}\`);
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(\`✅ Welcome email sent!\`);
  }
});

const logUserRegistration = hook({
  id: 'app.hooks.logUserRegistration',
  on: userRegistered,
  run: async (eventData) => {
    console.log(\`📝 Logging registration for user \${eventData.data.userId}\`);
  }
});

// Task that emits events
const registerUser = task({
  id: 'app.tasks.registerUser',
  dependencies: { userRegistered },
  run: async (userData: { name: string; email: string }, { userRegistered }) => {
    const userId = Math.random().toString(36).substring(2, 15);
    
    console.log(\`🔄 Registering user: \${userData.name}\`);
    
    // Simulate user creation
    const user = {
      id: userId,
      name: userData.name,
      email: userData.email,
      createdAt: new Date()
    };
    
    // Emit the event - hooks will automatically be triggered
    await userRegistered({ userId: user.id, email: user.email });
    
    return user;
  }
});

const app = resource({
  id: 'app',
  register: [userRegistered, sendWelcomeEmail, logUserRegistration, registerUser],
  dependencies: { registerUser },
  init: async (_, { registerUser }) => {
    const user = await registerUser({
      name: 'Alice Johnson',
      email: 'alice@example.com'
    });
    
    return { message: 'User registered successfully', user };
  }
});

const { dispose, value } = await run(app);
console.log('Final result:', value);
await dispose();`
    },
    'middleware': {
      title: 'Middleware',
      description: 'Cross-cutting concerns with middleware',
      icon: Settings,
      code: `import { task, taskMiddleware, resource, run } from '@bluelibs/runner';

// Create logging middleware
const loggingMiddleware = taskMiddleware({
  id: 'app.middleware.logging',
  run: async ({ task, next }) => {
    const start = Date.now();
    console.log(\`🚀 Starting task: \${task.definition.id}\`);
    
    try {
      const result = await next(task.input);
      const duration = Date.now() - start;
      console.log(\`✅ Task completed in \${duration}ms\`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.log(\`❌ Task failed after \${duration}ms: \${error.message}\`);
      throw error;
    }
  }
});

// Create authentication middleware
const authMiddleware = taskMiddleware({
  id: 'app.middleware.auth',
  run: async ({ task, next }) => {
    console.log('🔐 Checking authentication...');
    
    if (!task.input.user || !task.input.user.authenticated) {
      throw new Error('Unauthorized: User not authenticated');
    }
    
    console.log(\`👤 Authenticated user: \${task.input.user.name}\`);
    return await next(task.input);
  }
});

// Task with middleware
const getSecretData = task({
  id: 'app.tasks.getSecretData',
  middleware: [loggingMiddleware, authMiddleware],
  run: async (input: { user: { name: string; authenticated: boolean } }) => {
    return {
      secret: 'The answer is 42',
      timestamp: new Date(),
      accessedBy: input.user.name
    };
  }
});

const app = resource({
  id: 'app',
  register: [loggingMiddleware, authMiddleware, getSecretData],
  dependencies: { getSecretData },
  init: async (_, { getSecretData }) => {
    try {
      // Try with authenticated user
      console.log('\\n--- Attempt 1: Authenticated User ---');
      const result1 = await getSecretData({
        user: { name: 'Alice', authenticated: true }
      });
      
      // Try with unauthenticated user
      console.log('\\n--- Attempt 2: Unauthenticated User ---');
      try {
        await getSecretData({
          user: { name: 'Bob', authenticated: false }
        });
      } catch (error) {
        console.log(\`Access denied: \${error.message}\`);
      }
      
      return { success: true, data: result1 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

const { dispose, value } = await run(app, { debug: 'normal' });
console.log('\\n--- Final Result ---');
console.log(value);
await dispose();`
    }
  };

  const currentExample = examples[selectedExample as keyof typeof examples];

  const copyToClipboard = () => {
    navigator.clipboard.writeText(currentExample.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const runCode = async () => {
    setIsRunning(true);
    setOutput('');
    
    // Simulate code execution
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock output based on selected example
    const mockOutputs = {
      'basic-task': `[INFO] Task execution started
Hello, World! Welcome to BlueLibs Runner.
App result: Hello, World! Welcome to BlueLibs Runner.
[INFO] Resources disposed successfully`,
      'task-with-deps': `[INFO] Database connected
[INFO] Looking up user with ID: 1
[INFO] Found user: Alice
Result: { success: true, user: { id: 1, name: 'Alice', email: 'alice@example.com' } }`,
      'events': `🔄 Registering user: Alice Johnson
📧 Sending welcome email to alice@example.com
📝 Logging registration for user xyz123abc
✅ Welcome email sent!
Final result: { 
  message: 'User registered successfully', 
  user: { id: 'xyz123abc', name: 'Alice Johnson', email: 'alice@example.com' } 
}`,
      'middleware': `--- Attempt 1: Authenticated User ---
🚀 Starting task: app.tasks.getSecretData
🔐 Checking authentication...
👤 Authenticated user: Alice
✅ Task completed in 2ms

--- Attempt 2: Unauthenticated User ---
🚀 Starting task: app.tasks.getSecretData
🔐 Checking authentication...
❌ Task failed after 1ms: Unauthorized: User not authenticated
Access denied: Unauthorized: User not authenticated

--- Final Result ---
{ success: true, data: { secret: 'The answer is 42', accessedBy: 'Alice' } }`
    };
    
    setOutput(mockOutputs[selectedExample as keyof typeof mockOutputs]);
    setIsRunning(false);
  };

  const resetCode = () => {
    setCode(currentExample.code);
    setOutput('');
  };

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-4">
            <Play className="w-4 h-4 mr-2" />
            Interactive Playground
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Try BlueLibs Runner
            <span className="gradient-text"> Live</span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Experiment with BlueLibs Runner concepts in an interactive environment. 
            Run examples, modify code, and see results in real-time.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Example Selector */}
          <div className="lg:col-span-1">
            <div className="card p-6 sticky top-24">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Examples
              </h2>
              <div className="space-y-2">
                {Object.entries(examples).map(([key, example]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedExample(key)}
                    className={`w-full text-left p-3 rounded-lg transition-colors duration-200 ${
                      selectedExample === key
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100'
                        : 'hover:bg-gray-100/50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center space-x-3 mb-2">
                      <example.icon className="w-4 h-4 flex-shrink-0" />
                      <span className="font-medium">{example.title}</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {example.description}
                    </p>
                  </button>
                ))}
              </div>
              
              <div className="mt-6 pt-6 border-t border-gray-200/20 dark:border-gray-700/20">
                <div className="flex items-start space-x-2 text-sm text-gray-600 dark:text-gray-400">
                  <Lightbulb className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>
                    <strong>Tip:</strong> This playground simulates code execution. 
                    For real testing, install BlueLibs Runner in your local environment.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Code Editor and Output */}
          <div className="lg:col-span-3 space-y-6">
            {/* Example Info */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <currentExample.icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                      {currentExample.title}
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      {currentExample.description}
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={copyToClipboard}
                    className="p-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
                    title="Copy code"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    )}
                  </button>
                  <button
                    onClick={resetCode}
                    className="p-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
                    title="Reset code"
                  >
                    <RotateCcw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>
            </div>

            {/* Code Editor */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                  <Code className="w-5 h-5 mr-2" />
                  Code
                </h3>
                <button
                  onClick={runCode}
                  disabled={isRunning}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunning ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {isRunning ? 'Running...' : 'Run Code'}
                </button>
              </div>
              <CodeBlock>
                {currentExample.code}
              </CodeBlock>
            </div>

            {/* Output */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <Terminal className="w-5 h-5 mr-2" />
                Output
              </h3>
              <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 min-h-[200px] font-mono text-sm">
                {output ? (
                  <pre className="text-gray-300 whitespace-pre-wrap">{output}</pre>
                ) : (
                  <div className="text-gray-500 italic">
                    Click "Run Code" to see the output here...
                  </div>
                )}
              </div>
            </div>

            {/* Next Steps */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Ready to Build Something Real?
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                These examples just scratch the surface. Install BlueLibs Runner locally 
                to explore the full feature set and build production applications.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href="/quick-start" className="btn-primary">
                  Get Started Guide
                </a>
                <a href="/docs" className="btn-secondary">
                  Read Full Documentation
                </a>
                <a
                  href="https://github.com/bluelibs/runner/tree/main/examples"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                >
                  Browse Examples
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaygroundPage;