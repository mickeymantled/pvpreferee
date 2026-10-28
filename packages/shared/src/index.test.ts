import { describe, expect, it } from 'vitest';
import { canonicalJson } from './index';
describe('canonical facts serialization', () => { it('ignores object insertion order, not array order', () => { expect(canonicalJson({b:2,a:[1,2]})).toBe(canonicalJson({a:[1,2],b:2})); expect(canonicalJson([1,2])).not.toBe(canonicalJson([2,1])); }); });
