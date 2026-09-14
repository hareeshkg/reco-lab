import { expect, test } from "@playwright/test";

test("setup shows read-only scope and OAuth uses PKCE", async ({
  page,
  request,
}) => {
  await page.goto("/setup");
  await expect(
    page.getByRole("heading", { name: "Gmail connection" }),
  ).toBeVisible();
  await expect(page.getByText("DISCONNECTED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("https://www.googleapis.com/auth/gmail.readonly", {
      exact: true,
    }),
  ).toBeVisible();
  const response = await request.get("/api/auth/google", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location);
  expect(location.searchParams.get("scope")).toBe(
    "https://www.googleapis.com/auth/gmail.readonly",
  );
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("state")).toBeTruthy();
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
  const rejected = await request.get(
    "/api/auth/google/callback?state=incorrect&code=synthetic",
    { maxRedirects: 0 },
  );
  expect(rejected.headers().location).toContain("OAUTH_FAILED_RECONNECT");
});

test("review corrects, approves, audits and rejects a synthetic recommendation", async ({
  page,
}) => {
  await page.goto("/review");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic Motors Ltd" }),
  ).toBeVisible();
  await expect(
    page.getByText("INSTRUMENT_UNVERIFIED_PHASE_2", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Field evidence and extraction methods", { exact: true })
    .click();
  await expect(
    page
      .getByRole("cell", { name: "Entry: ₹1,180 - ₹1,220", exact: true })
      .first(),
  ).toBeVisible();
  await page.getByText("Correct extracted fields", { exact: true }).click();
  await page.getByLabel("Stop-loss", { exact: true }).fill("1080");
  await page
    .getByLabel("Correction reason", { exact: true })
    .fill("Verified synthetic stop from source");
  await page
    .getByRole("button", { name: "Save correction for review" })
    .click();
  await expect(
    page.getByRole("cell", { name: "Manually corrected", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(
      "I reviewed the evidence, missing fields, and lifecycle relationship.",
    )
    .check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator(".badge", { hasText: "APPROVED" })).toBeVisible();
  await page.getByText("Version history (3)", { exact: true }).click();
  await expect(
    page.getByText(/Revision 2 · Verified synthetic stop/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.locator(".badge", { hasText: "REJECTED" })).toBeVisible();
  await page.screenshot({
    path: "test-results/review-audit.png",
    fullPage: true,
  });
});

test("inbox requires source confirmation and message selection with mocked Gmail transport", async ({
  page,
}) => {
  await page.route("**/api/gmail/preview", async (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            id: "ui-synthetic",
            threadId: "ui-thread",
            from: "research@example.test",
            subject: "Synthetic Axis research call",
            receivedAt: "2026-01-05T04:00:00.000Z",
            sentAt: null,
          },
        ],
        nextPageToken: null,
        estimatedTotal: 1,
        senders: ["research@example.test"],
        subjects: ["Synthetic Axis research call"],
        dateCoverage: { first: "2026-01-05", last: "2026-01-05" },
      },
    }),
  );
  await page.route("**/api/gmail/sources", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const data = route.request().postDataJSON();
    expect(data.confirmed).toBe(true);
    expect(data.acceptedSenders).toEqual(["research@example.test"]);
    return route.fulfill({
      json: {
        id: "ui-source",
        gmailQuery: data.query,
        accountEmail: "owner@example.test",
        acceptedSendersJson: JSON.stringify(data.acceptedSenders),
        subjectPatternsJson: JSON.stringify(data.subjectPatterns),
        after: null,
        before: null,
      },
    });
  });
  await page.route("**/api/gmail/import", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      sourceId: "ui-source",
      messageIds: ["ui-synthetic"],
    });
    await route.fulfill({
      json: {
        results: [
          {
            gmailMessageId: "ui-synthetic",
            id: "ui-import",
            status: "PARSED",
            error: null,
          },
        ],
      },
    });
  });
  await page.goto("/inbox");
  await page.getByLabel("Gmail query", { exact: true }).fill("Synthetic");
  await page.getByRole("button", { name: "Preview metadata" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the source" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save confirmed source" }),
  ).toBeDisabled();
  await page.getByLabel("research@example.test", { exact: true }).check();
  await page
    .getByLabel("Accepted subject patterns — one literal substring per line")
    .fill("Axis research");
  await page
    .getByLabel(
      "I reviewed these senders and subject patterns and confirm they identify my Axis Direct research.",
    )
    .check();
  await page.getByRole("button", { name: "Save confirmed source" }).click();
  await expect(page.getByText("SOURCE SAVED", { exact: true })).toBeVisible();
  await page.getByLabel("Select Synthetic Axis research call").check();
  await page.getByRole("button", { name: "Import selected (1)" }).click();
  await expect(
    page.getByRole("heading", { name: "Batch results" }),
  ).toBeVisible();
});

test("API blocks cross-origin writes and exposes disconnected import errors", async ({
  request,
}) => {
  const blocked = await request.post("/api/auth/google/disconnect", {
    headers: { Origin: "https://outside.example.test" },
  });
  expect(blocked.status()).toBe(403);
  const result = await request.post("/api/gmail/preview", {
    headers: { Origin: "http://localhost:3100" },
    data: { query: "Synthetic" },
  });
  expect(result.status()).toBe(409);
  expect(await result.json()).toEqual({ error: "GMAIL_NOT_CONNECTED" });
});

test("manual entry adds a missed recommendation with source evidence", async ({
  page,
}) => {
  await page.goto("/inbox");
  await page
    .getByRole("link", { name: "Add missed recommendation" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Add a missed recommendation" }),
  ).toBeVisible();
  await page
    .getByLabel("Company name", { exact: true })
    .fill("Manual Synthetic Ltd");
  await page
    .getByLabel("Correction reason", { exact: true })
    .fill("Read synthetic call in original source");
  await page
    .getByRole("button", { name: "Save correction for review" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Manual Synthetic Ltd" }),
  ).toBeVisible();
  await expect(
    page.getByText("MISSING_STOP_LOSS", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Field evidence and extraction methods", { exact: true })
    .click();
  await expect(
    page
      .getByRole("cell", {
        name: "Read synthetic call in original source",
        exact: true,
      })
      .first(),
  ).toBeVisible();
});

test("local data deletion requires explicit confirmation and clears imports", async ({
  page,
}) => {
  await page.goto("/setup");
  await expect(
    page.getByRole("button", { name: "Delete local data", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Type DELETE LOCAL DATA to confirm")
    .fill("DELETE LOCAL DATA");
  await page
    .getByRole("button", { name: "Delete local data", exact: true })
    .click();
  await expect(
    page.getByLabel("Type DELETE LOCAL DATA to confirm"),
  ).toHaveValue("");
  await page.goto("/recommendations");
  await expect(
    page.getByText("0 recommendations", { exact: true }),
  ).toBeVisible();
});
