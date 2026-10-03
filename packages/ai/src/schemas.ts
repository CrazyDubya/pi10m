import Type from "typebox";

const StrictObject = <T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

export const ThinkingLevelSchema = Type.Union([
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);

export const ModelThinkingLevelSchema = Type.Union([Type.Literal("off"), ThinkingLevelSchema]);

export const TextContentSchema = StrictObject({
	type: Type.Literal("text"),
	text: Type.String(),
	/** OpenAI response message metadata, as either a legacy identifier or `TextSignatureV1` JSON. */
	textSignature: Type.Optional(Type.String()),
});

export const ThinkingContentSchema = StrictObject({
	type: Type.Literal("thinking"),
	thinking: Type.String(),
	/** Provider reasoning item identifier. */
	thinkingSignature: Type.Optional(Type.String()),
	/**
	 * When true, the thinking content was redacted by safety filters. The opaque
	 * encrypted payload is stored in `thinkingSignature` so it can be passed back
	 * to the API for multi-turn continuity.
	 */
	redacted: Type.Optional(Type.Boolean()),
});

export const ImageContentSchema = StrictObject({
	type: Type.Literal("image"),
	/** Base64-encoded image data. */
	data: Type.String(),
	/** Image media type, for example `image/jpeg` or `image/png`. */
	mimeType: Type.String({ minLength: 1 }),
});

export const ToolCallSchema = StrictObject({
	type: Type.Literal("toolCall"),
	id: Type.String(),
	name: Type.String(),
	arguments: Type.Record(Type.String(), Type.Any()),
	/** Google-specific opaque signature for reusing thought context. */
	thoughtSignature: Type.Optional(Type.String()),
});

export const UsageSchema = StrictObject({
	input: Type.Integer({ minimum: 0 }),
	output: Type.Integer({ minimum: 0 }),
	cacheRead: Type.Integer({ minimum: 0 }),
	cacheWrite: Type.Integer({ minimum: 0 }),
	/** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
	cacheWrite1h: Type.Optional(Type.Integer({ minimum: 0 })),
	/**
	 * Reasoning/thinking tokens, when the provider reports them. This is a subset of
	 * `output`: `output` already includes these tokens. Set to a number (possibly 0) by
	 * providers that expose a reasoning breakdown; left undefined by providers that don't.
	 */
	reasoning: Type.Optional(Type.Integer({ minimum: 0 })),
	totalTokens: Type.Integer({ minimum: 0 }),
	cost: StrictObject({
		input: Type.Number({ minimum: 0 }),
		output: Type.Number({ minimum: 0 }),
		cacheRead: Type.Number({ minimum: 0 }),
		cacheWrite: Type.Number({ minimum: 0 }),
		total: Type.Number({ minimum: 0 }),
	}),
});

export const StopReasonSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("stop"),
	Type.Literal("length"),
	Type.Literal("toolUse"),
	Type.Literal("error"),
	Type.Literal("aborted"),
	Type.Literal("deferred"),
]);

export const ModelCostRatesSchema = StrictObject({
	/** US dollars per million input tokens. */
	input: Type.Number({ minimum: 0 }),
	/** US dollars per million output tokens. */
	output: Type.Number({ minimum: 0 }),
	/** US dollars per million cache-read tokens. */
	cacheRead: Type.Number({ minimum: 0 }),
	/** US dollars per million cache-write tokens. */
	cacheWrite: Type.Number({ minimum: 0 }),
});
