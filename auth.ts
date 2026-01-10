import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { expo } from '@better-auth/expo'
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
// import { query } from "./_generated/server";
import authSchema from "./betterAuth/schema";
import { sendEmail } from "./sendEmail";

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel, typeof authSchema>(
    components.betterAuth,
    {
        local: {
            schema: authSchema,
        },
    }
);

export const createAuth = (
    ctx: GenericCtx<DataModel>,
    { optionsOnly } = { optionsOnly: false },
) => {
    return betterAuth({
        // disable logging when createAuth is called just to generate options.
        // this is not required, but there's a lot of noise in logs without it.
        logger: {
            disabled: optionsOnly,
        },
        trustedOrigins: ["sapo://", "https://appleid.apple.com"],
        database: authComponent.adapter(ctx),
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
            // The Expo and Convex plugins are required
            expo(),
            convex(),
        ],
    });
};

// Example function for getting the current user
// Feel free to edit, omit, etc.
// export const getCurrentUser = query({
//     args: {},
//     handler: async (ctx) => {
//         return authComponent.getAuthUser(ctx);
//     },
// });
