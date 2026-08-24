# Extract semantic Articles with strict source mapping

Speak-O first honors an explicit Selection, then uses a recognized Site Adapter such as X Articles, and otherwise applies Mozilla Readability to a cloned document before validating visible content and mapping narratable spans back to original Source Page text nodes. It rejects materially incomplete or ambiguous mappings and falls back to Selection instead of guessing highlight positions; this trades nominal coverage for trustworthy narration and permits new Site Adapters only when fixture-backed failures justify them.
