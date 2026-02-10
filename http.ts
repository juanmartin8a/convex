import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { sapopinguino, sapopinguinoOptions } from "./sapopinguino";

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

export default http;
