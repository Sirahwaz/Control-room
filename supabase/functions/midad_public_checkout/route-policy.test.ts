import { assertEquals } from "jsr:@std/assert@1";
import { isAutoRouteEligible } from "./route-policy.ts";

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
