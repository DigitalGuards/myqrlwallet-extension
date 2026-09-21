import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@/types/contact";
import { toChecksumAddress } from "@theqrl/wallet.js";

const ALICE_ADDRESS = toChecksumAddress(`Q${"a".repeat(128)}`);
const BOB_ADDRESS = toChecksumAddress(`Q${"b".repeat(128)}`);

// In-memory storage mock
const localStore: Record<string, any> = {};
vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete localStore[key];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore)) delete localStore[k];
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
  },
}));

// Must import after mock
import ContactsStore from "./contactsStore";
import StorageUtil from "@/utilities/storageUtil";

describe("ContactsStore", () => {
  let store: ContactsStore;

  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    store = new ContactsStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with empty contacts", () => {
    expect(store.contacts).toEqual([]);
    expect(store.isLoading).toBe(false);
  });

  it("should load contacts from storage", async () => {
    const contacts: Contact[] = [{ name: "Alice", address: ALICE_ADDRESS }];
    await StorageUtil.setContacts(contacts);

    await store.loadContacts();

    expect(store.contacts).toEqual(contacts);
    expect(store.isLoading).toBe(false);
  });

  it("should add a contact", async () => {
    const contact: Contact = {
      name: "Bob",
      address: BOB_ADDRESS,
    };

    await store.addContact(contact);

    expect(store.contacts).toHaveLength(1);
    expect(store.contacts[0]).toEqual(contact);

    // Verify persisted
    const stored = await StorageUtil.getContacts();
    expect(stored).toEqual([contact]);
  });

  it("should remove a contact by address", async () => {
    const c1: Contact = {
      name: "Alice",
      address: ALICE_ADDRESS,
    };
    const c2: Contact = {
      name: "Bob",
      address: BOB_ADDRESS,
    };
    await store.addContact(c1);
    await store.addContact(c2);

    await store.removeContact(c1.address);

    expect(store.contacts).toHaveLength(1);
    expect(store.contacts[0].name).toBe("Bob");
  });

  it("should remove contact case-insensitively", async () => {
    const contact: Contact = {
      name: "Alice",
      address: ALICE_ADDRESS,
    };
    await store.addContact(contact);

    await store.removeContact(`Q${ALICE_ADDRESS.slice(1).toLowerCase()}`);

    expect(store.contacts).toHaveLength(0);
  });

  it("should update a contact", async () => {
    const contact: Contact = {
      name: "Alice",
      address: ALICE_ADDRESS,
    };
    await store.addContact(contact);

    await store.updateContact(contact.address, {
      name: "Alice Updated",
      address: contact.address,
    });

    expect(store.contacts).toHaveLength(1);
    expect(store.contacts[0].name).toBe("Alice Updated");
  });

  it("should find a contact by address", async () => {
    const contact: Contact = {
      name: "Alice",
      address: ALICE_ADDRESS,
    };
    await store.addContact(contact);

    const found = store.getContactByAddress(contact.address);
    expect(found).toEqual(contact);
  });

  it("should return undefined for unknown address", () => {
    const found = store.getContactByAddress(`Q${"0".repeat(128)}`);
    expect(found).toBeUndefined();
  });

  it("should not add duplicate address", async () => {
    const contact: Contact = {
      name: "Alice",
      address: ALICE_ADDRESS,
    };
    await store.addContact(contact);

    // Try adding same address with different name
    await store.addContact({
      name: "Alice Duplicate",
      address: ALICE_ADDRESS,
    });

    expect(store.contacts).toHaveLength(1);
    expect(store.contacts[0].name).toBe("Alice");
  });

  it("should not add duplicate address case-insensitively", async () => {
    const contact: Contact = {
      name: "Alice",
      address: ALICE_ADDRESS,
    };
    await store.addContact(contact);

    await store.addContact({
      name: "Alice Lower",
      address: `Q${ALICE_ADDRESS.slice(1).toLowerCase()}`,
    });

    expect(store.contacts).toHaveLength(1);
  });
});
