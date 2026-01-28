enum ErrorMessage {
  UndefinedTaskResult = "Task returned undefined",
}

export function assertDefined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error(ErrorMessage.UndefinedTaskResult);
  }
  return value;
}

