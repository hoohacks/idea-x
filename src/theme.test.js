/**
 * The palette, and the rule it exists to enforce.
 *
 * Colour in this app means state: the interface is neutral, crimson marks the
 * brand and anything genuinely live, red marks anything genuinely wrong. The
 * primary action colour used to be the brand crimson, which put "Publish
 * schedule" in the same register as "3 teams have no scores at all" on a page
 * whose entire job is telling you which is which.
 */
import theme, { tokens } from "./theme";

const luminance = (hex) => {
  const channel = (c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

describe("the accent is the brand, the alert is not", () => {
  test("the brand carries the interface", () => {
    expect(theme.palette.primary.main).toBe(tokens.BRAND);
  });

  test("ink is still available, as its own role", () => {
    expect(theme.palette.secondary.main).toBe(tokens.INK);
  });

  test("danger is separable from the brand, not a near miss of it", () => {
    // Two reds that look alike are worse than one: an alert has to read as an
    // alert next to a wordmark. They share a hue family on purpose -- an error
    // should look like an error without being taught -- so the separation that
    // matters is lightness, not hue.
    expect(theme.palette.error.main).not.toBe(tokens.BRAND);
    expect(luminance(tokens.BRAND) / luminance(tokens.DANGER)).toBeGreaterThan(2);
  });
});

describe("everything readable clears AA", () => {
  test.each([
    ["ink", tokens.INK],
    ["muted", tokens.MUTED],
    ["danger", tokens.DANGER],
    ["caution", tokens.CAUTION],
    ["good", tokens.GOOD],
  ])("%s holds 4.5:1 as text on paper", (_name, hex) => {
    expect(onWhite(hex)).toBeGreaterThan(4.5);
  });
});

describe("the numbers are the content", () => {
  test("there is a role for operational data", () => {
    expect(theme.typography.data).toBeDefined();
  });

  test("its figures are tabular, so a column of them lines up", () => {
    expect(theme.typography.data.fontVariantNumeric).toBe("tabular-nums");
  });

  test("it renders as a span, so it can sit inside a sentence", () => {
    expect(theme.components.MuiTypography.defaultProps.variantMapping.data).toBe("span");
  });
});

describe("one voice", () => {
  test("headings and body share a family; hierarchy is weight and size", () => {
    expect(theme.typography.fontFamily).toContain("Inter");
    expect(theme.typography.h1.fontFamily).toBe(theme.typography.body1.fontFamily);
    expect(theme.typography.h2.fontFamily).toBe(theme.typography.body1.fontFamily);
    expect(theme.typography.h1.fontWeight).toBeGreaterThan(theme.typography.body1.fontWeight ?? 400);
  });

  test("data is the same face -- no monospace anywhere -- told apart by its figures", () => {
    expect(theme.typography.data.fontFamily).toBe(theme.typography.body1.fontFamily);
    expect(theme.typography.data.fontFeatureSettings).toContain("tnum");
  });
});
