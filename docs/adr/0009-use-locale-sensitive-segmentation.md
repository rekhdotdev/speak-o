# Use locale-sensitive segmentation

Speak-O uses `Intl.Segmenter` with the Narration Language for sentence navigation and chunk boundaries, maintains exact offsets from the utterance back to Source Page ranges, and degrades from word to sentence highlighting whenever provider or browser offsets cannot be validated; this favors trustworthy multilingual highlighting over heuristics based on punctuation or spaces.
