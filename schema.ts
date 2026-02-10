import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    languages: defineTable({
        language_code: v.string(),
        name: v.string(),
    })
        .index("by_language_code", ['language_code']),

    entries: defineTable({
        orthographic_form: v.string(),
        frequency: v.number(),
        language_id: v.id("languages"),
        language_code: v.string(),

        // The following fields could be an enhancement in the future to add information to words by extracting data from wiktionary via wiktextract
        // part_of_speech: v.string(),
        // categories: v.array(v.string()),
        // derived: v.array(
        //     v.object({
        //         form: v.string(),
        //         raw_tags: v.array(v.string()),
        //         tags: v.array(v.string()),
        //     })
        // ),
        // etymology_texts: v.array(v.string()),
        // forms: v.array(
        //     v.object({
        //         entry_id: v.id("entries"),
        //         tags: v.array(v.string()),
        //         raw_tags: v.array(v.string()),
        //     }),
        // ),
        // senses: v.array(
        //     v.object({
        //         glosses: v.array(v.string()),
        //         tags: v.array(v.string()),
        //         categories: v.array(v.string()),
        //         examples: v.array(
        //             v.object({
        //                 text: v.string(),
        //                 bold_text_offsets: v.string()
        //             })
        //         )
        //     }),
        // ),
    })
        .index("by_orth", ["orthographic_form"])
        .index("by_language_and_orth", ["language_code", "orthographic_form"]),

    phonetic_transcriptions: defineTable({
        entry_id: v.id("entries"),
        source_language_id: v.id("languages"),
        source_language_code: v.string(),
        target_language_id: v.id("languages"),
        target_language_code: v.string(),
        respelling: v.string(),
        ipa: v.string(),
    })
        .index("by_source_entry_target", ["source_language_code", "entry_id", "target_language_code"])
});
