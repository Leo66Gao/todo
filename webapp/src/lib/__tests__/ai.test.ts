import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiError, chatJson, chatStream, readJson, useAiKey } from "../ai";
import { askNotesMessages, askMessages, splitSources } from "../notePrompts";

const sse = (chunks: string[], status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
    { status },
  );
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

const fetchMock = vi.fn();
beforeEach(() => {
  useAiKey.setState({ key: "fake-test-key", model: "deepseek-flash" });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

it("streams text, including a last line without a line break and chunks split mid-line", async () => {
  const last = delta(" world").trimEnd();
  fetchMock.mockResolvedValue(sse([delta("Hello"), last.slice(0, 20), last.slice(20)]));
  const seen: string[] = [];
  expect(await chatStream([{ role: "user", content: "hi" }], { onText: (t) => seen.push(t) })).toBe("Hello world");
  expect(seen).toEqual(["Hello", "Hello world"]);
});

it("turns a dropped connection mid-answer into a readable error", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(delta("Half")));
          controller.error(new TypeError("network"));
        },
      }),
    ),
  );
  await expect(chatStream([{ role: "user", content: "hi" }], { onText: () => {} })).rejects.toThrow(/dropped/);
});

it("asks again plainly when reasoning or JSON mode is refused", async () => {
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Here you go:\n{"points": ["a"]}' } }] })));
  expect(await chatJson([{ role: "user", content: "x" }], undefined, "think")).toEqual({ points: ["a"] });
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const second = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(first).toMatchObject({ thinking: { type: "enabled" }, response_format: { type: "json_object" } });
  expect(second.thinking).toEqual({ type: "disabled" });
  expect(second.response_format).toBeUndefined();
});

it("doesn't loop on a plain request that is refused", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
  await expect(chatStream([{ role: "user", content: "x" }], { onText: () => {} })).rejects.toBeInstanceOf(AiError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reads JSON bare, fenced or with words around it", () => {
  expect(readJson('{"a":1}')).toEqual({ a: 1 });
  expect(readJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(readJson('Sure.\n{"a": {"b": 2}}\nDone.')).toEqual({ a: { b: 2 } });
  expect(readJson("no json")).toBeUndefined();
});

it("reads the sources line in the forms models write it", () => {
  expect(splitSources("Answer.\n**Sources:** 2 and 5.")).toEqual({ text: "Answer.", sources: [2, 5] });
  expect(splitSources("Answer.\nSOURCES: none")).toEqual({ text: "Answer.", sources: [] });
  expect(splitSources("Answer.\nSources: 3, 3")).toEqual({ text: "Answer.", sources: [3] });
  expect(splitSources("Answer.\n**SOU")).toEqual({ text: "Answer.", sources: [] });
  expect(splitSources("Main sources: the sun and wind")).toEqual({ text: "Main sources: the sun and wind", sources: [] });
});

it("sends earlier photos only with the latest question that had them", () => {
  const note = { title: "Waves", markdown: "# Waves" };
  const turns = [
    { q: "first", a: "1", images: ["data:A"] },
    { q: "second", a: "2", images: ["data:B"] },
    { q: "third", a: "3" },
  ];
  const urls = (m: ReturnType<typeof askMessages>) =>
    m.flatMap((x) => (Array.isArray(x.content) ? x.content.flatMap((p) => (p.type === "image_url" ? [p.image_url.url] : [])) : []));
  expect(urls(askMessages(note, { kind: "note" }, turns, "fourth"))).toEqual(["data:B"]);
  expect(urls(askMessages(note, { kind: "note" }, turns, "fourth", ["data:C"]))).toEqual(["data:C"]);
  const ask = askNotesMessages([], turns, "fourth");
  expect(urls(ask)).toEqual(["data:B"]);
  expect(ask[1].content).toContain("shown earlier");
  expect(ask[1].content).toContain("<notes>");
});
