import { describe, expect, it } from "vitest";
import { decodeNote, decodeProject, encodeNote, encodeProject } from "@/lib/model";
import { cleanPath, looksLikePath, materialMatches, looksLikeUrl, materialKind, normalizeUrl, titleFromPath, titleFromUrl } from "@/features/subjects/materials";

describe("materials", () => {
  it("names a pasted link by what it is", () => {
    expect(titleFromUrl("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit")).toBe("Google Slides");
    expect(titleFromUrl("https://moodle.example.edu/course/view.php?id=4412")).toBe("moodle.example.edu");
    expect(titleFromUrl("example.edu/files/formula-sheet.pdf")).toBe("Formula sheet");
    expect(titleFromUrl("https://en.wikipedia.org/wiki/Simple_harmonic_motion")).toBe("Simple harmonic motion");
    expect(titleFromUrl("https://github.com/foo/bar/tree/main")).toBe("foo/bar");
    expect(titleFromUrl("https://youtu.be/xyz")).toBe("YouTube video");
    expect(titleFromUrl("https://site.com/abc123def456ghi789/")).toBe("site.com");
    expect(titleFromUrl("www.khanacademy.org/science/physics/work-and-energy")).toBe("Work and energy");
  });

  it("tells links from plain items", () => {
    expect(looksLikeUrl("Campbell Biology")).toBe(false);
    expect(looksLikeUrl("example.com/x")).toBe(true);
    expect(looksLikeUrl("hello.txt is good")).toBe(false);
    expect(looksLikeUrl("localhost")).toBe(false);
    expect(normalizeUrl("example.com/x")).toBe("https://example.com/x");
  });

  it("picks an icon kind", () => {
    expect(materialKind({})).toBe("item");
    expect(materialKind({ url: "https://www.youtube.com/watch?v=1" })).toBe("video");
    expect(materialKind({ url: "https://docs.google.com/spreadsheets/d/1/edit" })).toBe("sheet");
    expect(materialKind({ url: "https://example.edu/a.pdf" })).toBe("pdf");
    expect(materialKind({ url: "https://example.edu/" })).toBe("link");
  });

  it("keeps the description, materials and pin through sync encoding", () => {
    const project = { id: "p", title: "Physics", colorValue: 1, description: "Exam in December", materials: [{ id: "m", title: "Book", addedAt: 1 }] };
    expect(decodeProject(encodeProject(project))).toEqual({ ...project, extra: undefined });
    expect(encodeProject({ id: "p", title: "Physics", colorValue: 1 })).toEqual({ id: "p", title: "Physics", colorValue: 1 });
    const note = decodeNote({ id: "n", title: "A", content: "", createdAt: "2026-01-01T00:00:00.000", pinnedAt: 5 });
    expect(note.pinnedAt).toBe(5);
    expect(encodeNote(note).pinnedAt).toBe(5);
    expect("pinnedAt" in encodeNote({ ...note, pinnedAt: undefined })).toBe(false);
  });

  it("takes file paths from a Mac, Windows or a file: link", () => {
    expect(looksLikePath("/Users/leo/Physics/lab-report_v2.pdf")).toBe(true);
    expect(looksLikePath("~/Documents/notes.docx")).toBe(true);
    expect(looksLikePath("C:\\Users\\leo\\essay.docx")).toBe(true);
    expect(looksLikePath("file:///Users/leo/My%20Notes.pdf")).toBe(true);
    expect(looksLikePath("example.com/x")).toBe(false);
    expect(looksLikePath("Campbell Biology")).toBe(false);
    expect(cleanPath("'/Users/leo/a b.pdf'")).toBe("/Users/leo/a b.pdf");
    expect(cleanPath("file:///Users/leo/My%20Notes.pdf")).toBe("/Users/leo/My Notes.pdf");
    expect(titleFromPath("/Users/leo/Physics/lab-report_v2.pdf")).toBe("Lab report v2");
    expect(materialKind({ path: "/a/b/slides.key" })).toBe("slides");
    expect(materialKind({ path: "/a/b/thing.zip" })).toBe("file");
  });

  it("finds materials by title, link, path or note", () => {
    const m = { id: "m", title: "Lecture notes", path: "/Users/leo/Chem/week4.pdf", detail: "Kinetics", addedAt: 1 };
    expect(materialMatches(m, "lecture")).toBe(true);
    expect(materialMatches(m, "week4")).toBe(true);
    expect(materialMatches(m, "kinetics chem")).toBe(true);
    expect(materialMatches(m, "physics")).toBe(false);
    expect(materialMatches({ id: "u", title: "Course page", url: "https://moodle.example.edu/course", addedAt: 1 }, "moodle")).toBe(true);
  });
});
