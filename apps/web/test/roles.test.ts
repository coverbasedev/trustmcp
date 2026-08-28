import { describe, it, expect } from "vitest";
import {
  canManage,
  canManageTeam,
  canReviewRequests,
  isAssignableRole,
  isValidRole,
  normalizeRole,
  outranks,
  roleRank,
} from "../src/lib/roles";

describe("roles", () => {
  it("owner and admin can manage; reviewer/viewer cannot", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("admin")).toBe(true);
    expect(canManage("reviewer")).toBe(false);
    expect(canManage("viewer")).toBe(false);
    expect(canManage(null)).toBe(false);
    expect(canManage(undefined)).toBe(false);
  });

  it("owner, admin, and reviewer can review access requests", () => {
    expect(canReviewRequests("owner")).toBe(true);
    expect(canReviewRequests("admin")).toBe(true);
    expect(canReviewRequests("reviewer")).toBe(true);
    expect(canReviewRequests("viewer")).toBe(false);
    expect(canReviewRequests(null)).toBe(false);
  });

  it("team management requires owner/admin", () => {
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("reviewer")).toBe(false);
    expect(canManageTeam("viewer")).toBe(false);
  });

  it("admin/reviewer/viewer are assignable via invites; owner is not", () => {
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("reviewer")).toBe(true);
    expect(isAssignableRole("viewer")).toBe(true);
    expect(isAssignableRole("owner")).toBe(false);
    expect(isAssignableRole("nonsense")).toBe(false);
  });

  it("validates roles", () => {
    expect(isValidRole("owner")).toBe(true);
    expect(isValidRole("reviewer")).toBe(true);
    expect(isValidRole("viewer")).toBe(true);
    expect(isValidRole("hacker")).toBe(false);
  });

  it("folds the legacy 'member' role into 'viewer'", () => {
    expect(normalizeRole("member")).toBe("viewer");
    expect(normalizeRole("admin")).toBe("admin");
    expect(normalizeRole("nonsense")).toBe("viewer");
    expect(normalizeRole(null)).toBe("viewer");
    // Legacy rows still behave like a viewer everywhere.
    expect(canManage("member")).toBe(false);
    expect(canReviewRequests("member")).toBe(false);
  });

  it("ranks and compares roles", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("reviewer"));
    expect(roleRank("reviewer")).toBeGreaterThan(roleRank("viewer"));
    expect(roleRank("viewer")).toBeGreaterThan(roleRank(null));
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("viewer", "admin")).toBe(false);
  });
});
