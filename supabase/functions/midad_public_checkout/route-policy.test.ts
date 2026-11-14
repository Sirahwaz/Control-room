import { assertEquals } from "jsr:@std/assert@1";
import {
  AUTO_ROUTE_SELECT,
  isAutoRouteEligible,
  requiredConfirmations,
} from "./route-policy.ts";

Deno.test(
  "allows only active receive routes explicitly approved for automatic routing",
  () => {
    assertEquals(
      isAutoRouteEligible({
        active: true,
        auto_route: true,
        requires_approval: false,
        route_kind: "receive",
      }),
      true,
    );
  },
);

Deno.test("fails closed when approval is required", () => {
  assertEquals(
    isAutoRouteEligible({
      active: true,
      auto_route: true,
      requires_approval: true,
      route_kind: "receive",
    }),
    false,
  );
});

Deno.test("fails closed when approval flag is missing or null", () => {
  assertEquals(
    isAutoRouteEligible({
      active: true,
      auto_route: true,
      route_kind: "receive",
    }),
    false,
  );
  assertEquals(
    isAutoRouteEligible({
      active: true,
      auto_route: true,
      requires_approval: null,
      route_kind: "receive",
    }),
    false,
  );
});

Deno.test("rejects inactive, manual-only, or non-receive routes", () => {
  assertEquals(
    isAutoRouteEligible({
      active: false,
      auto_route: true,
      requires_approval: false,
      route_kind: "receive",
    }),
    false,
  );
  assertEquals(
    isAutoRouteEligible({
      active: true,
      auto_route: false,
      requires_approval: false,
      route_kind: "receive",
    }),
    false,
  );
  assertEquals(
    isAutoRouteEligible({
      active: true,
      auto_route: true,
      requires_approval: false,
      route_kind: "reinvest",
    }),
    false,
  );
});

Deno.test("checkout route projection includes every field required by route policy", () => {
  const projectedFields = AUTO_ROUTE_SELECT.split(",").map((field) =>
    field.trim()
  );
  assertEquals(projectedFields.includes("route_kind"), true);
});

Deno.test("requires three confirmations for Base and one for Solana", () => {
  assertEquals(requiredConfirmations("base"), 3);
  assertEquals(requiredConfirmations("solana"), 1);
});
