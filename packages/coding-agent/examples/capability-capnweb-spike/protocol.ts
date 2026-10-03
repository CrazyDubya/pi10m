import { type Static, Type } from "typebox";

export const protocolVersion = 1;

export const notifyBinding = {
	id: "pi.notify",
	version: 1,
	input: Type.Object(
		{
			message: Type.String({ minLength: 1, maxLength: 500 }),
		},
		{ additionalProperties: false },
	),
	output: Type.Object(
		{
			displayed: Type.Literal(true),
		},
		{ additionalProperties: false },
	),
} as const;

export type NotifyInput = Static<typeof notifyBinding.input>;
export type NotifyOutput = Static<typeof notifyBinding.output>;

export interface BindingRegistration {
	id: string;
	version: number;
}

export interface ClientRegistration {
	clientId: string;
	protocolVersion: number;
	bindings: BindingRegistration[];
}

export const clientRegistrationSchema = Type.Object(
	{
		clientId: Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" }),
		protocolVersion: Type.Literal(protocolVersion),
		bindings: Type.Array(
			Type.Object(
				{
					id: Type.String({ minLength: 1, maxLength: 100 }),
					version: Type.Integer({ minimum: 1 }),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export type ServerEvent =
	| { type: "ready"; clientId: string; bindings: BindingRegistration[] }
	| { type: "user_prompt"; clientId: string; text: string }
	| { type: "run_start" }
	| { type: "run_end" }
	| { type: "assistant_start" }
	| { type: "assistant_delta"; text: string }
	| { type: "assistant_end" }
	| { type: "tool_start"; name: string }
	| { type: "tool_end"; name: string; isError: boolean }
	| { type: "error"; message: string };

/** The main Cap'n Web interface exported by each connected client. */
export interface ClientBindingApi {
	event(event: ServerEvent): Promise<void>;
	notify(input: NotifyInput): Promise<NotifyOutput>;
}

/** The main Cap'n Web interface exported by the server for one connection. */
export interface ServerApi {
	connect(registration: ClientRegistration): Promise<void>;
	prompt(text: string): Promise<void>;
	command(name: string, input: unknown): Promise<void>;
}
