'use strict';
// Supplemental fixed test manifest. The established integrity policy stays
// byte-identical to the guard trust anchor in the frozen staging candidate.
module.exports = Object.freeze({ DEP: Object.freeze([
  'test/mole/deploymentPreparation.test.mjs', 'test/ui/androidCompatibility.test.mjs',
]) });
