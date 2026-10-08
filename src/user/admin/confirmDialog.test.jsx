/**
 * The shared destructive-action dialog. `window.confirm` gets dismissed by
 * reflex; this states what will happen and, when a phrase is supplied, keeps
 * the confirm button disabled until the phrase is typed exactly.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./adminUi";

const props = {
  open: true, title: "Publish the schedule?",
  consequences: ["A restore point will be taken.", "Every assignment will be replaced."],
  confirmLabel: "Publish", onConfirm: jest.fn(), onCancel: jest.fn(),
};

test("it lists what will happen", () => {
  render(<ConfirmDialog {...props} />);
  expect(screen.getByText(/Every assignment will be replaced/)).toBeInTheDocument();
});

test("without a phrase, confirming is immediate", () => {
  const onConfirm = jest.fn();
  render(<ConfirmDialog {...props} onConfirm={onConfirm} />);
  userEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(onConfirm).toHaveBeenCalled();
});

test("with a phrase, confirming is refused until it matches", () => {
  const onConfirm = jest.fn();
  render(<ConfirmDialog {...props} typeToConfirm="HooHacks Ideathon" onConfirm={onConfirm} />);
  const button = screen.getByRole("button", { name: "Publish" });
  expect(button).toBeDisabled();

  userEvent.type(screen.getByLabelText(/type/i), "hoohacks ideathon");
  expect(button).toBeDisabled();

  userEvent.clear(screen.getByLabelText(/type/i));
  userEvent.type(screen.getByLabelText(/type/i), "HooHacks Ideathon");
  expect(button).toBeEnabled();
  userEvent.click(button);
  expect(onConfirm).toHaveBeenCalled();
});

test("closing and reopening the dialog resets the typed phrase", () => {
  const { rerender } = render(
    <ConfirmDialog {...props} typeToConfirm="HooHacks Ideathon" onConfirm={jest.fn()} />
  );
  userEvent.type(screen.getByLabelText(/type/i), "HooHacks Ideathon");
  expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();

  rerender(
    <ConfirmDialog {...props} open={false} typeToConfirm="HooHacks Ideathon" onConfirm={jest.fn()} />
  );
  rerender(
    <ConfirmDialog {...props} open typeToConfirm="HooHacks Ideathon" onConfirm={jest.fn()} />
  );

  expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  expect(screen.getByLabelText(/type/i)).toHaveValue("");
});
