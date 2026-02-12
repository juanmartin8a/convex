import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import schema from "./schema";
import { expo } from "@better-auth/expo";
import { sendEmail } from "../sendEmail";

// Better Auth Component
export const authComponent = createClient<DataModel, typeof schema>(
    components.betterAuth,
    {
        local: { schema },
        verbose: false,
    },
);

// Better Auth Options
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
    return {
        appName: process.env.APP_NAME,
        baseURL: process.env.SITE_URL,
        secret: process.env.BETTER_AUTH_SECRET,
        database: authComponent.adapter(ctx),
        logger: {
            disabled: false,
        },
        trustedOrigins: ["sapo://", "https://appleid.apple.com"],
        user: {
            deleteUser: {
                enabled: true,
                sendDeleteAccountVerification: async ({ user, url }) => {
                    await sendEmail(
                        ctx,
                        user.email,
                        "Verify Account Deletion",
                        {
                            id: 'verify_account_deletion',
                            variables: {
                                URL: url
                            }
                        }
                    )
                },
            }
        },
        socialProviders: {
            google: {
                prompt: "select_account",
                clientId: process.env.GOOGLE_CLIENT_ID as string,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            },
            apple: {
                clientId: process.env.APPLE_CLIENT_ID as string,
                clientSecret: process.env.APPLE_CLIENT_SECRET as string,
                appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER as string,
            },
        },
        plugins: [
            expo(),
            convex({ authConfig })
        ],
    } satisfies BetterAuthOptions;
};

// For `@better-auth/cli`
export const options = createAuthOptions({} as GenericCtx<DataModel>);

// Better Auth Instance
export const createAuth = (ctx: GenericCtx<DataModel>) => {
    return betterAuth(createAuthOptions(ctx));
};
