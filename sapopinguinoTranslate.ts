import { httpAction } from "./_generated/server";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const STREAM_END_MARKER = "<end:)>";
const STREAM_ERROR_MARKER = "<error:/>";

type StreamRequestBody = {
    input?: string;
};

type OpenAIStreamEvent = {
    type?: string;
    delta?: string;
    error?: {
        message?: string;
    };
};

function responseHeaders() {
    return new Headers({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": process.env.CLIENT_ORIGIN ?? "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        Vary: "Origin",
    });
}

function formatSSEEvent(event: "token" | "done" | "error", data: string) {
    const lines = data.split("\n");
    const payload = [`event: ${event}`, ...lines.map((line) => `data: ${line}`), ""];
    return `${payload.join("\n")}\n`;
}

function enqueueEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    event: "token" | "done" | "error",
    data: string,
) {
    controller.enqueue(encoder.encode(formatSSEEvent(event, data)));
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
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
): "continue" | "stop" {
    if (dataPayload === "[DONE]") {
        enqueueEvent(controller, encoder, "done", STREAM_END_MARKER);
        return "stop";
    }

    let parsedEvent: OpenAIStreamEvent;
    try {
        parsedEvent = JSON.parse(dataPayload) as OpenAIStreamEvent;
    } catch {
        return "continue";
    }

    if (parsedEvent.type === "error" || parsedEvent.type?.endsWith(".error")) {
        enqueueEvent(controller, encoder, "error", STREAM_ERROR_MARKER);
        return "stop";
    }

    if (parsedEvent.type !== "response.output_text.delta" || typeof parsedEvent.delta !== "string") {
        return "continue";
    }

    if (parsedEvent.delta.length === 0) {
        return "continue";
    }

    enqueueEvent(controller, encoder, "token", parsedEvent.delta);
    return "continue";
}

async function streamFromOpenAI(
    input: string,
    request: Request,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
) {
    const openAIKey = process.env.OPENAI_API_KEY;
    const promptId = process.env.OPENAI_SAPOPINGUINO_TRANSLATE_PROMPT_ID;
    const promptVersion = process.env.OPENAI_SAPOPINGUINO_TRANSLATE_PROMPT_V;

    if (!openAIKey) {
        enqueueEvent(controller, encoder, "error", STREAM_ERROR_MARKER);
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
            input: input,
            stream: true,
        }),
        signal: request.signal,
    });

    if (!upstreamResponse.ok || upstreamResponse.body === null) {
        enqueueEvent(controller, encoder, "error", STREAM_ERROR_MARKER);
        return;
    }

    const reader = upstreamResponse.body.getReader();
    const textDecoder = new TextDecoder();
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

            const nextStep = handleDataPayload(dataPayload, controller, encoder);
            if (nextStep === "stop") {
                return;
            }
        }
    }

    if (eventBuffer.trim().length > 0) {
        const trailingPayload = readSSEDataLines(eventBuffer);
        if (trailingPayload !== null) {
            const nextStep = handleDataPayload(trailingPayload, controller, encoder);
            if (nextStep === "stop") {
                return;
            }
        }
    }

    enqueueEvent(controller, encoder, "done", STREAM_END_MARKER);
}

export const sapopinguinoTranslateOptions = httpAction(async () => {
    return new Response(null, {
        status: 204,
        headers: responseHeaders(),
    });
});

export const sapopinguinoTranslate = httpAction(async (_ctx, request) => {
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
        return new Response(formatSSEEvent("error", STREAM_ERROR_MARKER), {
            status: 400,
            headers: responseHeaders(),
        });
    }

    if (typeof body.input !== "string" || body.input.length === 0) {
        return new Response(formatSSEEvent("error", STREAM_ERROR_MARKER), {
            status: 400,
            headers: responseHeaders(),
        });
    }

    const input = body.input;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
            try {
                await streamFromOpenAI(input, request, controller, encoder);
            } catch (error) {
                if ((error as Error).name !== "AbortError") {
                    enqueueEvent(controller, encoder, "error", STREAM_ERROR_MARKER);
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
