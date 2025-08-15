export const safeStringify = (value: any) => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};
