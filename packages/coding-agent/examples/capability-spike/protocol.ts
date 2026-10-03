import { type Static, type TSchema, Type } from "typebox";

export interface ClientAction<TInputSchema extends TSchema, TOutputSchema extends TSchema> {
	id: string;
	version: number;
	input: TInputSchema;
	output: TOutputSchema;
}

export const notifyAction = {
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
} satisfies ClientAction<TSchema, TSchema>;

export type NotifyInput = Static<typeof notifyAction.input>;
export type NotifyOutput = Static<typeof notifyAction.output>;

export interface ActionRegistration {
	id: string;
	version: number;
}

export type ServerEvent =
	| { type: "ready"; clientId: string }
	| { type: "capabilities_updated"; actions: ActionRegistration[] }
	| { type: "user_prompt"; clientId: string; text: string }
	| { type: "run_start" }
	| { type: "run_end" }
	| { type: "assistant_start" }
	| { type: "assistant_delta"; text: string }
	| { type: "assistant_end" }
	| { type: "tool_start"; name: string }
	| { type: "tool_end"; name: string; isError: boolean }
	| { type: "error"; message: string }
	| { type: "action_request"; requestId: string; action: ActionRegistration; input: unknown }
	| { type: "action_cancel"; requestId: string };

export interface ActionResultMessage {
	clientId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}
