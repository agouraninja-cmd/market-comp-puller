// Settings' "Take a selfie" (2026-11-17): the profile photo from the
// laptop's or phone's front camera. What must hold, read off index.html:
// the camera is asked for in one place, video only, front-facing; every way
// out turns it off; and the shot is saved through the same validated PUT as
// a chosen file. The header half (camera=(self)) is security-headers.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function fnBody(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} must exist`);
  const open = html.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test("the selfie's controls are in the Settings panel's Account section", () => {
  const acct = html.indexOf('id="settingsAcctSection"');
  const del = html.indexOf('id="settingsDeleteConfirm"');
  for (const id of ["settingsSelfieBtn", "selfieBox", "selfieVideo", "selfieStill",
    "selfieSnap", "selfieUse", "selfieRetake", "selfieCancel", "selfieFile"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > acct && at < del, `#${id} belongs in the Account section`);
  }
  // A phone without the camera API still opens its front camera this way.
  assert.match(html, /capture="user"[^>]*id="selfieFile"/);
  // playsinline, or iPhone Safari takes the preview full screen.
  assert.match(html, /<video id="selfieVideo"[^>]*playsinline[^>]*muted/);
});

test("the camera is asked for in one place: on a click, video only, the front camera", () => {
  const calls = html.match(/getUserMedia\(/g) || [];
  // The feature test (typeof md.getUserMedia) is not a call; one real call.
  assert.equal(calls.length, 1, "getUserMedia must be called from startSelfie alone");
  const start = fnBody("startSelfie");
  assert.match(start, /getUserMedia\(\{/);
  assert.match(start, /facingMode: "user"/);
  assert.match(start, /audio: false/);
  assert.match(html, /getElementById\("settingsSelfieBtn"\)\.addEventListener\("click", startSelfie\)/);
});

test("every way out turns the camera off", () => {
  const stop = fnBody("stopSelfie");
  assert.match(stop, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  assert.match(stop, /srcObject = null/);
  assert.match(fnBody("closeSettingsModal"), /stopSelfie\(\)/,
    "closing Settings (Close, Escape, a click outside) must stop the camera");
  // Closed while the browser was still asking: the late stream is stopped.
  assert.match(fnBody("startSelfie"), /classList\.contains\("hidden"\)\)\s*\{\s*stream\.getTracks\(\)\.forEach/);
  for (const id of ["selfieCancel", "selfieUse"]) {
    const at = html.indexOf(`getElementById("${id}").addEventListener`);
    assert.ok(at > -1, `#${id} has a handler`);
    assert.match(html.slice(at, at + 600), /stopSelfie\(\)/, `#${id} must stop the camera`);
  }
});

test("a selfie is saved like a chosen file: cropped, shrunk, the same PUT", () => {
  const at = html.indexOf('getElementById("selfieSnap").addEventListener');
  assert.match(html.slice(at, at + 500), /squareAvatarJpeg\(video, video\.videoWidth, video\.videoHeight, true\)/);
  assert.match(fnBody("readAvatarFile"), /squareAvatarJpeg\(img, img\.width, img\.height\)/,
    "a chosen file and a camera frame share one crop");
  const use = html.indexOf('getElementById("selfieUse").addEventListener');
  assert.match(html.slice(use, use + 500), /await saveAvatar\(shot\)/);
  assert.match(fnBody("saveAvatar"), /acctApi\("PUT", "\/api\/account\/avatar"/);
});
