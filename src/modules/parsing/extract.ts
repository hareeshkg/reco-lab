import { z } from "zod";
import {
  extractionSchema,
  fieldWarnings,
  PARSER_VERSION,
  type Extraction,
  type RecommendationFields,
} from "./contracts";

export function parseIndianNumber(raw: string): number | null {
  const clean = raw.trim().replace(/^(?:₹|INR|Rs\.?)[ ]*/i, "");
  const match = clean.match(
    /^((?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?)[ ]*(lakh|lac|crore)?$/i,
  );
  if (!match) return null;
  const value =
    Number(match[1].replaceAll(",", "")) *
    (/crore/i.test(match[2] ?? "")
      ? 1e7
      : /lakh|lac/i.test(match[2] ?? "")
        ? 1e5
        : 1);
  return Number.isFinite(value) && value > 0 && value <= 1e10 ? value : null;
}

function eventType(text: string): RecommendationFields["status"] {
  if (/\bwithdrawn?\b/i.test(text)) return "WITHDRAWN";
  if (/\btarget\s+(?:achieved|hit)\b/i.test(text)) return "TARGET_ACHIEVED";
  if (/\b(?:closed|close call|exit call)\b/i.test(text)) return "CLOSED";
  if (/\b(?:target revised|revised target)\b/i.test(text))
    return "TARGET_REVISED";
  if (/\b(?:stop(?: loss)? revised|revised stop)\b/i.test(text))
    return "STOP_REVISED";
  if (/\bupgraded?\b/i.test(text)) return "UPGRADED";
  if (/\bdowngraded?\b/i.test(text)) return "DOWNGRADED";
  if (/\breiterat(?:e|ed)\b/i.test(text)) return "REITERATED";
  if (/\bupdate\b/i.test(text)) return "UNKNOWN_UPDATE";
  return "NEW";
}

export function extractRecommendations(
  text: string,
  provider = "Axis Direct",
): Extraction[] {
  const blocks = text
    .replace(/\r/g, "")
    .split(/\n(?=\s*(?:Company|Stock)\s*:)|\n\s*---+\s*\n/)
    .filter((block) => block.trim());
  const extracted: Extraction[] = [];
  for (const block of blocks) {
    if (
      !/\b(?:buy|hold|sell|accumulate|reduce|target|stop[- ]?loss|closed|withdrawn|reiterated|upgraded?|downgraded?|update)\b/i.test(
        block,
      )
    )
      continue;
    const fields: RecommendationFields = {
      provider,
      category: null,
      reportReference: null,
      publishedAt: null,
      companyName: null,
      symbol: null,
      bseCode: null,
      action: null,
      recommendedPrice: null,
      entryLow: null,
      entryHigh: null,
      targets: [],
      stopLoss: null,
      statedUpsidePercent: null,
      horizon: null,
      rationale: null,
      status: eventType(block),
    };
    const evidence: Extraction["evidence"] = [];
    const warnings: string[] = [];
    function record(
      fieldName: string,
      value: unknown,
      snippet: string,
      confidence = 0.9,
    ) {
      evidence.push({
        fieldName,
        extractedValue: JSON.stringify(value),
        evidenceSnippet: snippet.trim().slice(0, 240),
        confidence,
        extractionMethod: "DETERMINISTIC",
      });
    }
    function line(pattern: RegExp) {
      return block.match(pattern);
    }
    record("provider", provider, "Provider confirmed in saved email source");
    const stringRules = {
      companyName: /(?:^|\n)\s*(?:Company|Stock)\s*:\s*([^\n]+)/i,
      symbol: /(?:^|\n)\s*(?:NSE(?: Symbol)?|Symbol)\s*:\s*([A-Za-z0-9&.-]+)/i,
      bseCode: /(?:^|\n)\s*BSE(?: Code)?\s*:\s*(\d{6})\b/i,
      category: /(?:^|\n)\s*(?:Category|Report Name)\s*:\s*([^\n]+)/i,
      reportReference: /(?:^|\n)\s*(?:Reference|Report ID)\s*:\s*([^\n]+)/i,
      horizon: /(?:^|\n)\s*(?:Horizon|Holding Period)\s*:\s*([^\n]+)/i,
      rationale: /(?:^|\n)\s*Rationale\s*:\s*([^\n]+)/i,
    } as const;
    for (const [key, pattern] of Object.entries(stringRules)) {
      const match = line(pattern);
      if (match) {
        const field = key as keyof typeof stringRules;
        fields[field] = match[1]
          .trim()
          .slice(
            0,
            field === "rationale"
              ? 240
              : field === "horizon" || field === "reportReference"
                ? 100
                : 160,
          );
        record(field, fields[field], match[0]);
      }
    }
    const action = block.match(/\b(BUY|HOLD|SELL|ACCUMULATE|REDUCE)\b/i);
    if (action) {
      fields.action = action[1].toUpperCase() as RecommendationFields["action"];
      record("action", fields.action, action[0]);
    }
    if (!fields.companyName) {
      const headline = block.match(
        /(?:^|\n)\s*(?:BUY|HOLD|SELL|ACCUMULATE|REDUCE)\s+([A-Za-z][A-Za-z .&()-]+?)(?=\s+(?:@|CMP|Target)|\n|$)/i,
      );
      if (headline) {
        fields.companyName = headline[1].trim();
        record("companyName", fields.companyName, headline[0], 0.75);
      }
    }
    if (!fields.companyName && !fields.symbol && !fields.bseCode) continue;
    const numericRules = {
      recommendedPrice:
        /(?:^|\n)\s*(?:CMP|Recommended Price|Market Price)\s*[:@]?\s*([^\n]+)/i,
      stopLoss:
        /(?:^|\n)\s*(?:Stop[- ]?Loss|SL|Revised Stop(?:[- ]?Loss)?)\s*:\s*([^\n]+)/i,
    } as const;
    for (const [key, pattern] of Object.entries(numericRules)) {
      const match =
        key === "stopLoss"
          ? (line(/(?:^|\n)\s*Revised Stop(?:[- ]?Loss)?\s*:\s*([^\n]+)/i) ??
            line(pattern))
          : line(pattern);
      if (match) {
        const field = key as keyof typeof numericRules;
        fields[field] = parseIndianNumber(match[1]);
        if (fields[field] === null)
          warnings.push(`MALFORMED_${field.toUpperCase()}`);
        else record(field, fields[field], match[0]);
      }
    }
    const entry = line(
      /(?:^|\n)\s*(?:Entry(?: Range| Price)?|Buy(?: Range)?)\s*[:@]\s*([^\n]+)/i,
    );
    if (entry) {
      const values = entry[1]
        .split(/\s*(?:–|—|-|\bto\b)\s*/i)
        .map(parseIndianNumber);
      if (values.length <= 2 && values.every((value) => value !== null)) {
        fields.entryLow = values[0];
        fields.entryHigh = values.at(-1) ?? null;
        record("entryLow", fields.entryLow, entry[0]);
        record("entryHigh", fields.entryHigh, entry[0]);
      } else warnings.push("MALFORMED_ENTRY_RANGE");
    }
    const revisedTargets = [
      ...block.matchAll(/(?:^|\n)\s*Revised Targets?\s*:\s*([^\n]+)/gi),
    ];
    const targetMatches = revisedTargets.length
      ? revisedTargets
      : [
          ...block.matchAll(
            /(?:^|\n)\s*(?:Targets?|T[1-9]|Target\s*\d+)\s*:\s*([^\n]+)/gi,
          ),
        ];
    for (const target of targetMatches) {
      const values = target[1].split(/\s*[/;|]\s*|,\s+/).map(parseIndianNumber);
      if (values.some((value) => value === null))
        warnings.push("MALFORMED_TARGET");
      else {
        fields.targets.push(...(values as number[]));
        record("targets", values, target[0]);
      }
    }
    const upside = line(
      /(?:^|\n)\s*(?:Upside|Stated Upside)\s*:\s*(\d+(?:\.\d+)?)\s*%/i,
    );
    if (upside) {
      fields.statedUpsidePercent = Number(upside[1]);
      record("statedUpsidePercent", fields.statedUpsidePercent, upside[0]);
    }
    const publication = line(
      /(?:^|\n)\s*(?:Published|Publication Date)\s*:\s*([^\n]+)/i,
    );
    if (publication) {
      const date = publication[1].trim();
      if (z.iso.datetime({ offset: true }).safeParse(date).success) {
        fields.publishedAt = new Date(date).toISOString();
        record("publishedAt", fields.publishedAt, publication[0]);
      } else warnings.push("UNTRUSTED_PUBLICATION_TIME");
    }
    record(
      "status",
      fields.status,
      block.split("\n").find((part) => eventType(part) !== "NEW") ??
        "New recommendation inferred",
      fields.status === "NEW" ? 0.7 : 0.9,
    );
    warnings.push(...fieldWarnings(fields));
    if (fields.status !== "NEW") warnings.push("UPDATE_REQUIRES_REVIEW");
    const candidate = extractionSchema.safeParse({
      fields,
      evidence,
      confidence: Math.max(0.2, 0.95 - warnings.length * 0.1),
      warnings,
      parserVersion: PARSER_VERSION,
    });
    if (candidate.success) extracted.push(candidate.data);
  }
  return extracted;
}
