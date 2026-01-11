import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    words: defineTable({
        word: v.string(),
        lang_code: v.string(),
        lang: v.string(),
        pos: v.string(), // part of speech
        ipa: v.optional(v.string()),
        form: v.array(
            v.object({
                word_id: v.id("words"),
                tags: v.array(v.string()),
            }),
        ),
    }),
});
