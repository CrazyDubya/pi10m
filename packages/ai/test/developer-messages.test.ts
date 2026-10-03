import { describe, expect, it } from "vitest";
import {
	downgradeDeveloperMessages,
	SYNTHETIC_DEVELOPER_MESSAGE_PREFIX,
	SYNTHETIC_DEVELOPER_MESSAGE_SUFFIX,
} from "../src/api/developer-messages.ts";
import { convertMessages as convertGoogleMessages } from "../src/api/google-shared.ts";
import { convertMessages as convertOpenAICompletionsMessages } from "../src/api/openai-completions.ts";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import type { Context, DeveloperMessage, Model } from "../src/types.ts";

const developerMessage: DeveloperMessage = {
	role: "developer",
	content: "Use concise answers.",
	timestamp: 1,
};

const wrapped = `${SYNTHETIC_DEVELOPER_MESSAGE_PREFIX}Use concise answers.${SYNTHETIC_DEVELOPER_MESSAGE_SUFFIX}`;

function contextWithDeveloperMessage(): Context {
	return { messages: [developerMessage] };
}

const completionsModel: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
	compat: { supportsDeveloperRole: true },
};

const responsesModel: Model<"openai-responses"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

describe("developer messages", () => {
	it("wraps developer messages as marked user messages", () => {
		expect(downgradeDeveloperMessages([developerMessage])).toEqual([
			{ role: "user", content: wrapped, timestamp: 1 },
		]);
	});

	it("maps to the developer role in OpenAI Chat Completions when supported", () => {
		const messages = convertOpenAICompletionsMessages(completionsModel, contextWithDeveloperMessage(), {
			supportsDeveloperRole: true,
		} as never);
		expect(messages).toEqual([{ role: "developer", content: "Use concise answers." }]);
	});

	it("wraps developer messages in OpenAI Chat Completions when unsupported", () => {
		const messages = convertOpenAICompletionsMessages(
			{ ...completionsModel, compat: { supportsDeveloperRole: false } },
			contextWithDeveloperMessage(),
			{ supportsDeveloperRole: false } as never,
		);
		expect(messages).toEqual([{ role: "user", content: wrapped }]);
	});

	it("maps to the developer role in OpenAI Responses when the flag is unset", () => {
		const input = convertResponsesMessages(responsesModel, contextWithDeveloperMessage(), new Set(["openai"]));
		expect(input).toEqual([{ role: "developer", content: "Use concise answers." }]);
	});

	it("wraps developer messages in OpenAI Responses when the flag is false", () => {
		const input = convertResponsesMessages(
			{ ...responsesModel, compat: { supportsDeveloperRole: false } },
			contextWithDeveloperMessage(),
			new Set(["openai"]),
		);
		expect(input).toEqual([{ role: "user", content: [{ type: "input_text", text: wrapped }] }]);
	});

	it("wraps developer messages for Gemini", () => {
		const googleModel: Model<"google-generative-ai"> = {
			id: "gemini-test",
			name: "Gemini Test",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://example.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 100,
		};
		expect(convertGoogleMessages(googleModel, contextWithDeveloperMessage())).toEqual([
			{ role: "user", parts: [{ text: wrapped }] },
		]);
	});
});
