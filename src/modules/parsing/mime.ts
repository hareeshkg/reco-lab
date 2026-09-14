import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import {
  type GmailMessage,
  type MimePart,
  messageSchema,
} from "@/modules/gmail/contracts";
import { AppError } from "@/modules/security/errors";

const MAX_BYTES = 20 * 1024 * 1024;
export async function pdfText(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages > 100) throw new AppError("PDF_PAGE_LIMIT");
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join(""),
      );
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

export async function parseMime(
  input: GmailMessage,
  getAttachment: (attachmentId: string) => Promise<string>,
  extractPdf = pdfText,
) {
  const message = messageSchema.parse(input);
  const hash = createHash("sha256");
  hash.update(JSON.stringify(message.payload.headers ?? []));
  let totalBytes = 0;
  let hasPdfAttachment = false;
  const warnings: string[] = [];
  async function walk(part: MimePart, depth: number): Promise<string[]> {
    if (depth > 20) throw new AppError("MIME_DEPTH_LIMIT");
    const mime = (part.mimeType ?? "").toLowerCase();
    hash.update(mime);
    if (part.parts?.length) {
      const children: string[][] = [];
      for (const child of part.parts)
        children.push(await walk(child, depth + 1));
      if (mime === "multipart/alternative") {
        const plain = part.parts.findIndex(
          (child) => child.mimeType === "text/plain",
        );
        return plain >= 0 && children[plain].some((text) => text.trim())
          ? children[plain]
          : (children.find((child) => child.some((text) => text.trim())) ?? []);
      }
      return children.flat();
    }
    if (!["text/plain", "text/html", "application/pdf"].includes(mime)) {
      if (part.filename || part.body?.attachmentId)
        warnings.push("UNSUPPORTED_ATTACHMENT");
      return [];
    }
    if ((part.body?.size ?? 0) > MAX_BYTES)
      throw new AppError("ATTACHMENT_TOO_LARGE");
    const encoded =
      part.body?.data ??
      (part.body?.attachmentId
        ? await getAttachment(part.body.attachmentId)
        : "");
    const bytes = Buffer.from(encoded, "base64url");
    totalBytes += bytes.length;
    if (totalBytes > MAX_BYTES) throw new AppError("MESSAGE_TOO_LARGE");
    hash.update(bytes);
    if (mime === "application/pdf") {
      hasPdfAttachment = true;
      try {
        const text = await extractPdf(bytes);
        if (!text.trim()) warnings.push("PDF_NO_TEXT_OCR_UNAVAILABLE");
        return [text];
      } catch {
        warnings.push("PDF_EXTRACTION_FAILED");
        return [];
      }
    }
    const contentType =
      part.headers?.find(
        (header) => header.name.toLowerCase() === "content-type",
      )?.value ?? "";
    const charset =
      contentType.match(/charset=["']?([^\s;"']+)/i)?.[1] ?? "utf-8";
    let text: string;
    try {
      text = new TextDecoder(charset).decode(bytes);
    } catch {
      warnings.push("UNSUPPORTED_CHARSET");
      text = bytes.toString("utf8");
    }
    return [
      mime === "text/html"
        ? convert(text, {
            wordwrap: false,
            selectors: [
              { selector: "a", options: { ignoreHref: true } },
              { selector: "img", format: "skip" },
              { selector: "table", options: { uppercaseHeaderCells: false } },
            ],
          })
        : text,
    ];
  }
  const texts = await walk(message.payload, 0);
  return {
    texts,
    contentSha256: hash.digest("hex"),
    hasPdfAttachment,
    warnings: [...new Set(warnings)],
  };
}
