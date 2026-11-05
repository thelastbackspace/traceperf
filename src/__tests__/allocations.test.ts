import { profileAllocations } from '../index';

const retained: number[][][] = [];
function allocateArrays(count: number, retain = false) {
  const keep: number[][] = [];
  for (let i = 0; i < count; i++) keep.push(new Array(1000).fill(i));
  if (retain) retained.push(keep);
  return keep.length;
}
const fullCounting = parseInt(process.versions.v8, 10) >= 11;

function churn(iterations: number) {
  // Allocates a lot but keeps nothing: the heap delta would show ~0
  let n = 0;
  for (let i = 0; i < iterations; i++) n += JSON.stringify({ i, payload: 'x'.repeat(200) }).length;
  return n;
}

test('reports allocated bytes and the allocating function', async () => {
  // Retained, so this holds on every Node version
  const { result, allocatedBytes, sites, countsCollected } = await profileAllocations(() => allocateArrays(2000, true));
  retained.length = 0;
  expect(countsCollected).toBe(fullCounting);
  expect(result).toBe(2000);
  // 2000 arrays x 1000 elements x >= 4 bytes
  expect(allocatedBytes).toBeGreaterThan(4 * 1000 * 1000);
  expect(sites[0].functionName).toBe('allocateArrays');
  expect(sites[0].url).toContain('allocations.test');
});

(fullCounting ? test : test.skip)('counts garbage that was collected again (Node 20+)', async () => {
  const { allocatedBytes } = await profileAllocations(() => churn(20000));
  expect(allocatedBytes).toBeGreaterThan(2 * 1000 * 1000);
});

test('async functions, errors, and one profile at a time', async () => {
  const p = profileAllocations(async () => {
    await new Promise(r => setTimeout(r, 5));
    return allocateArrays(100);
  });
  await expect(profileAllocations(() => 1)).rejects.toThrow('already running');
  expect((await p).result).toBe(100);
  await expect(profileAllocations(() => { throw new Error('inner'); })).rejects.toThrow('inner');
  expect((await profileAllocations(() => 2)).result).toBe(2); // released after an error
});
