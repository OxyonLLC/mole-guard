'use strict';

// Pure metadata comparison; no filesystem access or protected-data API.
module.exports = function compare(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(file => {
    const a = before[file], b = after[file];
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    const present = entry => entry && entry.kind !== 'missing';
    return [{ file, change: !present(a) ? 'added' : !present(b) ? 'removed' : 'changed' }];
  });
};
