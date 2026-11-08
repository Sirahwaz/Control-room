export function resolveAutoPromotableRouteTaskClass(taskClass) {
  return String(taskClass || "") === "general_reasoning" ? "generic" : null;
}
