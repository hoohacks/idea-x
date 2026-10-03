/**
 * The footer is on every page, which makes it the one place a student or judge
 * is sure to find who to email. The address comes from EVENT so it cannot drift
 * from the copies on the judge form and the Profile page.
 */
import { render, screen } from "@testing-library/react";
import PageFooter from "./siteFooter";
import { EVENT } from "./eventInfo";

test("the footer links to the contact address", () => {
  render(<PageFooter />);

  const link = screen.getByRole("link", { name: EVENT.contactEmail });
  expect(link).toHaveAttribute("href", "mailto:team@hoohacks.io");
  expect(link.closest("p")).toHaveTextContent("Questions? team@hoohacks.io");
});
