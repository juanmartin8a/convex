import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { streamSapopinguino, streamSapopinguinoOptions } from "./sapopinguinoStream";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
    path: "/sapopinguino-stream",
    method: "POST",
    handler: streamSapopinguino,
});

http.route({
    path: "/sapopinguino-stream",
    method: "OPTIONS",
    handler: streamSapopinguinoOptions,
});

export default http;
