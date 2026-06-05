export type ElasticStackItem = {
  id: string;
  height: number;
  desiredY: number;
  weight?: number;
};

export type ElasticStackResult = {
  id: string;
  y: number;
  height: number;
  gapBefore: number;
  extraGapBefore: number;
};

type ElasticStackOptions = {
  minGap?: number;
};

function finiteNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

type PavaBlock = {
  start: number;
  end: number;
  weight: number;
  weightedSum: number;
  value: number;
};

export function fitElasticStack(items: ElasticStackItem[], options: ElasticStackOptions = {}): ElasticStackResult[] {
  const minGap = Math.max(0, finiteNumber(options.minGap, 0));
  if (items.length === 0) return [];

  const cumulativeSeparation: number[] = [];
  let cursor = 0;
  for (let index = 0; index < items.length; index += 1) {
    cumulativeSeparation[index] = cursor;
    cursor += Math.max(0, finiteNumber(items[index].height, 0)) + minGap;
  }

  const blocks: PavaBlock[] = [];
  items.forEach((item, index) => {
    const weight = Math.max(1e-6, finiteNumber(item.weight, 1));
    const desiredZ = finiteNumber(item.desiredY, 0) - cumulativeSeparation[index];
    blocks.push({ start: index, end: index, weight, weightedSum: desiredZ * weight, value: desiredZ });
    while (blocks.length >= 2 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const right = blocks.pop()!;
      const left = blocks.pop()!;
      const mergedWeight = left.weight + right.weight;
      const mergedWeightedSum = left.weightedSum + right.weightedSum;
      blocks.push({
        start: left.start,
        end: right.end,
        weight: mergedWeight,
        weightedSum: mergedWeightedSum,
        value: mergedWeightedSum / mergedWeight,
      });
    }
  });

  const fittedZ = new Array<number>(items.length);
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index += 1) {
      fittedZ[index] = block.value;
    }
  }

  const results: ElasticStackResult[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const height = Math.max(0, finiteNumber(item.height, 0));
    const y = fittedZ[index] + cumulativeSeparation[index];
    const previous = results[index - 1];
    const gapBefore = previous ? Math.max(0, y - previous.y - previous.height) : 0;
    results.push({
      id: item.id,
      y,
      height,
      gapBefore,
      extraGapBefore: previous ? Math.max(0, gapBefore - minGap) : 0,
    });
  }

  return results;
}
