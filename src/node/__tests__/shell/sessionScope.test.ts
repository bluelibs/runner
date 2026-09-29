import { AsyncLocalStorage } from "node:async_hooks";
import { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { start } from "node:repl";
import { r, run } from "../../node";
import { scopeShellSession } from "../../shell/sessionScope";

it("scopes evaluation and completion, preserves stricter nested scope, and refuses shutdown work", async () => {
  const runtime = await run(r.resource("app").build());
  const scope = new AsyncLocalStorage<boolean>();
  const socket = new Socket();
  const input = new PassThrough();
  const evaluate = jest.fn(() => scope.getStore());
  const complete = jest.fn(() => scope.getStore());
  const session = start({
    input,
    output: new PassThrough(),
    terminal: false,
    eval: (_, __, ___, callback) => {
      callback(null, evaluate());
    },
    completer: (
      line: string,
      callback: (error: null, result: [string[], string]) => void,
    ) => {
      complete();
      callback(null, [[], line]);
    },
  });
  try {
    scopeShellSession(session, socket, runtime, scope, false);
    const callback = jest.fn();
    session.eval("1", session.context, "shell", callback);
    expect(callback).toHaveBeenLastCalledWith(null, false);
    scope.run(true, () =>
      session.eval("1", session.context, "shell", callback),
    );
    expect(callback).toHaveBeenLastCalledWith(null, true);
    runtime.store.getLifecycleAdmissionController().beginPausing();
    scope.run(true, () =>
      Reflect.apply(session.completer, session, ["a", callback]),
    );
    expect(complete).toHaveLastReturnedWith(true);
    runtime.store.beginCoolingDown();
    session.eval("1", session.context, "shell", callback);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(socket.destroyed).toBe(true);
  } finally {
    session.close();
    input.destroy();
    socket.destroy();
    await runtime.dispose();
  }
});
