// What the note's AI tools ask DeepSeek. Every tool shares one system prompt
// (who it's helping, how to write); each request then says exactly what to
// do and with which part of the note, so an answer is about the question
// asked, not a summary of the whole note.

import type { ChatMessage } from "./ai";

export interface NoteContext {
  title: string;
  subject?: string;
  /** The whole note, as Markdown. */
  markdown: string;
}

/** What a question or an explanation is about. */
export type Focus =
  | { kind: "selection"; text: string }
  | { kind: "section"; title: string; text: string }
  | { kind: "note" };

export const MAX_NOTE = 40_000;

const clip = (s: string, max = MAX_NOTE) => (s.length > max ? `${s.slice(0, max)}\n…(the rest of the note is cut off)` : s);

export function systemPrompt(note: NoteContext): ChatMessage {
  return {
    role: "system",
    content: `You are a sharp, friendly study tutor built into a student's notes app. You are working with one of their notes${note.subject ? ` for ${note.subject}` : ""}, titled "${note.title || "Untitled"}". It is given in Markdown between <note> tags.

How to work:
- Do exactly the task asked, nothing else. Never summarise or retell the note unless that is the task.
- The note is the student's own material: treat it as the main source and match its level. You also know the subject well: use that knowledge to explain, fill gaps and give examples, and point out a clear factual mistake in the note if it matters.
- Write in the language the note is written in (or the language of the question, if the student asks in another one).
- Be direct. No preamble ("Sure!", "Great question", "Based on your note…"), no closing offers ("Let me know if…"), no repeating the question.
- Format with Markdown: **bold** for key terms, "- " lists when listing, $…$ for inline maths and $$…$$ for display maths (LaTeX). No headings unless asked. Keep paragraphs short.`,
  };
}

const noteBlock = (note: NoteContext) => `<note>\n${clip(note.markdown)}\n</note>`;

function focusBlock(focus: Focus) {
  if (focus.kind === "selection") return `The student selected this part of the note:\n<selection>\n${clip(focus.text, 6000)}\n</selection>`;
  if (focus.kind === "section") return `The student is in the section "${focus.title}":\n<section>\n${clip(focus.text, 8000)}\n</section>`;
  return "";
}

/** A question about the note, with the conversation so far. */
export function askMessages(note: NoteContext, focus: Focus, turns: AskTurn[], question: string, images?: string[]): ChatMessage[] {
  const about =
    focus.kind === "selection"
      ? "The question is about the selected part; use the rest of the note as context."
      : focus.kind === "section"
        ? `The question is most likely about the section "${focus.title}"; use the rest of the note as context.`
        : "The question is about the note as a whole.";
  const rules = `Answer the student's question. ${about}
- Start with the answer itself in the first sentence, then support it.
- Fit the length to the question: a quick fact gets one or two sentences; "why", "how" or "explain" gets a short explanation with an example or a worked step; at most about 200 words unless they ask for more.
- If the note doesn't cover it, answer from your own knowledge and say "(not in your note)" once.
- Don't summarise the note or the section.
- If the student attaches a photo (a problem, a diagram, a page), work from it: for a problem, solve it step by step and explain each step, using the note's methods where they apply.`;
  const first = [noteBlock(note), focusBlock(focus), rules].filter(Boolean).join("\n\n");
  return [systemPrompt(note), ...conversation(first, turns, question, images)];
}

/**
 * The conversation after the system prompt: [first] (the material and the
 * rules) goes with the first question. Photos are sent again only with the
 * latest question that had any, so a long chat doesn't upload every photo
 * on each follow-up.
 */
function conversation(first: string, turns: AskTurn[], question: string, images?: string[]): ChatMessage[] {
  const lastPhotos = images?.length ? -1 : turns.findLastIndex((t) => t.images?.length);
  const messages: ChatMessage[] = [];
  turns.forEach((t, i) => {
    const text = i === 0 ? `${first}\n\nQuestion: ${t.q}` : t.q;
    messages.push({ role: "user", content: i === lastPhotos ? withImages(text, t.images) : t.images?.length ? `${text}\n(The photo sent with this question was shown earlier.)` : text });
    messages.push({ role: "assistant", content: t.a });
  });
  messages.push({ role: "user", content: withImages(turns.length === 0 ? `${first}\n\nQuestion: ${question}` : question, images) });
  return messages;
}

/** A question and its answer, with any photos attached to the question. */
export interface AskTurn {
  q: string;
  a: string;
  images?: string[];
}

/** Explains the selected part as a tutor would. */
export function explainMessages(note: NoteContext, selection: string): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

${focusBlock({ kind: "selection", text: selection })}

Explain the selected part so the student really understands it, as a good tutor would: what it means, why it is true or how it works, and one concrete example (for maths or science, a short worked step with numbers). Build on what the note already says instead of repeating it. 80 to 180 words.`,
    },
  ];
}

/** Revision bullets for the whole note. */
export function summaryMessages(note: NoteContext): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

Summarise the note for revision. Reply as JSON: {"points": ["...", "..."]}.
- 3 to 8 points (fewer for a short note), in the note's order.
- Each point states an actual fact, definition, formula, cause or result from the note, as something to remember. Never write "the note explains/covers X".
- Keep formulas in $…$ and key terms in **bold**. Nothing that isn't in the note.`,
    },
  ];
}

/** The terms worth knowing, with meanings. */
export function termsMessages(note: NoteContext): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

List the key terms a student must know from this note, most important first, at most 12. Reply as JSON: {"terms": [{"term": "...", "meaning": "..."}]}.
- term: as written in the note.
- meaning: one clear sentence. Use the note's definition when it gives one; otherwise give the standard definition at the note's level.
- Skip everyday words and anything only mentioned in passing.`,
    },
  ];
}

/** Practice questions that test understanding. */
export function quizMessages(note: NoteContext, count = 5): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

Write ${count} practice questions that test whether the student understands this material, the kind a teacher would put on a test. Reply as JSON: {"questions": [{"q": "...", "a": "..."}]}.
- Mix them: recall of a key fact or definition, explaining why or how, and (if the note has formulas or methods) applying one to a small example with numbers.
- Each question stands on its own; don't ask about the note's wording.
- Cover the important ideas across all of the material, not just the start.
- Each answer: 1 to 3 sentences, correct, based on the note (with the working for calculations). Maths in $…$.`,
    },
  ];
}

/** The next part of the note, written where the cursor is. */
export function continueMessages(note: NoteContext, before: string, after: string): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `Here is the note with the cursor marked as <cursor/>:
<note>
${before.length > 16000 ? `…${before.slice(-16000)}` : before}<cursor/>${after ? clip(after, 4000) : ""}
</note>

Write what should come next at the cursor: one or two short paragraphs, or a few list items. Match the note's format exactly (if the cursor is in a list, continue the list; if the note is in bullet points, write bullet points), its style and its level. Add new, correct content that naturally follows; don't repeat anything already in the note (including what comes after the cursor) and don't summarise. No heading unless a new section clearly starts here. Reply with only the new text.`,
    },
  ];
}

/** A rewrite of the selected part, in the same Markdown. */
export function editMessages(note: NoteContext, selection: string, how: "clearer" | "fix"): ChatMessage[] {
  const task =
    how === "fix"
      ? "Fix the spelling, grammar and punctuation of the selected text. Change nothing else: keep the wording where it is already right, the formatting (lists, bold, formulas) and the meaning."
      : "Rewrite the selected text so it is clearer and more concise, the way a strong student would write it in their notes. Keep every fact, number and formula, and keep its Markdown formatting (a list stays a list).";
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

${focusBlock({ kind: "selection", text: selection })}

${task} Reply with only the new text for the selection, nothing before or after it.`,
    },
  ];
}

/** The to-dos the note mentions. */
export function tasksMessages(note: NoteContext, today: string): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

Find the things the student has to do that this note mentions: homework, assignments, deadlines, readings, tests to prepare for. Today is ${today}. Only real to-dos stated or clearly implied in the note; don't invent study tasks for each topic. Reply as JSON: {"tasks": [{"title": "...", "date": "yyyy-MM-dd", "minutes": 30}]}, or {"tasks": []} if there are none.
- title: short and specific ("Read chapter 4", "Physics lab report").
- date: the deadline if one is given, otherwise a sensible day soon.
- minutes: a realistic estimate.`,
    },
  ];
}

/** Marks the student's answer to a practice question. */
export function checkAnswerMessages(note: NoteContext, question: string, modelAnswer: string, attempt: string): ChatMessage[] {
  return [
    systemPrompt(note),
    {
      role: "user",
      content: `${noteBlock(note)}

Mark the student's answer to this practice question, like a fair teacher.
Question: ${question}
Model answer: ${modelAnswer}
Student's answer: ${attempt}

Reply as JSON: {"verdict": "right" | "partly" | "wrong", "feedback": "..."}.
- "right" if it gets the key point, even in other words or with small slips; "partly" if something important is missing or slightly off; "wrong" if the key point is wrong or missing.
- feedback: one to three sentences, to the student ("you"). Say what's right, then exactly what's missing or wrong and the correct version. For a right answer, one short sentence is enough. Maths in $…$.`,
    },
  ];
}

/** One page to revise from, made from all of a subject's notes. */
export function revisionSheetMessages(material: NoteContext, examDay: string | null): ChatMessage[] {
  return [
    systemPrompt(material),
    {
      role: "user",
      content: `${noteBlock(material)}

Make a one-page revision sheet for ${material.subject ? `the ${material.subject} exam` : "the exam"}${examDay ? ` on ${examDay}` : ""} from these notes. This is what the student reads the night before.
- Use "## " headings for the main topics, in a sensible order (not necessarily the notes' order), and short "- " bullet points under them.
- Keep exactly what's worth remembering: definitions, key facts, formulas (in $…$ or $$…$$), causes and effects, methods, common mistakes. Bold the key terms.
- Merge repeats across notes. No filler, no "the notes cover". Nothing that isn't in the notes, except to fix a clear mistake.
- Aim for at most about 500 words.
- Headings are allowed here. Reply with only the sheet.`,
    },
  ];
}

/** A question answered from the notes most likely to cover it. */
export function askNotesMessages(sources: { title: string; subject?: string; markdown: string }[], turns: AskTurn[], question: string, images?: string[]): ChatMessage[] {
  const library = sources
    .map((n, i) => `<source id="${i + 1}" title="${n.title.replace(/"/g, "'") || "Untitled"}"${n.subject ? ` subject="${n.subject}"` : ""}>
${n.markdown}
</source>`)
    .join("\n\n");
  const system: ChatMessage = {
    role: "system",
    content: `You are a sharp, friendly study tutor built into a student's notes app. You answer questions from the student's own notes, given as numbered <source> blocks (the notes that best match the question).

How to answer:
- Start with the answer itself in the first sentence. Fit the length to the question; at most about 250 words unless asked for more.
- Use the notes as the main source. If they don't cover it, answer from your own knowledge and say "(not in your notes)" once.
- Write in the language of the question. No preamble, no closing offers.
- Format with Markdown: **bold** key terms, "- " lists, $…$ and $$…$$ for maths.
- If the student attaches a photo (a problem, a diagram, a page), work from it: for a problem, solve it step by step and explain each step, using the methods in their notes where they apply.
- On the very last line, write which sources you used, as "SOURCES: 2, 5" (or "SOURCES: none"). Nothing after it.`,
  };
  const first = `<notes>\n${library || "(no notes match)"}\n</notes>`;
  return [system, ...conversation(first, turns, question, images)];
}

/** Splits "SOURCES: 1, 3" off the end of an answer (also while it's still streaming in). */
export function splitSources(text: string): { text: string; sources: number[] } {
  // "SOURCES: 2, 5", also as "**Sources:** 2 and 5" or "SOURCES: none".
  const m = text.match(/(?:^|\n)[ \t*_]*SOURCES?[ \t*_]*:[ \t*_]*((?:none|n\/a|[\d\s,;&.]|and)*)[ \t*_.]*$/i);
  if (!m) {
    // A half-written "SOURC…" at the very end shouldn't flash up either.
    return { text: text.replace(/\n[ \t*_]*S(?:O(?:U(?:R(?:C(?:E(?:S)?)?)?)?)?)?$/, "").trimEnd(), sources: [] };
  }
  const sources = [...new Set([...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])))];
  return { text: text.slice(0, m.index).trimEnd(), sources };
}

/** The question's text with its photos, as one message. */
export function withImages(text: string, images?: string[]): ChatMessage["content"] {
  if (!images?.length) return text;
  return [{ type: "text", text }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
}

/**
 * Photos of study material (a textbook page, a whiteboard, handwritten
 * notes) written up as a note. With [into], the text is added to that note
 * instead, so it fits in and skips the title.
 */
export function photoNoteMessages(images: string[], opts: { subject?: string; into?: NoteContext }): ChatMessage[] {
  const many = images.length > 1;
  const rules = `Turn ${many ? `these ${images.length} photos (in order, as one continuous piece)` : "this photo"} of study material into clean study notes in Markdown.
- Read everything carefully, including handwriting and text at an angle. Keep all of the content: this is a write-up, not a summary. If a word can't be read, write [?].
- Structure it: "## " headings for sections, "- " lists, numbered lists for steps, **bold** for key terms and definitions.
- Formulas and equations in LaTeX: $…$ inline, $$…$$ on their own line. Tables become lists ("- **Column**: value").
- For a diagram or graph, write one short line in italics saying what it shows and its labels.
- Leave out page numbers, running headers, exercise numbering noise and anything that isn't content.
- Write in the language of the page.
${opts.into ? "- This is being added to the student's note shown above: no title, don't repeat what's already in it." : `- Start with a short title for the note on the first line as "# Title"${opts.subject ? ` (the subject is ${opts.subject})` : ""}.`}
Reply with only the notes.`;
  return [
    {
      role: "system",
      content: "You turn photos of a secondary-school student's study material into accurate, well-organised notes for their notes app.",
    },
    { role: "user", content: withImages(opts.into ? `${noteBlock(opts.into)}

${rules}` : rules, images) },
  ];
}

/** Strips a code fence or a stray label the model sometimes wraps text in. */
export function cleanText(text: string) {
  return text
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1")
    .replace(/^(?:rewritten|corrected|answer)(?: text)?:\s*/i, "")
    .trim();
}
