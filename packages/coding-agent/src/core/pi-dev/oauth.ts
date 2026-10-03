import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { OAuthDeviceCodeInfo } from "@earendil-works/pi-ai/oauth";
import type { AuthStorage } from "../auth-storage.ts";
import {
	formatPiDevScopes,
	PI_DEV_OAUTH_CLIENT_ID,
	PI_DEV_OAUTH_PROVIDER_ID,
	PI_DEV_SESSION_SHARE_SCOPE,
	scopesFromString,
	withPiDevOfflineAccess,
} from "./config.ts";
import {
	createFormBody,
	getPiDevApiUrl,
	getPiDevFetch,
	PiDevApiError,
	type PiDevApiErrorCtor,
	type PiDevApiOptions,
	readJson,
	readJsonObject,
	requireNumber,
	requireString,
	stringField,
	throwIfPiDevNotOk,
} from "./http.ts";

const PI_DEV_DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface PiDevDeviceFlowResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
}

export interface PiDevTokenResponse {
	token_type: "Bearer";
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
}

export interface PiDevDeviceFlowOptions extends PiDevApiOptions {
	scopes: readonly string[];
	deviceId?: string;
	signal?: AbortSignal;
	errorClass?: PiDevApiErrorCtor;
}

export interface PiDevDeviceTokenOptions extends PiDevApiOptions {
	signal?: AbortSignal;
	errorClass?: PiDevApiErrorCtor;
}

export interface PiDevRefreshTokenOptions extends PiDevApiOptions {
	errorClass?: PiDevApiErrorCtor;
}

export interface PiDevAccessIntrospectionResult {
	active: boolean;
	scope?: string;
	sessionShareAccess?: boolean;
}

export interface PiDevAuthOptions extends PiDevApiOptions {
	forceRefresh?: boolean;
}

export type PiDevAuthResult =
	| { available: true; accessToken: string }
	| {
			available: false;
			reason: "unauthenticated" | "invalid_token" | "missing_scope";
	  };

export interface PiDevDeviceCodeInfo extends OAuthDeviceCodeInfo {
	displayVerificationUri?: string;
}

export interface PiDevLoginOptions extends PiDevApiOptions {
	scopes: readonly string[];
	deviceId?: string;
	signal?: AbortSignal;
	onDeviceCode?: (info: PiDevDeviceCodeInfo) => void;
}

function parseDeviceFlowResponse(json: unknown): PiDevDeviceFlowResponse {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid pi.dev device flow response");
	const record = json as Record<string, unknown>;
	return {
		device_code: requireString(record, "device_code", "pi.dev device flow response"),
		user_code: requireString(record, "user_code", "pi.dev device flow response"),
		verification_uri: requireString(record, "verification_uri", "pi.dev device flow response"),
		verification_uri_complete: requireString(record, "verification_uri_complete", "pi.dev device flow response"),
		expires_in: requireNumber(record, "expires_in", "pi.dev device flow response"),
		interval: requireNumber(record, "interval", "pi.dev device flow response"),
	};
}

function parseTokenResponse(json: unknown): PiDevTokenResponse {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid pi.dev token response");
	const record = json as Record<string, unknown>;
	const tokenType = stringField(record, "token_type") ?? "Bearer";
	if (tokenType !== "Bearer") throw new Error(`Invalid pi.dev token type: ${tokenType}`);
	return {
		token_type: "Bearer",
		access_token: requireString(record, "access_token", "pi.dev token response"),
		refresh_token: requireString(record, "refresh_token", "pi.dev token response"),
		expires_in: requireNumber(record, "expires_in", "pi.dev token response"),
		scope: requireString(record, "scope", "pi.dev token response"),
	};
}

function credentialFromTokenResponse(response: PiDevTokenResponse): OAuthCredential {
	return {
		type: "oauth",
		access: response.access_token,
		refresh: response.refresh_token,
		expires: Date.now() + response.expires_in * 1000,
		scope: response.scope,
	};
}

function credentialScope(credential: OAuthCredential): string | undefined {
	const scope = credential.scope;
	return typeof scope === "string" ? scope : undefined;
}

export function hasPiDevScopes(scope: string | undefined, requiredScopes: readonly string[]): boolean {
	const availableScopes = new Set(scopesFromString(scope));
	return requiredScopes.every((requiredScope) => availableScopes.has(requiredScope));
}

async function getMergedLoginScopes(authStorage: AuthStorage, requiredScopes: readonly string[]): Promise<string[]> {
	const credential = await authStorage.read(PI_DEV_OAUTH_PROVIDER_ID);
	const existingScopes = credential?.type === "oauth" ? scopesFromString(credentialScope(credential)) : [];
	return withPiDevOfflineAccess([...existingScopes, ...requiredScopes]);
}

export async function startPiDevDeviceFlow(options: PiDevDeviceFlowOptions): Promise<PiDevDeviceFlowResponse> {
	const fields: Record<string, string> = {
		client_id: PI_DEV_OAUTH_CLIENT_ID,
		scope: formatPiDevScopes(withPiDevOfflineAccess(options.scopes)),
	};
	if (options.deviceId) fields.device_id = options.deviceId;
	const response = await getPiDevFetch(options.fetch)(getPiDevApiUrl("/api/oauth/device"), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: createFormBody(fields),
		signal: options.signal,
	});
	await throwIfPiDevNotOk(response, "POST /api/oauth/device", options.errorClass);
	return parseDeviceFlowResponse(await readJson(response));
}

export async function pollPiDevDeviceToken(
	deviceCode: string,
	options: PiDevDeviceTokenOptions = {},
): Promise<PiDevTokenResponse> {
	const response = await getPiDevFetch(options.fetch)(getPiDevApiUrl("/api/oauth/token"), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: createFormBody({
			grant_type: PI_DEV_DEVICE_CODE_GRANT,
			client_id: PI_DEV_OAUTH_CLIENT_ID,
			device_code: deviceCode,
		}),
		signal: options.signal,
	});
	await throwIfPiDevNotOk(response, "POST /api/oauth/token device_code", options.errorClass);
	return parseTokenResponse(await readJson(response));
}

export async function refreshPiDevAccessToken(
	refreshToken: string,
	options: PiDevRefreshTokenOptions = {},
): Promise<PiDevTokenResponse> {
	const response = await getPiDevFetch(options.fetch)(getPiDevApiUrl("/api/oauth/token"), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: createFormBody({
			grant_type: "refresh_token",
			client_id: PI_DEV_OAUTH_CLIENT_ID,
			refresh_token: refreshToken,
		}),
	});
	await throwIfPiDevNotOk(response, "POST /api/oauth/token refresh_token", options.errorClass);
	return parseTokenResponse(await readJson(response));
}

export async function introspectPiDevAccessToken(
	accessToken: string,
	options: PiDevApiOptions = {},
): Promise<PiDevAccessIntrospectionResult> {
	const response = await getPiDevFetch(options.fetch)(getPiDevApiUrl("/api/oauth/introspect"), {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	const data = await readJsonObject(response);
	if (!response.ok || data?.active !== true) {
		return { active: false };
	}
	return {
		active: true,
		scope: stringField(data, "scope"),
		sessionShareAccess: data.session_share_access === true,
	};
}

async function refreshPiDevCredential(credential: OAuthCredential, options: PiDevApiOptions): Promise<OAuthCredential> {
	return credentialFromTokenResponse(await refreshPiDevAccessToken(credential.refresh, options));
}

function shouldRemoveRejectedPiDevCredential(error: unknown): boolean {
	return error instanceof PiDevApiError && error.errorCode === "invalid_grant";
}

function introspectionSatisfiesScopes(
	introspection: PiDevAccessIntrospectionResult,
	requiredScopes: readonly string[],
): boolean {
	if (!introspection.active) return false;
	if (hasPiDevScopes(introspection.scope, requiredScopes)) return true;
	return (
		requiredScopes.length === 1 &&
		requiredScopes[0] === PI_DEV_SESSION_SHARE_SCOPE &&
		introspection.sessionShareAccess === true
	);
}

export async function getPiDevAuth(
	authStorage: AuthStorage,
	requiredScopes: readonly string[],
	options: PiDevAuthOptions = {},
): Promise<PiDevAuthResult> {
	let credential = await authStorage.read(PI_DEV_OAUTH_PROVIDER_ID);
	if (credential?.type !== "oauth") {
		return { available: false, reason: "unauthenticated" };
	}

	if (options.forceRefresh || Date.now() >= credential.expires) {
		let removeRejected = false;
		try {
			const refreshedCredential = await authStorage.modify(PI_DEV_OAUTH_PROVIDER_ID, async (current) => {
				if (current?.type !== "oauth") return undefined;
				if (!options.forceRefresh && Date.now() < current.expires) return undefined;
				try {
					return await refreshPiDevCredential(current, options);
				} catch (error) {
					if (shouldRemoveRejectedPiDevCredential(error)) removeRejected = true;
					throw error;
				}
			});
			if (refreshedCredential?.type !== "oauth") {
				return { available: false, reason: "invalid_token" };
			}
			credential = refreshedCredential;
		} catch {
			if (removeRejected) {
				await authStorage.delete(PI_DEV_OAUTH_PROVIDER_ID);
			}
			return { available: false, reason: "invalid_token" };
		}
	}

	const scope = credentialScope(credential);
	if (scope) {
		return hasPiDevScopes(scope, requiredScopes)
			? { available: true, accessToken: credential.access }
			: { available: false, reason: "missing_scope" };
	}

	try {
		const introspection = await introspectPiDevAccessToken(credential.access, options);
		if (!introspection.active) return { available: false, reason: "invalid_token" };
		return introspectionSatisfiesScopes(introspection, requiredScopes)
			? { available: true, accessToken: credential.access }
			: { available: false, reason: "missing_scope" };
	} catch {
		return { available: false, reason: "invalid_token" };
	}
}

export async function loginPiDev(authStorage: AuthStorage, options: PiDevLoginOptions): Promise<OAuthCredential> {
	const scopes = await getMergedLoginScopes(authStorage, options.scopes);
	const started = await startPiDevDeviceFlow({
		fetch: options.fetch,
		signal: options.signal,
		scopes,
		deviceId: options.deviceId,
	});
	options.onDeviceCode?.({
		userCode: started.user_code,
		verificationUri: started.verification_uri_complete || started.verification_uri,
		displayVerificationUri: started.verification_uri,
		intervalSeconds: started.interval,
		expiresInSeconds: started.expires_in,
	});
	const token = await pollPiDevDeviceCode<PiDevTokenResponse>({
		intervalSeconds: started.interval,
		expiresInSeconds: started.expires_in,
		signal: options.signal,
		poll: async () => {
			try {
				return {
					status: "complete",
					value: await pollPiDevDeviceToken(started.device_code, {
						fetch: options.fetch,
						signal: options.signal,
					}),
				};
			} catch (error) {
				if (error instanceof PiDevApiError && error.errorCode === "authorization_pending") {
					return { status: "pending" };
				}
				if (error instanceof PiDevApiError && error.errorCode === "slow_down") {
					return { status: "slow_down" };
				}
				return {
					status: "failed",
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
	});
	const credential = credentialFromTokenResponse(token);
	await authStorage.modify(PI_DEV_OAUTH_PROVIDER_ID, async () => credential);
	return credential;
}

const PI_DEV_POLL_CANCEL_MESSAGE = "Login cancelled";
const PI_DEV_POLL_TIMEOUT_MESSAGE = "Device flow timed out";
const PI_DEV_POLL_SLOW_DOWN_TIMEOUT_MESSAGE =
	"Device flow timed out after one or more slow_down responses. This is often caused by clock drift in WSL or VM environments. Please sync or restart the VM clock and try again.";
const PI_DEV_POLL_MINIMUM_INTERVAL_MS = 1000;
const PI_DEV_POLL_DEFAULT_INTERVAL_SECONDS = 5;
const PI_DEV_POLL_SLOW_DOWN_INCREMENT_MS = 5000;

type PiDevDevicePollResult<T> =
	| { status: "complete"; value: T }
	| { status: "pending" }
	| { status: "slow_down"; intervalSeconds?: number }
	| { status: "failed"; message: string };

function abortableSleep(ms: number, signal: AbortSignal | undefined, cancelMessage: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error(cancelMessage));
			return;
		}
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error(cancelMessage));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Local device-code poller. The shared poller in pi-ai is not part of the public oauth export,
 * and pi.dev login stays beside provider auth instead of registering a built-in provider.
 */
async function pollPiDevDeviceCode<T>(options: {
	intervalSeconds?: number;
	expiresInSeconds?: number;
	signal?: AbortSignal;
	poll: () => Promise<PiDevDevicePollResult<T>>;
}): Promise<T> {
	const deadline =
		typeof options.expiresInSeconds === "number"
			? Date.now() + options.expiresInSeconds * 1000
			: Number.POSITIVE_INFINITY;
	let intervalMs = Math.max(
		PI_DEV_POLL_MINIMUM_INTERVAL_MS,
		Math.floor((options.intervalSeconds ?? PI_DEV_POLL_DEFAULT_INTERVAL_SECONDS) * 1000),
	);
	let slowDownResponses = 0;

	while (Date.now() < deadline) {
		if (options.signal?.aborted) throw new Error(PI_DEV_POLL_CANCEL_MESSAGE);
		const result = await options.poll();
		if (result.status === "complete") return result.value;
		if (result.status === "failed") throw new Error(result.message);
		if (result.status === "slow_down") {
			slowDownResponses += 1;
			intervalMs =
				typeof result.intervalSeconds === "number" &&
				Number.isFinite(result.intervalSeconds) &&
				result.intervalSeconds > 0
					? Math.max(PI_DEV_POLL_MINIMUM_INTERVAL_MS, Math.floor(result.intervalSeconds * 1000))
					: Math.max(PI_DEV_POLL_MINIMUM_INTERVAL_MS, intervalMs + PI_DEV_POLL_SLOW_DOWN_INCREMENT_MS);
		}
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0) break;
		await abortableSleep(Math.min(intervalMs, remainingMs), options.signal, PI_DEV_POLL_CANCEL_MESSAGE);
	}

	throw new Error(slowDownResponses > 0 ? PI_DEV_POLL_SLOW_DOWN_TIMEOUT_MESSAGE : PI_DEV_POLL_TIMEOUT_MESSAGE);
}
