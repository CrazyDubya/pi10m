import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { Container, TUI } from "@earendil-works/pi-tui";
import type { AuthStorage } from "../../core/auth-storage.ts";
import { loginPiDev } from "../../core/pi-dev/index.ts";
import { LoginDialogComponent } from "./components/login-dialog.ts";

export interface PiDevLoginDialogOptions {
	tui: TUI;
	container: Container;
	authStorage: AuthStorage;
	scopes: readonly string[];
	title: string;
	deviceId?: string;
}

export async function runPiDevLoginDialog(options: PiDevLoginDialogOptions): Promise<OAuthCredential | undefined> {
	const dialog = new LoginDialogComponent(
		options.tui,
		"pi.dev",
		(_success, _message) => {
			// Completion handled below.
		},
		"pi.dev",
		options.title,
	);

	options.container.clear();
	options.container.addChild(dialog);
	options.tui.setFocus(dialog);
	options.tui.requestRender();

	try {
		return await loginPiDev(options.authStorage, {
			scopes: options.scopes,
			deviceId: options.deviceId,
			signal: dialog.signal,
			onDeviceCode: (info) => {
				dialog.showDeviceAuthorizationLink(info);
				dialog.showWaiting("Waiting for authentication...");
			},
		});
	} catch (error: unknown) {
		if (dialog.signal.aborted) {
			return undefined;
		}
		throw error;
	}
}
