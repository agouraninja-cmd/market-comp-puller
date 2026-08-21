// ---------------------------------------------------------------------------
// "Is this a good picture of this city?" — the half a machine cannot answer
// from metadata.
//
// market-hero-pick.js reads titles, sizes and licences; market-hero-quality.js
// measures the encoded JPEG. Neither can see the photograph, and the failures
// that actually reach a market page are all visual: a collage of six small
// pictures, an empty car park, a close-up of one building, a photograph of a
// different city filed under this one's category, a crop that is 80% sky.
// /admin/heroes exists because a person had to look. This module asks a model
// to look first, so a person only reviews what already passed.
//
// It runs OFFLINE, in scripts/auto-market-heroes.js, never on a page render:
// the verdict is stored in market-heroes-auto.json and committed with the
// JPEG. A market page must never wait on a model to decide what it shows.
//
// Pure — request body in, parsed verdict out. The script owns the fetch, the
// key and the retries, which is what lets npm test pin the prompt and every
// parse without a network or an API key.
// ---------------------------------------------------------------------------

"use strict";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-5";

// The judge is shown the 1920w crop — exactly what a reader sees, cropped the
// same way — rather than the original. A photograph that only works before
// the crop is not a photograph that works here.
const SYSTEM = [
  "You are reviewing a photograph that will become the full-bleed header of a",
  "commercial real estate market page for one US city. The image you are shown",
  "is the finished crop: a wide 4.8:1 band, with the page's headline laid over",
  "the lower left in white type.",
  "",
  "Answer only with JSON: {\"verdict\":\"good\"|\"bad\",\"reason\":\"<one short sentence>\"}.",
  "",
  "Say good only when ALL of these hold:",
  "- it is a real photograph of a place (not a map, collage, chart, poster,",
  "  screenshot, diagram, drawing or historic reproduction);",
  "- it shows a city or town from outside and at some distance — a skyline, an",
  "  aerial, a downtown street, a waterfront — rather than one building's",
  "  facade, an interior, a car park, a field, or a close-up of an object;",
  "- it is sharp enough and well enough exposed to sit under white type;",
  "- nothing in it contradicts the city named below (a sign or landmark",
  "  naming a DIFFERENT city is a bad picture, however handsome).",
  "",
  "Say bad when the crop is mostly empty sky, water or vegetation, when the",
  "subject is unidentifiable, or when it carries watermarks or overlaid text.",
  "You cannot verify the city from the picture alone; do not fail it merely",
  "for being unrecognisable, only for actively contradicting the name.",
].join("\n");

function userText(city, state, title) {
  const where = [String(city || "").trim(), String(state || "").trim().toUpperCase()]
    .filter(Boolean).join(", ");
  const lines = ["This is meant to be the header photograph for " + where + "."];
  if (title) lines.push("It is filed on Wikimedia Commons as: " + String(title));
  lines.push("Is it a good header photograph for that page?");
  return lines.join("\n");
}

// The request body for one look. `imageBase64` is the encoded 1920w JPEG.
//
// Effort is low and max_tokens is generous rather than tight: this is a
// two-field answer, but thinking is on by default on this model and a cramped
// ceiling truncates the JSON instead of shortening the reasoning.
function buildJudgeBody({ city, state, title, imageBase64, model, mediaType }) {
  return {
    model: model || DEFAULT_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType || "image/jpeg",
            data: String(imageBase64 || ""),
          },
        },
        { type: "text", text: userText(city, state, title) },
      ],
    }],
  };
}

function judgeHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": String(apiKey || ""),
    "anthropic-version": API_VERSION,
  };
}

// The model is asked for bare JSON and usually gives it. The fence-stripping
// and brace-slicing is the same defence parseCompJson has needed since the
// first week of this project.
function parseJudgeText(text) {
  const raw = String(text || "").trim();
  if (!raw) return { verdict: "unknown", reason: "the reviewer returned nothing" };
  let body = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const open = body.indexOf("{");
  const close = body.lastIndexOf("}");
  if (open !== -1 && close > open) body = body.slice(open, close + 1);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    // A model that answered in prose still answered. Refuse rather than guess
    // "good" from a sentence: a wrong good ships a bad picture, a wrong bad
    // costs a satellite tile.
    return { verdict: "unknown", reason: "unparseable reviewer answer: " + raw.slice(0, 120) };
  }
  const verdict = String((parsed && parsed.verdict) || "").toLowerCase().trim();
  const reason = String((parsed && parsed.reason) || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (verdict !== "good" && verdict !== "bad") {
    return { verdict: "unknown", reason: reason || "reviewer gave no verdict" };
  }
  return { verdict, reason };
}

// The text blocks of a Messages response, joined the way server.js joins them.
function judgeTextFrom(response) {
  const content = (response && response.content) || [];
  return content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n");
}

// A refusal is not a verdict. Treated as "unknown" so the city falls through
// to the satellite aerial rather than shipping an unreviewed photograph.
function parseJudgeResponse(response) {
  if (response && response.stop_reason === "refusal") {
    return { verdict: "unknown", reason: "the reviewer declined to answer" };
  }
  return parseJudgeText(judgeTextFrom(response));
}

module.exports = {
  API_URL,
  API_VERSION,
  DEFAULT_MODEL,
  SYSTEM,
  userText,
  buildJudgeBody,
  judgeHeaders,
  parseJudgeText,
  judgeTextFrom,
  parseJudgeResponse,
};
