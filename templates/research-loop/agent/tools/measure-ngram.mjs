import { readFile } from "node:fs/promises";
import path from "node:path";

function contexts(text, order) {
  const pairs = [];
  const prefix = "~".repeat(order);
  const padded = `${prefix}${text}`;
  for (let index = order; index < padded.length; index += 1) {
    pairs.push([padded.slice(index - order, index), padded[index]]);
  }
  return pairs;
}

export async function measureNgram(config, fixtureRoot = path.resolve("fixtures", "corpus")) {
  const order = Math.max(1, Math.min(6, Number(config.order)));
  const alpha = Math.max(0.001, Math.min(10, Number(config.alpha)));
  if (!Number.isFinite(order) || !Number.isFinite(alpha)) throw new Error("invalid n-gram configuration");

  const [train, validation] = await Promise.all([
    readFile(path.join(fixtureRoot, "train.txt"), "utf8"),
    readFile(path.join(fixtureRoot, "validation.txt"), "utf8"),
  ]);
  const vocabulary = new Set(train);
  for (const character of validation) vocabulary.add(character);
  const counts = new Map();
  const totals = new Map();
  for (const [context, character] of contexts(train, order)) {
    const key = `${context}\0${character}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    totals.set(context, (totals.get(context) ?? 0) + 1);
  }

  let negativeLogLikelihood = 0;
  const pairs = contexts(validation, order);
  for (const [context, character] of pairs) {
    const count = counts.get(`${context}\0${character}`) ?? 0;
    const total = totals.get(context) ?? 0;
    const probability = (count + alpha) / (total + alpha * vocabulary.size);
    negativeLogLikelihood += -Math.log2(probability);
  }
  return {
    alpha,
    heldoutBitsPerCharacter: Number((negativeLogLikelihood / pairs.length).toFixed(6)),
    order,
    trainCharacters: train.length,
    validationCharacters: validation.length,
    vocabularySize: vocabulary.size,
  };
}
