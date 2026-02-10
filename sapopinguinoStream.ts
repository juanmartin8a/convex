import { httpAction } from "./_generated/server";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const STREAM_END_MARKER = "<end:)>";
const STREAM_ERROR_MARKER = "<error:/>";

type StreamRequestBody = {
    message?: string;
    action?: string;
};

type OpenAIStreamEvent = {
    type?: string;
    delta?: string;
    error?: {
        message?: string;
    };
};

type Token =
    | {
        type: string;
        input: string;
        transcription: string;
        output: string;
    }
    | {
        type: string;
        value: string;
    };

class TokenParser {
    private hasEnteredTokensArray = false;
    private collectingToken = false;
    private currentToken = "";
    private bracketDepth = 0;
    private inString = false;
    private isEscaping = false;

    consume(delta: string): Token[] {
        const parsedTokens: Token[] = [];

        for (const character of delta) {
            if (!this.hasEnteredTokensArray) {
                if (character === "[") {
                    this.hasEnteredTokensArray = true;
                }
                continue;
            }

            if (!this.collectingToken) {
                if (character === "[") {
                    this.collectingToken = true;
                    this.currentToken = "[";
                    this.bracketDepth = 1;
                    this.inString = false;
                    this.isEscaping = false;
                }
                continue;
            }

            this.currentToken += character;

            if (this.inString) {
                if (this.isEscaping) {
                    this.isEscaping = false;
                    continue;
                }

                if (character === "\\") {
                    this.isEscaping = true;
                    continue;
                }

                if (character === '"') {
                    this.inString = false;
                }
                continue;
            }

            if (character === '"') {
                this.inString = true;
                continue;
            }

            if (character === "[") {
                this.bracketDepth += 1;
                continue;
            }

            if (character === "]") {
                this.bracketDepth -= 1;
                if (this.bracketDepth === 0) {
                    const token = this.parseToken(this.currentToken);
                    if (token !== null) {
                        parsedTokens.push(token);
                    }

                    this.collectingToken = false;
                    this.currentToken = "";
                }
            }
        }

        return parsedTokens;
    }

    private parseToken(tokenText: string): Token | null {
        let tokenSlice: unknown;
        try {
            tokenSlice = JSON.parse(tokenText);
        } catch {
            return null;
        }

        if (!Array.isArray(tokenSlice) || tokenSlice.length < 2) {
            return null;
        }

        const tokenType = typeof tokenSlice[0] === "string" ? tokenSlice[0] : null;
        if (tokenType === null) {
            return null;
        }

        if (tokenType === "word" && tokenSlice.length >= 4) {
            const input = typeof tokenSlice[1] === "string" ? tokenSlice[1] : "";
            const transcription = typeof tokenSlice[2] === "string" ? tokenSlice[2] : "";
            const output = typeof tokenSlice[3] === "string" ? tokenSlice[3] : "";

            return {
                type: tokenType,
                input,
                transcription,
                output,
            };
        }

        const value = typeof tokenSlice[1] === "string" ? tokenSlice[1] : "";
        return {
            type: tokenType,
            value,
        };
    }
}

function responseHeaders() {
    return new Headers({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": process.env.CLIENT_ORIGIN ?? "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        Vary: "Origin",
    });
}

function enqueueLine(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, line: string) {
    controller.enqueue(encoder.encode(`${line}\n`));
}

function sseEventsFromChunkBuffer(chunkBuffer: string): { events: string[]; remainder: string } {
    const normalized = chunkBuffer.replace(/\r\n/g, "\n");
    const events: string[] = [];

    let cursor = 0;
    let boundary = normalized.indexOf("\n\n", cursor);

    while (boundary !== -1) {
        events.push(normalized.slice(cursor, boundary));
        cursor = boundary + 2;
        boundary = normalized.indexOf("\n\n", cursor);
    }

    return {
        events,
        remainder: normalized.slice(cursor),
    };
}

function readSSEDataLines(rawEvent: string): string | null {
    const lines = rawEvent.split("\n");
    const dataLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        }
    }

    if (dataLines.length === 0) {
        return null;
    }

    return dataLines.join("\n");
}

function handleDataPayload(
    dataPayload: string,
    tokenParser: TokenParser,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
): "continue" | "stop" {
    if (dataPayload === "[DONE]") {
        enqueueLine(controller, encoder, STREAM_END_MARKER);
        return "stop";
    }

    let parsedEvent: OpenAIStreamEvent;
    try {
        parsedEvent = JSON.parse(dataPayload) as OpenAIStreamEvent;
    } catch {
        return "continue";
    }

    if (parsedEvent.type === "error" || parsedEvent.type?.endsWith(".error")) {
        enqueueLine(controller, encoder, STREAM_ERROR_MARKER);
        return "stop";
    }

    if (parsedEvent.type !== "response.output_text.delta" || typeof parsedEvent.delta !== "string") {
        return "continue";
    }

    const parsedTokens = tokenParser.consume(parsedEvent.delta);
    for (const token of parsedTokens) {
        enqueueLine(controller, encoder, JSON.stringify(token));
    }

    return "continue";
}

async function streamFromOpenAI(
    message: string,
    request: Request,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
) {
    const openAIKey = process.env.OPENAI_API_KEY;
    const promptId = process.env.OPENAI_SAPOPINGUINO_PROMPT_ID;
    const promptVersion = process.env.OPENAI_SAPOPINGUINO_PROMPT_VERSION;

    if (!openAIKey) {
        enqueueLine(controller, encoder, STREAM_ERROR_MARKER);
        return;
    }

    const upstreamResponse = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openAIKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
        },
        body: JSON.stringify({
            prompt: {
                id: promptId,
                version: promptVersion,
            },
            input: message,
            stream: true,
        }),
        signal: request.signal,
    });

    if (!upstreamResponse.ok || upstreamResponse.body === null) {
        enqueueLine(controller, encoder, STREAM_ERROR_MARKER);
        return;
    }

    const reader = upstreamResponse.body.getReader();
    const textDecoder = new TextDecoder();
    const tokenParser = new TokenParser();
    let eventBuffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        eventBuffer += textDecoder.decode(value, { stream: true });
        const { events, remainder } = sseEventsFromChunkBuffer(eventBuffer);
        eventBuffer = remainder;

        for (const rawEvent of events) {
            const dataPayload = readSSEDataLines(rawEvent);
            if (dataPayload === null) {
                continue;
            }

            const nextStep = handleDataPayload(dataPayload, tokenParser, controller, encoder);
            if (nextStep === "stop") {
                return;
            }
        }
    }

    if (eventBuffer.trim().length > 0) {
        const trailingPayload = readSSEDataLines(eventBuffer);
        if (trailingPayload !== null) {
            const nextStep = handleDataPayload(trailingPayload, tokenParser, controller, encoder);
            if (nextStep === "stop") {
                return;
            }
        }
    }

    enqueueLine(controller, encoder, STREAM_END_MARKER);
}

export const streamSapopinguinoOptions = httpAction(async () => {
    return new Response(null, {
        status: 204,
        headers: responseHeaders(),
    });
});

export const streamSapopinguino = httpAction(async (_ctx, request) => {
    if (request.method !== "POST") {
        return new Response("Method not allowed", {
            status: 405,
            headers: responseHeaders(),
        });
    }

    let body: StreamRequestBody;
    try {
        body = (await request.json()) as StreamRequestBody;
    } catch {
        return new Response(STREAM_ERROR_MARKER, {
            status: 400,
            headers: responseHeaders(),
        });
    }

    if (typeof body.message !== "string" || body.message.length === 0) {
        return new Response(STREAM_ERROR_MARKER, {
            status: 400,
            headers: responseHeaders(),
        });
    }

    const message = body.message;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
            try {
                await streamFromOpenAI(message, request, controller, encoder);
            } catch (error) {
                if ((error as Error).name !== "AbortError") {
                    enqueueLine(controller, encoder, STREAM_ERROR_MARKER);
                }
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        status: 200,
        headers: responseHeaders(),
    });
});
