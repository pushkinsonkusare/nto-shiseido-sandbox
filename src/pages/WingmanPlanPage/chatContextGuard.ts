import { classifyIntent } from "../../components/SidecarAssistant/conversation/flow";
import { extractActivitiesFromQuery } from "../../components/SideBySideAssistant/conversation/broadRecipes";

export type ChatContextGuardResult =
  | { kind: "in_context"; reason: string }
  | { kind: "switch_required"; reason: string };

function toSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function isRefinementPrompt(message: string): boolean {
  return /\b(cheaper|budget|affordable|price|alternative|another|upgrade|downgrade|better|smaller|lighter|newer|pro|beginner)\b/i.test(
    message,
  );
}

export function guardChatContext(
  currentWingmanQuery: string,
  shopperMessage: string,
): ChatContextGuardResult {
  const current = currentWingmanQuery.trim();
  const next = shopperMessage.trim();
  if (!current || !next) {
    return { kind: "in_context", reason: "Missing context; staying on current plan." };
  }

  const currentActivities = toSet(extractActivitiesFromQuery(current));
  const nextActivities = toSet(extractActivitiesFromQuery(next));
  const hasActivitySignals = currentActivities.size > 0 && nextActivities.size > 0;
  const activityOverlap = hasActivitySignals
    ? intersects(currentActivities, nextActivities)
    : true;

  if (!activityOverlap) {
    return {
      kind: "switch_required",
      reason: "Your request looks like a different activity than this plan.",
    };
  }

  const currentIntent = classifyIntent(current);
  const nextIntent = classifyIntent(next);
  const currentCategories = toSet(currentIntent.categories ?? []);
  const nextCategories = toSet(nextIntent.categories ?? []);
  const hasCategorySignals = currentCategories.size > 0 && nextCategories.size > 0;
  const categoryOverlap = hasCategorySignals
    ? intersects(currentCategories, nextCategories)
    : true;

  if (!categoryOverlap && !isRefinementPrompt(next)) {
    return {
      kind: "switch_required",
      reason: "This sounds outside the gear category for the current plan.",
    };
  }

  return {
    kind: "in_context",
    reason: "Request is compatible with the current planning context.",
  };
}
