import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";

const resend: Resend = new Resend(components.resend, { testMode: false });

export async function sendEmail(
    ctx: any,
    to: string,
    subject: string,
    template: {
        id: string;
        variables?: Record<string, string | number>;
    }
) {
    await resend.sendEmail(ctx, {
        from: "S A P O <donotreply@sapo.surf>",
        to: to,
        subject: subject,
        template: template,
    });
}
