import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalExternalModel, assertLocalMutationHost, isLoopbackHost } from "../backend/authority/local-only.mjs";

test("networked mutation and live-model paths fail closed", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.throws(() => assertLocalMutationHost("0.0.0.0"), /loopback host/);
  assert.throws(() => assertLocalExternalModel("127.0.0.1", "false"), /disabled/);
  assert.doesNotThrow(() => assertLocalExternalModel("127.0.0.1", "true"));
});
