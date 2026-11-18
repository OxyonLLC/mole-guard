'use strict';
// INTENTIONAL supervisor probe: abrupt termination bypasses test teardown.
process.kill(process.pid, 'SIGTERM');
