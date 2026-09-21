import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toChecksumAddress } from "@theqrl/wallet.js";
import ContactsPage from "./ContactsPage";

const ALICE_ADDRESS = toChecksumAddress(`Q${"a".repeat(128)}`);
const BOB_ADDRESS = toChecksumAddress(`Q${"b".repeat(128)}`);

vi.mock("@theqrl/web3", () => ({
  validator: {
    isAddressString: (addr: string) =>
      typeof addr === "string" && addr.startsWith("Q") && addr.length >= 41,
  },
}));

describe("ContactsPage", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ContactsPage />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the heading", () => {
    renderComponent();

    expect(screen.getByText("Contacts")).toBeInTheDocument();
  });

  it("should have a back button", () => {
    renderComponent();

    expect(screen.getByTestId("backButtonTestId")).toBeInTheDocument();
  });

  it("should have an Add button", () => {
    renderComponent();

    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("should show empty state when no contacts", () => {
    renderComponent();

    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });

  it("should show contact form when Add is clicked", async () => {
    renderComponent();

    await userEvent.click(screen.getByText("Add"));

    expect(screen.getByPlaceholderText("Contact name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Q address")).toBeInTheDocument();
  });

  it("should render contacts from store", () => {
    renderComponent(
      mockedStore({
        contactsStore: {
          contacts: [
            {
              name: "Alice",
              address: ALICE_ADDRESS,
            },
          ],
        },
      }),
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("should show edit form when edit button is clicked", async () => {
    renderComponent(
      mockedStore({
        contactsStore: {
          contacts: [
            {
              name: "Alice",
              address: ALICE_ADDRESS,
            },
          ],
        },
      }),
    );

    await userEvent.click(screen.getByLabelText("Edit contact"));

    expect(screen.getByPlaceholderText("Contact name")).toHaveValue("Alice");
  });

  it("should call removeContact when delete button is clicked", async () => {
    const removeContact = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        contactsStore: {
          contacts: [
            {
              name: "Alice",
              address: ALICE_ADDRESS,
            },
          ],
          removeContact,
        },
      }),
    );

    await userEvent.click(screen.getByLabelText("Delete contact"));

    expect(removeContact).toHaveBeenCalledWith(ALICE_ADDRESS);
  });

  it("should call addContact when saving a new contact", async () => {
    const addContact = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        contactsStore: {
          addContact,
        },
      }),
    );

    await userEvent.click(screen.getByText("Add"));

    await userEvent.type(screen.getByPlaceholderText("Contact name"), "Bob");
    await userEvent.type(screen.getByPlaceholderText("Q address"), BOB_ADDRESS);

    const saveButton = screen.getByRole("button", { name: /Save/i });
    await waitFor(
      () => {
        expect(saveButton).toBeEnabled();
      },
      { timeout: 3000 },
    );

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(addContact).toHaveBeenCalledWith({
        name: "Bob",
        address: BOB_ADDRESS,
      });
    });

    // Form should be hidden after save
    expect(
      screen.queryByPlaceholderText("Contact name"),
    ).not.toBeInTheDocument();
  });

  it("should call updateContact when saving an edited contact", async () => {
    const updateContact = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        contactsStore: {
          contacts: [
            {
              name: "Alice",
              address: ALICE_ADDRESS,
            },
          ],
          updateContact,
        },
      }),
    );

    await userEvent.click(screen.getByLabelText("Edit contact"));

    const nameInput = screen.getByPlaceholderText("Contact name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Alice Updated");

    const saveButton = screen.getByRole("button", { name: /Save/i });
    await waitFor(
      () => {
        expect(saveButton).toBeEnabled();
      },
      { timeout: 3000 },
    );

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(updateContact).toHaveBeenCalledWith(ALICE_ADDRESS, {
        name: "Alice Updated",
        address: ALICE_ADDRESS,
      });
    });
  });

  it("should hide form when Cancel is clicked", async () => {
    renderComponent();

    await userEvent.click(screen.getByText("Add"));
    expect(screen.getByPlaceholderText("Contact name")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cancel"));

    expect(
      screen.queryByPlaceholderText("Contact name"),
    ).not.toBeInTheDocument();
    // Add button should be visible again
    expect(screen.getByText("Add")).toBeInTheDocument();
  });
});
