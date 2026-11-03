import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { ROUTES } from "@/router/router";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { wantsAddAccountsFirst } from "../../Home/homeNavigation";
import NewAccount from "./NewAccount";

const HomeProbe = () => {
  const location = useLocation();
  return (
    <div>
      {wantsAddAccountsFirst(location.state) ? "add accounts first" : "home"}
    </div>
  );
};

describe("NewAccount", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter initialEntries={[ROUTES.ACCOUNT_LIST]}>
          <Routes>
            <Route path={ROUTES.ACCOUNT_LIST} element={<NewAccount />} />
            <Route path={ROUTES.HOME} element={<HomeProbe />} />
          </Routes>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the new account component", () => {
    renderComponent();

    expect(
      screen.getByRole("button", { name: "Create or import an account" }),
    ).toBeInTheDocument();
  });

  it("opens Home with the Add accounts section first", async () => {
    renderComponent();

    await userEvent.click(
      screen.getByRole("button", { name: "Create or import an account" }),
    );

    expect(screen.getByText("add accounts first")).toBeInTheDocument();
  });
});
