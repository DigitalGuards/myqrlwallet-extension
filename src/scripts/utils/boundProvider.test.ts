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
    get(target, property) {
      return target[property as keyof T];
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
    const provider = withBoundMethods(new PrivateFieldProvider());
    const { isConnected, on, removeListener } = provider;
    const listener = () => undefined;

    expect(isConnected()).toBe(true);
    on("accountsChanged", listener);
    expect(provider.listeners).toHaveLength(1);
    removeListener("accountsChanged", listener);
    expect(provider.listeners).toHaveLength(0);
  });

  it("hands back the same function on every read", () => {
    const provider = withBoundMethods(new PrivateFieldProvider());

    // A page that stores a method and later compares it against a fresh
    // read has to see the same function.
    expect(provider.isConnected).toBe(provider.isConnected);
  });

  it("keeps the deleteProperty behaviour libraries rely on", () => {
    const provider = withBoundMethods(new PrivateFieldProvider());

    // web3@1.x deletes properties off the provider it is handed.
    expect(
      Reflect.deleteProperty(provider, "isConnected" as keyof typeof provider),
    ).toBe(true);
    expect(provider.isConnected()).toBe(true);
  });

  it("lets a page replace a method", () => {
    const provider = withBoundMethods(
      new PrivateFieldProvider(),
    ) as PrivateFieldProvider & { isConnected: () => boolean };

    provider.isConnected = () => false;

    expect(provider.isConnected()).toBe(false);
  });
});
