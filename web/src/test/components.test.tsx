import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../components/ui/Dialog";
import { DataBadge } from "../components/ui/DataBadge";
import { Badge, EmptyState, Field } from "../components/ui/primitives";
import { ChangeBadge, ValidationBadge } from "../features/plan/PlanParts";
import type { Plan } from "../types/api";

const mockData = vi.hoisted(() => ({ source: "live" as "live" | "cached" | "none", cachedAt: null as number | null }));
vi.mock("../hooks/useData", () => ({ useData: () => mockData }));

describe("DataBadge never presents cached data as live", () => {
  it("live", () => { mockData.source = "live"; render(<DataBadge />); expect(screen.getByText("LIVE")).toBeInTheDocument(); });
  it("cached", () => { mockData.source = "cached"; mockData.cachedAt = Date.now(); const { container } = render(<DataBadge />); expect(container.textContent).toContain("CACHED"); expect(container.textContent).not.toContain("LIVE"); });
  it("none", () => { mockData.source = "none"; render(<DataBadge />); expect(screen.getByText("NO DATA")).toBeInTheDocument(); });
});

describe("plan badges", () => {
  const plan = (valid: boolean) => ({ validation: { valid, validator: "v", rules: [{ passed: true }, { passed: valid }], violations: valid ? [] : [{ message: "x" }] } }) as unknown as Plan;
  it("shows pass with rule counts", () => { render(<ValidationBadge plan={plan(true)} />); expect(screen.getByText(/HARD RULES PASS · 2\/2/)).toBeInTheDocument(); });
  it("shows invalid plans as invalid", () => { render(<ValidationBadge plan={plan(false)} />); expect(screen.getByText(/INVALID · 1 violation/)).toBeInTheDocument(); });
  it("change badge", () => { render(<ChangeBadge kind="newly_uncovered" />); expect(screen.getByText("NEWLY UNCOVERED")).toBeInTheDocument(); });
});

describe("ui primitives", () => {
  it("dialog closes on Escape and exposes dialog semantics", () => {
    const onClose = vi.fn();
    render(<Dialog open title="Confirm event" onClose={onClose}>body</Dialog>);
    expect(screen.getByRole("dialog", { name: "Confirm event" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("field shows validation errors accessibly", () => {
    render(<Field label="Crew rest" error="must be 1–24"><input /></Field>);
    expect(screen.getByRole("alert")).toHaveTextContent("must be 1–24");
  });
  it("empty state and badge render", () => { render(<><EmptyState title="Not yet run" /><Badge tone="ok">OK</Badge></>); expect(screen.getByText("Not yet run")).toBeInTheDocument(); expect(screen.getByText("OK")).toBeInTheDocument(); });
});
