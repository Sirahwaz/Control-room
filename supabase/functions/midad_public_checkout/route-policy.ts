export interface AutoRouteCandidate {
  active?: unknown;
  auto_route?: unknown;
  requires_approval?: unknown;
  route_kind?: unknown;
}

export function isAutoRouteEligible(route: AutoRouteCandidate): boolean {
  return route.active === true &&
    route.auto_route === true &&
    route.requires_approval === false &&
    route.route_kind === "receive";
}
