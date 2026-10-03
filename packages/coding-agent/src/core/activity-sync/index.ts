/**
 * Public activity sync entrypoints used by the agent runtime.
 *
 * Keep this barrel narrow. Tests and implementation files should import lower-level
 * payload/API/state helpers from their leaf modules instead of making them part of
 * the public activity-sync surface.
 */

export {
	type ActivitySyncResult,
	type ActivitySyncStatus,
	type SyncSessionAnalyticsOptions,
	syncSessionAnalytics,
} from "./activity-sync.ts";
export { getStableActivitySyncDeviceId, loadActivitySyncState } from "./state.ts";
