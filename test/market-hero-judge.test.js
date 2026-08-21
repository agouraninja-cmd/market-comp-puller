"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_MODEL, SYSTEM, buildJudgeBody, judgeHeaders,
  parseJudgeText, parseJudgeResponse, userText,
} = require("../market-hero-judge");

test("the request carries the crop as an image and names the city in words", () => {
  const body = buildJudgeBody({ city: "Casper", state: "wy", title: "Casper aerial", imageBase64: "AAAA" });
  assert.equal(body.model, DEFAULT_MODEL);
  const [img, txt] = body.messages[0].content;
  assert.equal(img.type, "image");
  assert.equal(img.source.type, "base64");
  assert.equal(img.source.media_type, "image/jpeg");
  assert.equal(img.source.data, "AAAA");
  assert.match(txt.text, /Casper, WY/);
  assert.match(txt.text, /Casper aerial/);
  assert.equal(body.system, SYSTEM);
  // Thinking is on by default on this model, so a tight ceiling truncates the
  // JSON rather than shortening the answer.
  assert.ok(body.max_tokens >= 1000);
  assert.equal(body.output_config.effort, "low");
});

test("the judge is told what a bad header photograph is, in the words the failures came in", () => {
  for (const rule of [/collage/i, /map/i, /interior/i, /white type/i, /DIFFERENT city/]) {
    assert.match(SYSTEM, rule);
  }
});

test("a request with no title still asks a complete question", () => {
  assert.match(userText("Nampa", "ID", ""), /Nampa, ID/);
  assert.ok(!userText("Nampa", "ID", "").includes("undefined"));
});

test("the headers are the Messages API's, and the key is not logged into the body", () => {
  const h = judgeHeaders("sk-test");
  assert.equal(h["x-api-key"], "sk-test");
  assert.equal(h["anthropic-version"], "2023-06-01");
  assert.equal(h["content-type"], "application/json");
  assert.ok(!JSON.stringify(buildJudgeBody({ imageBase64: "x" })).includes("sk-test"));
});

test("a plain verdict parses, fenced or not", () => {
  assert.deepEqual(parseJudgeText('{"verdict":"good","reason":"Clear downtown aerial."}'),
    { verdict: "good", reason: "Clear downtown aerial." });
  assert.deepEqual(parseJudgeText('```json\n{"verdict":"bad","reason":"A collage of six photos."}\n```'),
    { verdict: "bad", reason: "A collage of six photos." });
  assert.equal(parseJudgeText('Here you go: {"verdict":"bad","reason":"Mostly sky."} hope that helps').verdict, "bad");
});

test("anything that is not a clear verdict is unknown, never a good picture", () => {
  // A wrong "good" ships a bad photograph to a public page; a wrong "bad"
  // costs a satellite tile, so every doubt resolves the same way.
  assert.equal(parseJudgeText("It looks great to me!").verdict, "unknown");
  assert.equal(parseJudgeText('{"verdict":"maybe","reason":"hard to say"}').verdict, "unknown");
  assert.equal(parseJudgeText("").verdict, "unknown");
  assert.equal(parseJudgeText('{"verdict":"GOOD","reason":"fine"}').verdict, "good", "case is not the model's fault");
});

test("a refusal is not a verdict", () => {
  const r = parseJudgeResponse({ stop_reason: "refusal", content: [{ type: "text", text: '{"verdict":"good"}' }] });
  assert.equal(r.verdict, "unknown");
});

test("only text blocks are read, and a long reason is trimmed", () => {
  const res = {
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: '{"verdict":"good","reason":"' + "x".repeat(400) + '"}' },
    ],
  };
  const r = parseJudgeResponse(res);
  assert.equal(r.verdict, "good");
  assert.ok(r.reason.length <= 200);
});
