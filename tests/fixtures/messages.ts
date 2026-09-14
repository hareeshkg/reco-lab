import type { GmailMessage, MimePart } from "../../src/modules/gmail/contracts";

export const plainCall = `Company: Synthetic Motors Ltd
NSE: SYNTH
BSE: 500001
Category: Positional
Reference: SYN-001
Published: 2026-01-05T08:00:00+05:30
Action: BUY
CMP: Rs. 1,200
Entry: ₹1,180 - ₹1,220
Targets: 1,400 / 1,500
Stop-loss: 1,100
Upside: 16.67%
Horizon: 3 months
Rationale: Synthetic growth assumption for testing.`;
export function textPart(text = plainCall, mimeType = "text/plain"): MimePart {
  return {
    mimeType,
    body: {
      data: Buffer.from(text).toString("base64url"),
      size: Buffer.byteLength(text),
    },
  };
}
export function syntheticMessage(
  id = "synthetic-1",
  payload: MimePart = textPart(),
  receivedAt = "2026-01-05T04:00:00Z",
): GmailMessage {
  return {
    id,
    threadId: "synthetic-thread",
    internalDate: String(Date.parse(receivedAt)),
    payload: {
      ...payload,
      headers: [
        { name: "From", value: "Synthetic Research <research@example.test>" },
        { name: "Subject", value: "Synthetic Axis research call" },
        { name: "Date", value: "Mon, 05 Jan 2026 09:30:00 +0530" },
        ...(payload.headers ?? []),
      ],
    },
  };
}

export async function syntheticPdf(text = plainCall) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [index, line] of text
    .replaceAll("₹", "Rs. ")
    .split("\n")
    .entries())
    page.drawText(line, { x: 30, y: 790 - index * 22, size: 12, font });
  return pdf.save();
}
