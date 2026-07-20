import assert from "node:assert/strict";
import test from "node:test";
import {
  drawExecutionModesForOfficialMode,
  isEnabledEnvironmentValue,
} from "../src/app/config/drawExecutionMode.js";

test("official draw mode accepts explicit environment values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(isEnabledEnvironmentValue(value), true);
  }
  for (const value of ["", "0", "false", "no", "off", undefined]) {
    assert.equal(isEnabledEnvironmentValue(value), false);
  }
});

test("official draw mode exposes mainnet only", () => {
  assert.deepEqual(drawExecutionModesForOfficialMode(true), ["mainnet"]);
  assert.deepEqual(drawExecutionModesForOfficialMode(false), [
    "mainnet",
    "sandbox",
    "simulation",
  ]);
});
