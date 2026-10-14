import { describe, expect, it } from "vitest";
import { withBoundMethods } from "./boundProvider";

/**
 * Stands in for the vendored provider on the one point that matters: its
 * methods and getters read a private field, so they throw unless `this` is
 * the real instance.
 */
class PrivateFieldProvider {
  #connected = true;
  #chainId = "0x301825";
  readonly listeners: Array<[string, unknown]> = [];

  isConnected() {
    return this.#connected;
  }

  get chainId() {
    return this.#chainId;
  }

  disconnect() {
    this.#connected = false;
  }

  on(event: string, listener: unknown) {
    this.listeners.push([event, listener]);
    return this;
  }

  removeListener(event: string, listener: unknown) {
    const index = this.listeners.findIndex(
      ([name, held]) => name === event && held === listener,
    );
    if (index >= 0) this.listeners.splice(index, 1);
    return this;
  }
}

/**
 * How the vendored package announces its provider: a Proxy whose get trap
 * hands back `target[property]`, which is the unbound method.
 */
const vendoredProxy = <T extends object>(provider: T): T =>
  new Proxy(provider, {
    deleteProperty: () => true,
    get(target, property): unknown {
      return Reflect.get(target, property, target);
    },
  });

describe("withBoundMethods", () => {
  it("is the bug it exists to fix", () => {
    const bare = vendoredProxy(new PrivateFieldProvider());

    // What a dApp sees today: TypeError: Cannot read from private field.
    expect(() => bare.isConnected()).toThrow(TypeError);
  });

  it("lets every public method run against the real provider", () => {
    const provider = withBoundMethods(new PrivateFieldProvider());
    const listener = () => undefined;

    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe("0x301825");

    provider.on("chainChanged", listener);
    expect(provider.listeners).toHaveLength(1);

    provider.removeListener("chainChanged", listener);
    expect(provider.listeners).toHaveLength(0);

    provider.disconnect();
    expect(provider.isConnected()).toBe(false);
  });

  it("survives being destructured", () => {
    const provider: {
      isConnected: () => boolean;
      on: (event: string, listener: unknown) => PrivateFieldProvider;
      removeListener: (
        event: string,
        listener: unknown,
      ) => PrivateFieldProvider;
      listeners: Array<[string, unknown]>;
    } = withBoundMethods(new PrivateFieldProvider());
    const { isConnected, on, removeListener } = provider;
    const listener = () => undefined;

    expect(isConnected()).toBe(true);
    on("accountsChanged", listener);
    expect(provider.listeners).toHaveLength(1);
    removeListener("accountsChanged", listener);
    expect(provider.listeners).toHaveLength(0);
  });

  it("hands back the same function on every read", () => {
    const provider: { isConnected: () => boolean } = withBoundMethods(
      new PrivateFieldProvider(),
    );

    // A page that stores a method and later compares it against a fresh
    // read has to see the same function.
    expect(provider.isConnected).toBe(provider.isConnected);
  });

  it("keeps the deleteProperty behaviour libraries rely on", () => {
    const provider = withBoundMethods(new PrivateFieldProvider());

    // web3@1.x deletes properties off the provider it is handed.
    expect(Reflect.deleteProperty(provider, "isConnected")).toBe(true);
    expect(provider.isConnected()).toBe(true);
  });

  it("lets a page replace a method", () => {
    const provider = withBoundMethods(new PrivateFieldProvider());

    provider.isConnected = () => false;

    expect(provider.isConnected()).toBe(false);
  });

  it("preserves non-function properties and binds symbol methods with arguments", () => {
    const read = Symbol("read");
    const metadata = { connected: true };
    const provider = withBoundMethods({
      metadata,
      optional: undefined,
      [read](suffix: string) {
        return `${String(this.metadata.connected)}:${suffix}`;
      },
    });

    expect(provider.metadata).toBe(metadata);
    expect(provider.optional).toBeUndefined();
    expect(provider[read]("chain")).toBe("true:chain");
    expect(Reflect.get(provider, read)).toBe(Reflect.get(provider, read));
  });
});
