import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RoomField from "./RoomField";

/**
 * The room box is the only input on the planner whose value lives in the plan
 * rather than in the field. Undo, a drift repair and another organizer's edit
 * all change the plan underneath it, and each one has to reach the box.
 */
function setup(room = "Rice 011", onCommit = jest.fn(async () => true)) {
  const view = render(<RoomField room={room} onCommit={onCommit} />);
  return { ...view, onCommit, input: () => screen.getByLabelText("Room") };
}

test("it shows the room the plan carries", () => {
  const { input } = setup("Rice 011");
  expect(input().value).toBe("Rice 011");
});

test("typing is not committed until the field is left", () => {
  const { input, onCommit } = setup();
  fireEvent.change(input(), { target: { value: "Old Cabell 100" } });
  expect(onCommit).not.toHaveBeenCalled();
  expect(input().value).toBe("Old Cabell 100");
});

test("leaving the field commits the new room", () => {
  const { input, onCommit } = setup();
  fireEvent.change(input(), { target: { value: "Old Cabell 100" } });
  fireEvent.blur(input());
  expect(onCommit).toHaveBeenCalledWith("Old Cabell 100");
});

test("leaving it unchanged commits nothing", () => {
  const { input, onCommit } = setup("Rice 011");
  fireEvent.blur(input());
  expect(onCommit).not.toHaveBeenCalled();
});

test("surrounding whitespace is not a change", () => {
  const { input, onCommit } = setup("Rice 011");
  fireEvent.change(input(), { target: { value: "  Rice 011  " } });
  fireEvent.blur(input());
  expect(onCommit).not.toHaveBeenCalled();
});

// the reported bug: undo moved the plan back, the box kept the typed text
test("an undone edit puts the old room back in the box", () => {
  const { input, rerender } = setup("Rice 011");

  fireEvent.change(input(), { target: { value: "Old Cabell 100" } });
  fireEvent.blur(input());
  // the edit lands, so the parent re-renders carrying the new room
  rerender(<RoomField room="Old Cabell 100" onCommit={jest.fn()} />);
  expect(input().value).toBe("Old Cabell 100");

  // undo: the plan's room reverts, so the field must follow it
  rerender(<RoomField room="Rice 011" onCommit={jest.fn()} />);
  expect(input().value).toBe("Rice 011");
});

test("a refused edit puts the plan's room back, rather than showing a lie", async () => {
  // applyFinalEdit refuses an empty room. The plan keeps the room it had, so a
  // box still showing the rejected text claims a room the final round is not in.
  const onCommit = jest.fn(async () => false);
  const { input } = setup("Rice 011", onCommit);

  fireEvent.change(input(), { target: { value: "   " } });
  fireEvent.blur(input());

  await waitFor(() => expect(input().value).toBe("Rice 011"));
});

test("a room changed elsewhere reaches the box without being typed in", () => {
  // a drift repair, or another organizer editing the same draft
  const { input, rerender } = setup("Rice 011");
  rerender(<RoomField room="Minor 125" onCommit={jest.fn()} />);
  expect(input().value).toBe("Minor 125");
});

test("an in-progress edit is not clobbered by an unrelated re-render", () => {
  const { input, rerender } = setup("Rice 011");
  fireEvent.change(input(), { target: { value: "Old Cab" } });
  rerender(<RoomField room="Rice 011" onCommit={jest.fn()} />);
  expect(input().value).toBe("Old Cab");
});
