import { expect, it } from "vitest";
import { bibliography, inText, personName, plainReference, reference, type Source } from "../sources";

const base = { id: "x", createdAt: 0 };
const article: Source = {
  ...base,
  kind: "article",
  title: "Climate change and coral reefs",
  authors: ["Hughes, Terry P.", "Kerry, James T."],
  date: "2018-04-19",
  container: "Nature",
  volume: "556",
  issue: "7702",
  pages: "492-496",
  doi: "10.1038/s41586-018-0041-2",
};
const book: Source = { ...base, kind: "book", title: "Macbeth", authors: ["Shakespeare, William"], publisher: "Penguin", date: "2005" };
const web: Source = {
  ...base,
  kind: "web",
  title: "How vaccines work",
  authors: ["World Health Organization"],
  container: "WHO",
  date: "2020-12-08",
  url: "https://www.who.int/news-room/feature-stories/detail/how-do-vaccines-work",
};

it("formats MLA 9 references", () => {
  expect(plainReference(article, "mla")).toBe(
    "Hughes, Terry P., and James T. Kerry. “Climate change and coral reefs.” Nature, vol. 556, no. 7702, 19 Apr. 2018, pp. 492–496, https://doi.org/10.1038/s41586-018-0041-2.",
  );
  expect(plainReference(book, "mla")).toBe("Shakespeare, William. Macbeth. Penguin, 2005.");
  expect(plainReference(web, "mla")).toBe(
    "World Health Organization. “How vaccines work.” WHO, 8 Dec. 2020, www.who.int/news-room/feature-stories/detail/how-do-vaccines-work.",
  );
  expect(reference(book, "mla")).toContainEqual({ text: "Macbeth", italic: true });
});

it("formats APA 7 references", () => {
  expect(plainReference(article, "apa")).toBe(
    "Hughes, T. P., & Kerry, J. T. (2018). Climate change and coral reefs. Nature, 556(7702), 492–496. https://doi.org/10.1038/s41586-018-0041-2",
  );
  expect(plainReference(book, "apa")).toBe("Shakespeare, W. (2005). Macbeth. Penguin.");
  expect(plainReference(web, "apa")).toBe(
    "World Health Organization. (2020, December 8). How vaccines work. WHO. https://www.who.int/news-room/feature-stories/detail/how-do-vaccines-work",
  );
  expect(reference(article, "apa")).toContainEqual({ text: "556", italic: true });
});

it("makes in-text citations", () => {
  expect(inText(article, "mla", "493")).toBe("(Hughes and Kerry 493)");
  expect(inText(article, "apa")).toBe("(Hughes & Kerry, 2018)");
  expect(inText({ ...book, date: undefined }, "apa")).toBe("(Shakespeare, n.d.)");
  expect(inText({ ...web, authors: [] }, "mla")).toBe("(“How vaccines work”)");
  expect(inText({ ...article, authors: ["A, B", "C, D", "E, F"] }, "apa")).toBe("(A et al., 2018)");
});

it("reads people's names and sorts a bibliography", () => {
  expect(personName("Jane Q. Smith")).toBe("Smith, Jane Q.");
  expect(personName("Ludwig van Beethoven")).toBe("van Beethoven, Ludwig");
  expect(personName("World Health Organization")).toBe("World Health Organization");
  expect(personName("BBC News")).toBe("BBC News");
  expect(bibliography([web, article, book], "mla").map((s) => s.kind)).toEqual(["article", "book", "web"]);
});

it("recognises DOIs, ISBNs and addresses, and reads Crossref records", async () => {
  const { identify, fromCrossref, isoDate } = await import("../sourceLookup");
  expect(identify("https://doi.org/10.1038/s41586-018-0041-2")).toEqual({ doi: "10.1038/s41586-018-0041-2" });
  expect(identify("ISBN 978-0-14-139631-6")).toEqual({ isbn: "9780141396316" });
  expect(identify("who.int/news")).toEqual({ url: "https://who.int/news" });
  expect(identify("just words")).toBeNull();
  expect(isoDate([2018, 4, 19])).toBe("2018-04-19");
  expect(isoDate("2015")).toBe("2015");
  expect(isoDate("2020-12-08T10:00:00Z")).toBe("2020-12-08");
  expect(
    fromCrossref({
      type: "journal-article",
      title: ["Climate change and coral reefs"],
      author: [{ given: "Terry P.", family: "Hughes" }],
      issued: { "date-parts": [[2018, 4, 19]] },
      "container-title": ["Nature"],
      volume: "556",
      DOI: "10.1038/x",
    }),
  ).toMatchObject({ kind: "article", authors: ["Hughes, Terry P."], date: "2018-04-19", container: "Nature" });
});
