export const deferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  if (!resolve) throw new Error("Promise resolver was not initialized");
  return { promise, resolve };
};
