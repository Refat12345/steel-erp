import { afterEach, describe, expect, it } from "vitest";
import {
  canAccessMillLiveDashboard,
  canEditMillLiveProductSize,
  canOpenMillLiveDashboard,
} from "./mill-live-access";

const ORIGINAL = process.env.MILL_LIVE_DASHBOARD_USERS;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.MILL_LIVE_DASHBOARD_USERS;
  } else {
    process.env.MILL_LIVE_DASHBOARD_USERS = ORIGINAL;
  }
});

describe("canAccessMillLiveDashboard", () => {
  it("is false when the allowlist is empty", () => {
    process.env.MILL_LIVE_DASHBOARD_USERS = "";
    expect(canAccessMillLiveDashboard("admin")).toBe(false);
  });

  it("matches usernames case-insensitively", () => {
    process.env.MILL_LIVE_DASHBOARD_USERS = "Refat, viewer";
    expect(canAccessMillLiveDashboard("REFAT")).toBe(true);
    expect(canAccessMillLiveDashboard("viewer")).toBe(true);
    expect(canAccessMillLiveDashboard("admin")).toBe(false);
  });
});

describe("canOpenMillLiveDashboard", () => {
  it("opens for settings.edit even when the username is not allowlisted", () => {
    process.env.MILL_LIVE_DASHBOARD_USERS = "refat";
    expect(
      canOpenMillLiveDashboard({
        username: "admin",
        permissions: ["settings.edit"],
      }),
    ).toBe(true);
  });

  it("opens for an allowlisted viewer without settings.edit", () => {
    process.env.MILL_LIVE_DASHBOARD_USERS = "refat";
    expect(
      canOpenMillLiveDashboard({
        username: "refat",
        permissions: ["truck.view_queue"],
      }),
    ).toBe(true);
  });

  it("denies everyone else", () => {
    process.env.MILL_LIVE_DASHBOARD_USERS = "refat";
    expect(
      canOpenMillLiveDashboard({
        username: "scale1",
        permissions: ["scale.start"],
      }),
    ).toBe(false);
  });
});

describe("canEditMillLiveProductSize", () => {
  it("is true only with settings.edit", () => {
    expect(canEditMillLiveProductSize(["settings.edit"])).toBe(true);
    expect(canEditMillLiveProductSize(["user.manage"])).toBe(false);
    expect(canEditMillLiveProductSize([])).toBe(false);
  });
});
