"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cityAreaState, AREA_DIRS } = require("../market-area");

test("a city whose read markets agree carries that word", () => {
  assert.equal(cityAreaState([{ dir: "expanding" }]), "expanding");
  assert.equal(cityAreaState([{ dir: "contracting" }, { dir: "contracting" }]), "contracting");
  assert.equal(cityAreaState([{ dir: "flat" }]), "flat");
});

test("readings that disagree are mixed — never one of the two colors", () => {
  assert.equal(cityAreaState([{ dir: "expanding" }, { dir: "contracting" }]), "mixed");
  assert.equal(cityAreaState([{ dir: "flat" }, { dir: "expanding" }]), "mixed");
  // Order must not decide the answer.
  assert.equal(cityAreaState([{ dir: "contracting" }, { dir: "expanding" }]), "mixed");
});

test("an unread market never argues", () => {
  // One expanding market plus two unread ones is expanding, not mixed:
  // absence of data is not a disagreement.
  assert.equal(cityAreaState([{ dir: "expanding" }, {}, { dir: undefined }]), "expanding");
  assert.equal(cityAreaState([{ dir: "contracting" }, { dir: null }]), "contracting");
});

test("no readings at all is none — an absence of claim, not a fourth color", () => {
  assert.equal(cityAreaState([]), "none");
  assert.equal(cityAreaState([{}, {}]), "none");
  assert.equal(cityAreaState(undefined), "none");
});

test("an unrecognized direction word is treated as unread, never as a state", () => {
  // The fail-toward-less-claim rule: a typo'd or future direction value must
  // weaken the claim, not invent one.
  assert.equal(cityAreaState([{ dir: "booming" }]), "none");
  assert.equal(cityAreaState([{ dir: "expanding" }, { dir: "EXPANDING" }]), "expanding");
  assert.equal(cityAreaState([{ dir: "expanding" }, { dir: "sideways" }]), "expanding");
});

test("the vocabulary is exactly the three freshDirection words", () => {
  const MARKETSNAP = require("../market-snapshot");
  assert.deepEqual([...AREA_DIRS].sort(), [...MARKETSNAP.DIRECTIONS].sort(),
    "market-area's direction vocabulary drifted from market-snapshot's");
});
