/**
 * Hands a page a provider whose methods survive being pulled off the
 * object.
 *
 * The vendored `@theqrl/qrl-wallet-provider` wraps the provider it
 * announces in a Proxy whose `get` trap returns `target[property]`
 * directly. Reading a method that way yields it unbound, so
 * `provider.isConnected()` runs with `this` set to the Proxy, and the
 * first private-field read inside it throws
 * `TypeError: Cannot read from private field`. The same holds for every
 * public method the class declares; only `request` escaped it, because
 * the constructor binds that one by hand.
 *
 * Any dApp that calls `provider.isConnected()`, or that destructures
 * `const { on, removeListener } = provider`, crashes on that. This wrapper
 * binds each method to the real provider once and caches it, so repeated
 * reads give the same function and identity comparisons still hold.
 *
 * Property reads keep the real provider as the receiver, which is what
 * makes the class's getters (`chainId`, `selectedAddress`,
 * `networkVersion`) able to read their own private fields.
 */
export const withBoundMethods = <T extends object>(provider: T): T => {
  const boundMethods = new Map<PropertyKey, unknown>();
  return new Proxy(provider, {
    // Kept from the vendored wrapper: some libraries, web3@1.x among
    // them, delete properties off the provider they are handed.
    deleteProperty: () => true,
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const cached = boundMethods.get(property);
      if (cached !== undefined) return cached;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      boundMethods.set(property, bound);
      return bound;
    },
    set(target, property, value) {
      // A page that overwrites a method has to replace what the next read
      // returns, so the cache entry goes with it.
      boundMethods.delete(property);
      return Reflect.set(target, property, value, target);
    },
  });
};
