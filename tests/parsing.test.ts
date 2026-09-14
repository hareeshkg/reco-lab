import { describe, expect, it } from "vitest";
import {
  extractRecommendations,
  parseIndianNumber,
} from "../src/modules/parsing/extract";
import { parseMime } from "../src/modules/parsing/mime";
import {
  plainCall,
  syntheticMessage,
  syntheticPdf,
  textPart,
} from "./fixtures/messages";

describe("deterministic extraction", () => {
  it("uses explicitly revised prices when old and new levels are both quoted", () => {
    const result = extractRecommendations(
      plainCall + "\nRevised Target: 1,600\nRevised Stop Loss: 1,150",
    )[0];
    expect(result.fields.targets).toEqual([1600]);
    expect(result.fields.stopLoss).toBe(1150);
  });
  it("rejects impossible calendar dates instead of normalizing them", () => {
    const result = extractRecommendations(
      plainCall.replace(
        "2026-01-05T08:00:00+05:30",
        "2026-02-30T08:00:00+05:30",
      ),
    )[0];
    expect(result.fields.publishedAt).toBeNull();
    expect(result.warnings).toContain("UNTRUSTED_PUBLICATION_TIME");
  });
  it("extracts plain text, multiple targets, CMP, entry range, evidence and provenance", () => {
    const [result] = extractRecommendations(plainCall);
    expect(result.fields).toMatchObject({
      companyName: "Synthetic Motors Ltd",
      symbol: "SYNTH",
      entryLow: 1180,
      entryHigh: 1220,
      targets: [1400, 1500],
      recommendedPrice: 1200,
      stopLoss: 1100,
      publishedAt: "2026-01-05T02:30:00.000Z",
      horizon: "3 months",
    });
    expect(
      result.evidence.find((field) => field.fieldName === "entryLow")
        ?.evidenceSnippet,
    ).toContain("₹1,180");
    expect(result.parserVersion).toBe("axis-rules/1.0.0");
    expect(result.warnings).toContain("INSTRUMENT_UNVERIFIED_PHASE_2");
  });
  it("extracts multiple recommendations", () => {
    expect(
      extractRecommendations(
        plainCall +
          "\n" +
          plainCall
            .replace("Synthetic Motors Ltd", "Synthetic Steel Ltd")
            .replace("SYNTH", "STEEL"),
      ),
    ).toHaveLength(2);
  });
  it("never manufactures missing stops or targets from upside", () => {
    const [result] = extractRecommendations(
      plainCall
        .replace("Stop-loss: 1,100\n", "")
        .replace("Targets: 1,400 / 1,500\n", ""),
    );
    expect(result.fields.stopLoss).toBeNull();
    expect(result.fields.targets).toEqual([]);
    expect(result.warnings).toContain("MISSING_STOP_LOSS");
  });
  it.each([
    ["Revised Target: 1,600", "TARGET_REVISED"],
    ["Revised Stop Loss: 1,150", "STOP_REVISED"],
    ["Status: Closed", "CLOSED"],
    ["Status: Withdrawn", "WITHDRAWN"],
    ["Target achieved", "TARGET_ACHIEVED"],
    ["Reiterated BUY", "REITERATED"],
    ["Upgraded", "UPGRADED"],
    ["Downgraded", "DOWNGRADED"],
    ["Update", "UNKNOWN_UPDATE"],
  ])("recognizes lifecycle %s", (text, status) => {
    const [result] = extractRecommendations(
      `Company: Synthetic Motors Ltd\nNSE: SYNTH\n${text}`,
    );
    expect(result.fields.status).toBe(status);
  });
  it("flags malformed numbers and inverted entry ranges", () => {
    const [result] = extractRecommendations(
      plainCall
        .replace("CMP: Rs. 1,200", "CMP: 1,2,00")
        .replace("₹1,180 - ₹1,220", "1300 - 1200"),
    );
    expect(result.fields.recommendedPrice).toBeNull();
    expect(result.warnings).toContain("MALFORMED_RECOMMENDEDPRICE");
    expect(result.warnings).toContain("INVALID_ENTRY_RANGE");
  });
  it("does not parse newsletters without a recommendation", () => {
    expect(
      extractRecommendations("Hello, our newsletter is available. Thank you."),
    ).toEqual([]);
  });
  it("rejects untrusted publication dates", () => {
    expect(
      extractRecommendations(
        plainCall.replace("2026-01-05T08:00:00+05:30", "05/01/26"),
      )[0].warnings,
    ).toContain("UNTRUSTED_PUBLICATION_TIME");
  });
  it.each([
    ["1,00,000", 100000],
    ["1.5 lakh", 150000],
    ["2 crore", 20000000],
    ["₹1,234.50", 1234.5],
    ["Rs. 1,234", 1234],
    ["1,2,3", null],
    ["NaN", null],
    ["-10", null],
    ["123x", null],
    ["1.2.3", null],
  ])("parses Indian numbers %s", (input, expected) => {
    expect(parseIndianNumber(input)).toBe(expected);
  });
});

describe("MIME and PDF", () => {
  it("converts HTML without fetching images or retaining markup", async () => {
    const html =
      plainCall
        .split("\n")
        .map((line) => `<div>${line}</div>`)
        .join("") +
      '<img src="https://example.test/tracker"><script>secret</script>';
    const result = await parseMime(
      syntheticMessage("html", textPart(html, "text/html")),
      async () => "",
    );
    expect(
      extractRecommendations(result.texts.join("\n"))[0].fields.targets,
    ).toEqual([1400, 1500]);
    expect(result.texts[0]).not.toContain("<script>");
  });
  it("deduplicates multipart alternatives and walks nested MIME", async () => {
    const result = await parseMime(
      syntheticMessage("nested", {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [textPart(), textPart(`<p>${plainCall}</p>`, "text/html")],
          },
        ],
      }),
      async () => "",
    );
    expect(result.texts).toHaveLength(1);
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("extracts a real synthetic PDF-only attachment in memory", async () => {
    const bytes = await syntheticPdf();
    const result = await parseMime(
      syntheticMessage("pdf", {
        mimeType: "application/pdf",
        filename: "synthetic.pdf",
        body: { attachmentId: "attachment-1", size: bytes.length },
      }),
      async () => Buffer.from(bytes).toString("base64url"),
    );
    expect(result.hasPdfAttachment).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(
      extractRecommendations(result.texts.join("\n"))[0].fields.companyName,
    ).toBe("Synthetic Motors Ltd");
  });
  it("flags unsupported attachments without downloading them", async () => {
    const result = await parseMime(
      syntheticMessage("unsupported", {
        mimeType: "application/zip",
        filename: "synthetic.zip",
        body: { attachmentId: "zip" },
      }),
      async () => {
        throw new Error("must not download");
      },
    );
    expect(result.warnings).toContain("UNSUPPORTED_ATTACHMENT");
  });
  it("flags damaged PDF and scanned PDF without text", async () => {
    const message = syntheticMessage("broken-pdf", {
      mimeType: "application/pdf",
      body: { data: Buffer.from("invalid").toString("base64url") },
    });
    expect((await parseMime(message, async () => "")).warnings).toContain(
      "PDF_EXTRACTION_FAILED",
    );
    expect(
      (
        await parseMime(
          message,
          async () => "",
          async () => "",
        )
      ).warnings,
    ).toContain("PDF_NO_TEXT_OCR_UNAVAILABLE");
  });
  it("rejects oversized attachments before fetching", async () => {
    await expect(
      parseMime(
        syntheticMessage("large", {
          mimeType: "application/pdf",
          body: { attachmentId: "large", size: 30_000_000 },
        }),
        async () => "",
      ),
    ).rejects.toThrow("ATTACHMENT_TOO_LARGE");
  });
  it("produces stable hashes that change with content", async () => {
    const first = await parseMime(syntheticMessage(), async () => "");
    expect(
      (await parseMime(syntheticMessage(), async () => "")).contentSha256,
    ).toBe(first.contentSha256);
    expect(
      (
        await parseMime(
          syntheticMessage("changed", textPart(plainCall + " changed")),
          async () => "",
        )
      ).contentSha256,
    ).not.toBe(first.contentSha256);
  });
});
