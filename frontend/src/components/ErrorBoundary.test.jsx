import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Bomb({ explode }) {
  if (explode) throw new Error("secret internal detail");
  return <p>All good</p>;
}

describe("ErrorBoundary (#49)", () => {
  it("renders its children when nothing fails", () => {
    render(<ErrorBoundary label="map"><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("shows a plain message instead of the error, and logs the details", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary label="map"><Bomb explode /></ErrorBoundary>);

    expect(screen.getByRole("alert")).toHaveTextContent("The map could not be displayed");
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it("renders again when the data it depends on changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary label="map" resetKeys={[1]}><Bomb explode /></ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<ErrorBoundary label="map" resetKeys={[2]}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("lets the user try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    let explode = true;
    function Flaky() {
      return <Bomb explode={explode} />;
    }
    render(<ErrorBoundary label="map"><Flaky /></ErrorBoundary>);

    explode = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("All good")).toBeInTheDocument();
  });
});
