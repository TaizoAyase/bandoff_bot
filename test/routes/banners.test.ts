import { describe, expect, it } from "vitest";
import { closeEvent, createEvent } from "../helpers";

describe("24時間経過バナー", () => {
  it("shows the banner once the event is more than 24h in the past", async () => {
    const created = await createEvent({ startsAt: "2020-01-01T00:00" });
    const response = await created.client.get(`/e/${created.slug}/`);
    const html = await response.text();
    expect(html).toContain("24時間以上経過しています");
  });

  it("does not show the banner for a future event", async () => {
    const created = await createEvent({ startsAt: "2099-01-01T00:00" });
    const response = await created.client.get(`/e/${created.slug}/`);
    const html = await response.text();
    expect(html).not.toContain("24時間以上経過しています");
  });
});

describe("closed バナーと参加者の書き込み制限", () => {
  it("shows the closed banner and blocks participant writes, but not organizer reads", async () => {
    const created = await createEvent();
    await closeEvent(created.slug);

    const response = await created.client.get(`/e/${created.slug}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("募集は締め切られています");
  });
});
