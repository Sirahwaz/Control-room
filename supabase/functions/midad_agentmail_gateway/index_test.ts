import { normalizeReceivedEvent } from "./index.ts";

Deno.test("accepts a verified ordinary inbound message", () => {
  const result = normalizeReceivedEvent({
    type: "event",
    event_type: "message.received",
    event_id: "evt_123",
    message: {
      message_id: "msg_123",
      inbox_id: "inbox_123",
      thread_id: "thread_123",
      from: "customer@example.com",
      subject: "Question",
      extracted_text: "Hello MIDAD",
      labels: [],
    },
  });
  if (!result.accepted || result.text !== "Hello MIDAD") throw new Error("ordinary message was not normalized");
});

Deno.test("rejects spam, blocked and unauthenticated messages", () => {
  for (const label of ["spam", "blocked", "unauthenticated"]) {
    const result = normalizeReceivedEvent({
      type: "event",
      event_type: "message.received",
      event_id: "evt_" + label,
      message: {
        message_id: "msg_" + label,
        inbox_id: "inbox_123",
        from: "sender@example.com",
        labels: [label],
      },
    });
    if (result.accepted) throw new Error(label + " message must not enter client processing");
  }
});

Deno.test("does not process security scans that are still pending", () => {
  const result = normalizeReceivedEvent({
    type: "event",
    event_type: "message.received",
    event_id: "evt_pending",
    message: {
      message_id: "msg_pending",
      inbox_id: "inbox_123",
      labels: [],
      agent_armor: { status: "pending" },
    },
  });
  if (result.accepted) throw new Error("pending security scan must not be processed");
});

Deno.test("rejects unsupported event types and missing identifiers", () => {
  const unsupported = normalizeReceivedEvent({
    type: "event",
    event_type: "message.sent",
    event_id: "evt_sent",
    message: { message_id: "msg_1", inbox_id: "inbox_1", labels: [] },
  });
  const missing = normalizeReceivedEvent({
    type: "event",
    event_type: "message.received",
    event_id: "",
    message: { message_id: "msg_2", inbox_id: "inbox_1", labels: [] },
  });
  if (unsupported.accepted || missing.accepted) throw new Error("invalid event was accepted");
});

Deno.test("rejects Agent Armor review and unavailable verdicts", () => {
  for (const agent_armor of [
    { status: "complete", verdict: "review" },
    { status: "unavailable", unavailable_reason: "payload_too_large" },
  ]) {
    const result = normalizeReceivedEvent({
      type: "event",
      event_type: "message.received",
      event_id: "evt_armor_" + agent_armor.status,
      message: {
        message_id: "msg_armor_" + agent_armor.status,
        inbox_id: "inbox_123",
        labels: [],
        agent_armor,
      },
    });
    if (result.accepted) throw new Error("non-clear Agent Armor verdict must not be processed");
  }
});

Deno.test("accepts only a clear Agent Armor verdict", () => {
  const result = normalizeReceivedEvent({
    type: "event",
    event_type: "message.received",
    event_id: "evt_clear",
    message: {
      message_id: "msg_clear",
      inbox_id: "inbox_123",
      labels: [],
      agent_armor: { status: "complete", verdict: "clear" },
    },
  });
  if (!result.accepted) throw new Error("clear Agent Armor verdict should be eligible");
});
