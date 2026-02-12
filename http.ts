import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./betterAuth/auth";
import { sapopinguino, sapopinguinoOptions } from "./sapopinguino";
import { sapopinguinoTranslate, sapopinguinoTranslateOptions } from "./sapopinguinoTranslate";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
    path: "/sapopinguino",
    method: "POST",
    handler: sapopinguino,
});

http.route({
    path: "/sapopinguino",
    method: "OPTIONS",
    handler: sapopinguinoOptions,
});

http.route({
    path: "/sapopinguino-translate",
    method: "POST",
    handler: sapopinguinoTranslate,
});

http.route({
    path: "/sapopinguino-translate",
    method: "OPTIONS",
    handler: sapopinguinoTranslateOptions,
});

export default http;
