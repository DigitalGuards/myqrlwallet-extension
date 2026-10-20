import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, type ReactNode } from "react";
import { useForm, type FieldError } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./Form";

type FormValues = { name: string };

function NameForm({
  children,
  error,
}: {
  children?: ReactNode;
  error?: FieldError;
}) {
  const errors = useMemo(() => (error ? { name: error } : {}), [error]);
  const form = useForm<FormValues>({
    defaultValues: { name: "Alice" },
    errors,
  });

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <input {...field} />
            </FormControl>
            <FormDescription>Choose a name.</FormDescription>
            <FormMessage data-testid="message">{children}</FormMessage>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("Form", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("preserves field values and links the label and description", async () => {
    render(<NameForm />);

    const input = screen.getByRole("textbox", { name: "Name" });
    const description = screen.getByText("Choose a name.");
    expect(input).toHaveValue("Alice");
    expect(input.id).toMatch(/-form-item$/);
    expect(screen.getByText("Name")).toHaveAttribute("for", input.id);
    expect(description).toHaveAttribute("id", `${input.id}-description`);
    expect(input).toHaveAttribute("aria-describedby", description.id);
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByTestId("message")).not.toBeInTheDocument();

    await userEvent.type(input, " Updated");
    expect(input).toHaveValue("Alice Updated");
  });

  it("links validation errors and restores the fallback when cleared", () => {
    const { rerender } = render(<NameForm>Available to edit.</NameForm>);
    const input = screen.getByRole("textbox", { name: "Name" });
    const description = screen.getByText("Choose a name.");
    const messageId = screen.getByTestId("message").id;
    expect(messageId).toBe(`${input.id}-message`);
    expect(screen.getByTestId("message")).toHaveTextContent(
      "Available to edit.",
    );
    expect(input).toHaveAttribute("aria-describedby", description.id);

    rerender(
      <NameForm error={{ type: "manual", message: "Name is unavailable." }}>
        Available to edit.
      </NameForm>,
    );

    expect(screen.getByTestId("message")).toHaveTextContent(
      "Name is unavailable.",
    );
    expect(screen.getByTestId("message")).toHaveAttribute("id", messageId);
    expect(screen.getByText("Name")).toHaveClass("text-destructive");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      `${description.id} ${messageId}`,
    );
    expect(input).toHaveValue("Alice");

    rerender(<NameForm>Available to edit.</NameForm>);

    expect(screen.getByTestId("message")).toHaveTextContent(
      "Available to edit.",
    );
    expect(screen.getByText("Name")).not.toHaveClass("text-destructive");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).toHaveAttribute("aria-describedby", description.id);
  });

  it("preserves the string conversion of an error without a message", () => {
    render(<NameForm error={{ type: "manual" }}>Available to edit.</NameForm>);

    expect(screen.getByTestId("message")).toHaveTextContent("undefined");
  });

  it("keeps an empty error message hidden", () => {
    render(
      <NameForm error={{ type: "manual", message: "" }}>
        Available to edit.
      </NameForm>,
    );

    expect(screen.queryByTestId("message")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("rejects a missing FormField before reading field state", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getFieldState = vi.fn(() => {
      throw new Error("Unexpected field state lookup");
    });
    function MissingField() {
      const form = useForm<FormValues>();
      return (
        <Form {...form} getFieldState={getFieldState}>
          <FormItem>
            <FormLabel>Name</FormLabel>
          </FormItem>
        </Form>
      );
    }

    expect(() => render(<MissingField />)).toThrow(
      "useFormField should be used within <FormField>",
    );
    expect(getFieldState).not.toHaveBeenCalled();
  });

  it("rejects a missing FormItem before reading field state", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getFieldState = vi.fn(() => {
      throw new Error("Unexpected field state lookup");
    });
    function MissingItem() {
      const form = useForm<FormValues>();
      return (
        <Form {...form} getFieldState={getFieldState}>
          <FormField
            control={form.control}
            name="name"
            render={() => <FormLabel>Name</FormLabel>}
          />
        </Form>
      );
    }

    expect(() => render(<MissingItem />)).toThrow(
      "useFormField should be used within <FormItem>",
    );
    expect(getFieldState).not.toHaveBeenCalled();
  });
});
