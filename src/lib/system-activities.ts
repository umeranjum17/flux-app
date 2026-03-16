import type { SystemActivity } from './types';

export const MAX_SYSTEM_ACTIVITIES = 40;

export function appendSystemActivity(
  activities: SystemActivity[],
  activity: SystemActivity,
  maxItems = MAX_SYSTEM_ACTIVITIES,
): void {
  const lastActivity = activities[activities.length - 1];
  if (
    lastActivity
    && lastActivity.category === activity.category
    && lastActivity.label === activity.label
    && lastActivity.detail === activity.detail
  ) {
    lastActivity.timestamp = activity.timestamp;
    return;
  }

  activities.push(activity);
  if (activities.length > maxItems) {
    activities.splice(0, activities.length - maxItems);
  }
}
